/**
 * Recording fake LLM adapter for the isolated-profile e2e.
 *
 * It registers provider `e2e-fake` on the real DSH `llm` service and is the model for both the
 * Super-agent's main Session and its Worker Session. Every call it receives is the REAL request the
 * DSH agent loop assembled for that Session (full message history, the assembled system prompt, and
 * the tool schemas); the adapter records it verbatim to
 * `<captureDir>/request-<n>.json` with a sha256 before replying.
 *
 * Scripted behavior:
 *  - `purpose` requests (session-title/compaction) -> a short text reply.
 *  - a `kind: "candidate"` card in the newest user message (the main Session) -> one
 *    `orchestrator_route` accept tool call, so the decision runs through the production main-Session
 *    tool path (Engine.decide) rather than being called directly by the harness.
 *  - a `worker-<ticketId>` Session -> a plain text reply, so the Worker's first request is captured
 *    and its turn can settle.
 *  - anything else -> a plain text reply.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

export const name = 'e2e-model'
export const inject = ['llm']

const textOf = (message) => (message?.content ?? [])
  .filter((block) => block?.type === 'text')
  .map((block) => block.text)
  .join('\n')

/** The assembled system prompt of one genuinely loop-built request. */
const systemOf = (messages) => messages.filter((message) => message.role === 'system').map(textOf).join('\n')

/** The newest user-role message, which carries a steered candidate card or the worker assignment. */
/** A candidate card is `JSON.stringify({ kind: 'candidate', ...card })` (see src/app/assessment.ts). */
function candidateOf(text) {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const value = JSON.parse(trimmed)
    return value && value.kind === 'candidate' && typeof value.trigger_id === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * The candidate card among the user messages, newest first. DSH appends its own runtime-context and
 * time-reminder user messages after a steered card, so the card is not necessarily the newest user
 * message; scan them all and route the first (newest) candidate found.
 */
function newestCandidate(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== 'user') continue
    const candidate = candidateOf(textOf(messages[index]))
    if (candidate) return candidate
  }
  return undefined
}

class FakeModel extends LlmAdapter {
  constructor(options) {
    super()
    this.options = options
    this.count = 0
  }

  providerInfo(provider) {
    return { id: provider, name: 'E2E recording fake model' }
  }

  async resolveModel(provider, model) {
    return { provider, id: model, name: `E2E ${model}`, context: { contextWindow: 1_000_000 } }
  }

  async *stream(options) {
    const record = this.record(options)
    const reply = this.decide(record, options)
    if (reply.kind === 'tool') {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: reply.id, name: reply.name, argumentsDelta: reply.arguments }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: reply.id, name: reply.name, arguments: reply.arguments } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply.text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply.text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }

  /** Persist the exact request, then return its JSON-safe projection for scripted decisions. */
  record(options) {
    this.count += 1
    const directory = this.options.captureDir
    mkdirSync(directory, { recursive: true })
    const messages = JSON.parse(JSON.stringify(options.messages ?? []))
    const record = {
      n: this.count,
      at: new Date().toISOString(),
      provider: options.provider,
      model: options.model,
      purpose: options.purpose ?? null,
      sessionId: options.sessionId === undefined ? '' : String(options.sessionId),
      system: systemOf(messages),
      messages,
      tools: (options.tools ?? []).map((tool) => ({ name: tool.name, descriptionLength: (tool.description ?? '').length,
        parametersSha256: createHash('sha256').update(JSON.stringify(tool.parameters ?? {})).digest('hex') })),
      toolHistory: options.toolHistory ?? null,
    }
    const raw = JSON.stringify(record)
    const file = join(directory, `request-${String(this.count).padStart(3, '0')}.json`)
    writeFileSync(file, raw)
    writeFileSync(`${file}.sha256`, createHash('sha256').update(raw).digest('hex'))
    return record
  }

  decide(record, options) {
    if (options.purpose !== undefined) return { kind: 'text', text: 'E2E session' }
    // Once the accept has run, the tool result names the Ticket; end the turn instead of re-routing.
    if (record.messages.some((message) => message.role === 'tool' && textOf(message).includes('"ticket_id"'))) {
      return { kind: 'text', text: 'Routed.' }
    }
    const candidate = newestCandidate(record.messages)
    const hasRouteTool = (options.tools ?? []).some((tool) => tool.name === 'orchestrator_route')
    if (candidate && hasRouteTool) {
      const id = `call_e2e_${this.count}`
      const argumentsText = JSON.stringify({
        decisions: [{
          kind: 'accept',
          trigger_id: candidate.trigger_id,
          title: 'Prove the Persona binding reaches the Worker first request',
          worktree_name: 'persona-proof',
          acknowledgement: '已受理，正在校验 Persona 绑定在 Worker 首次模型调用前生效。',
        }],
      })
      return { kind: 'tool', id, name: 'orchestrator_route', arguments: argumentsText }
    }
    if (record.sessionId.startsWith('worker-')) return { kind: 'text', text: 'ready' }
    return { kind: 'text', text: 'ok' }
  }
}

export function apply(ctx, config = {}) {
  if (!config.captureDir) throw new Error('e2e-model: config.captureDir is required')
  const adapter = new FakeModel({ captureDir: config.captureDir })
  ctx.llm.registerAdapter(['e2e-fake'], adapter)
  ctx.logger.info('e2e-model: provider e2e-fake registered; capturing to %s', config.captureDir)
}
