import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { z } from 'zod'
import type { PluginContext, SourceContext, SourceKind, Trigger } from './host.ts'
import type { MailSource } from './mail-message.ts'
import { pollGmail } from './mail-gmail.ts'
import { pollICloud } from './mail-icloud.ts'

export const MailConfig = z.object({
  credentialsPath: z.string().trim().refine(path => !path || isAbsolute(path)).default(''),
  pollSeconds: z.number().int().min(30).max(3600).default(60),
}).strict()
type Config = z.infer<typeof MailConfig>
type MailContext = {
  state: { get<T>(name: string): T | undefined; set<T>(name: string, value: T): void }
  receive(trigger: Trigger): Promise<void>
}
export type MailPoll = (credentials: unknown, ctx: MailContext, signal: AbortSignal, active: () => boolean) => Promise<void>

export function mailKind(kind: MailSource): SourceKind<Config> {
  const label = kind === 'gmail' ? 'Gmail' : 'iCloud Mail'
  return {
    kind, title: { zh: label, en: label }, health: [kind], schema: MailConfig,
    description: { zh: '读取接入后的新收件，先过滤广告与群发邮件，再按接单规则评估。', en: 'Reads new inbox messages, skips bulk mail, and evaluates requests against your rules.' },
    fields: [
      { key: 'credentialsPath', type: 'text', label: { zh: '本地凭据文件路径', en: 'Local credentials file path' } },
      { key: 'pollSeconds', type: 'number', min: 30, max: 3600, label: { zh: '检查间隔（秒）', en: 'Poll interval (seconds)' }, advanced: true },
    ],
    scope: () => ({ listened: true, observed: true, row: 'inbox' }),
    policy: {
      schema: z.object({ allowed: z.array(z.object({ id: z.email().transform(value => value.toLowerCase()) })).default([]) }).strict(),
      fields: [{ key: 'allowed', type: 'rows', label: { zh: '已知发件人', en: 'Known senders' },
        columns: [{ key: 'id', type: 'text', label: { zh: '邮箱地址', en: 'Email address' } }] }],
      explicit: { zh: '邮件按规则评估。发件人地址只用于分类。', en: 'Email is evaluated by policy. Sender addresses are used for classification.' },
      rows: () => [{ id: 'inbox', label: { zh: '收件箱', en: 'Inbox' }, note: { zh: '新邮件', en: 'New messages' },
        cells: { listedUnaddressed: true, unlistedAddressed: false, unlistedUnaddressed: true } }],
    },
  }
}

async function watch(ctx: SourceContext, source: MailSource, poll: MailPoll, signal: AbortSignal): Promise<void> {
  await ctx.ready
  while (!signal.aborted) {
    const config = ctx.config<Config>(source)
    const path = config?.credentialsPath
    const active = () => !signal.aborted && ctx.config<Config>(source)?.credentialsPath === path && ctx.configured()
    const scoped: MailContext = {
      state: {
        get: <T>(name: string) => ctx.state.get<T>(name),
        set: <T>(name: string, value: T) => ctx.state.set(name, value),
      },
      receive: async trigger => {
        const result = await ctx.receive(trigger)
        const thread = trigger.threads[0]
        if (result === 'stored' && thread) ctx.threads.describe(`${thread.source}:${thread.id}`, { label: String(trigger.meta.subject) })
      },
    }
    if (!config || !path || !ctx.configured()) {
      ctx.report(source, { state: 'paused', detail: 'Waiting for mailbox configuration or deployment' })
    } else {
      try {
        const credentials: unknown = JSON.parse(await readFile(path, { encoding: 'utf8', signal }))
        if (active()) await poll(credentials, scoped, signal, active)
        if (active()) ctx.report(source, { state: 'ready', detail: 'Inbox checked', at: new Date().toISOString() })
      } catch {
        // Provider errors can include Authorization headers and mailbox addresses.
        if (active()) ctx.report(source, { state: 'error', detail: 'Inbox check failed. Check credentials, connection, and cursor status.' })
      }
    }
    await setTimeout((config?.pollSeconds ?? 60) * 1000, undefined, { signal }).catch(() => {})
  }
}

export const name = 'dsh-superagent-mail'
export const inject = ['orchestrator']

export function apply(ctx: PluginContext): void {
  for (const [id, poll] of [['gmail', pollGmail], ['icloud', pollICloud]] as const) {
    const kind = mailKind(id)
    ctx.effect(() => ctx.orchestrator.sources.register(kind), `${id}: source kind`)
    ctx.effect(() => {
      const controller = new AbortController()
      const source = ctx.orchestrator.context(kind)
      const running = watch(source, id, poll, controller.signal).catch(() => {
        if (!controller.signal.aborted) source.report(id, { state: 'error', detail: 'Mailbox watcher stopped' })
      })
      return async () => { controller.abort(); await running }
    })
  }
}
