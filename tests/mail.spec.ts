import { beforeEach, afterEach, expect, it } from 'vitest'
import { mailTrigger } from '../src/sources/mail-message.ts'
import { mailKind } from '../src/sources/mail.ts'
import { SettingsSchema } from '../src/policy.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

const mail = (id: string, extras = '', thread = id) => mailTrigger({
  source: 'gmail', account: 'receiver@example.test', id, thread, received: new Date('2026-11-13T01:00:00Z'),
  raw: Buffer.from(`From: Sender <sender@example.test>\r\nSubject: Copy fix\r\n${extras}\r\nPlease correct the typo in the heading.`),
})

it('filters bulk and automatic mail, and keys retries and replies consistently', async () => {
  expect(await mail('bulk', 'List-Id: <announcements.example.test>\r\n')).toBeUndefined()
  expect(await mail('auto', 'Auto-Submitted: auto-generated\r\n')).toBeUndefined()
  const first = await mail('first', '', 'thread')
  const reply = await mail('second', '', 'thread')
  expect(first?.id).toBe((await mail('first', '', 'thread'))?.id)
  expect(first?.threads).toEqual(reply?.threads)
  expect(first?.id).not.toBe(reply?.id)
  expect(first?.addressed).toBeUndefined()
  expect(first?.channel).toBeUndefined()
})

let host: Host
beforeEach(async () => { host = await startRuntime() })
afterEach(async () => { await host.stop() })

async function acceptEmail(autoProcess: boolean) {
  host.runtime.sources.register(mailKind('gmail'))
  const settings = host.runtime.store.settings()
  host.runtime.store.saveSettings(SettingsSchema.parse({
    ...settings,
    sources: { ...settings.sources, gmail: { enabled: true, config: { autoProcess } } },
    policy: { ...settings.policy, sources: { ...settings.policy.sources, gmail: {
      allowed: [], admission: { inbox: { unlistedUnaddressed: 'inferred' } },
    } } },
  }))
  const trigger = (await mail('request'))!
  expect(host.runtime.receive(trigger)).toBe('stored')
  expect(host.runtime.receive(trigger)).toBe('duplicate')
  await host.runtime.idle()
  await host.runTool(host.runtime.masterId, 'orchestrator_eval', { trigger_id: trigger.id })
  const result = await host.runTool(host.runtime.masterId, 'orchestrator_eval_decide', {
    trigger_id: trigger.id, decision: 'accept', title: 'Correct heading', worktree_name: 'correct-heading',
    scope: 'Correct the typo in the heading', reason: 'The request identifies the change', intent_evidence: 'correct the typo',
    rule_assessments: [{ rule_id: 'copy', matched: true, reason: 'Typo fix' }, { rule_id: 'visual', matched: false, reason: 'No visual change' }],
    direction: { implementation_requested: true, target_basis: 'specified', requires_design_decision: false, evidence: 'Heading typo' },
  })
  await host.settle()
  return (result.ticket as { ticket_id: string }).ticket_id
}

it('waits for a panel start when auto processing is disabled', async () => {
  const id = await acceptEmail(false)
  expect(host.runtime.store.tickets.get(id)?.awaitingStart).toBe(true)
  host.runtime.executor.resume()
  await host.settle()
  expect(host.runtime.store.tickets.get(id)?.assignments[0]?.state).toBe('pending')
  expect((await host.api('POST', `tickets/${id}/start`)).status).toBe(200)
  host.runtime.engine.startTicket(id)
  await host.settle()
  const ticket = host.runtime.store.tickets.get(id)
  expect(ticket?.awaitingStart).toBeUndefined()
  expect(ticket?.assignments).toHaveLength(1)
  expect(ticket?.assignments[0]?.state).toBe('running')
})

it('launches a newly accepted email when auto processing is enabled', async () => {
  const id = await acceptEmail(true)
  expect(host.runtime.store.tickets.get(id)?.awaitingStart).toBeUndefined()
  expect(host.runtime.store.tickets.get(id)?.assignments[0]?.state).toBe('running')
})
