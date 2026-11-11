/**
 * Persona injection: the stored binding's exact `sectionText` is the Worker Session's scoped System Prompt section
 * (`dsh-superagent-persona`, order 650, literal), rendered through DSH's `renderPrompt` — never the main Session, never a
 * subagent, never a live re-render of an updated catalog or prompt template.
 */
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { workerSessionId, type PersonaId, type PersonaRouter } from '../src/core/index.ts'
import { mandateInstructions } from '../src/executor/dsh.ts'
import { Commands } from '../src/infra/commands.ts'
import { feishu, startRuntime, type Host } from './fixtures/host.ts'
import { catalogDecision, catalogText, personaRouter, registerRouter, renderSession, sectionOf, sectionsOf, workerPrompt }
  from './fixtures/persona.ts'

let host: Host
beforeEach(async () => { host = await startRuntime() })
afterEach(async () => { await host.stop() })

/** Routes an inferred candidate through the same assessor path the main Session uses. */
async function acceptInferred(trigger: ReturnType<typeof feishu>) {
  host.runtime.receive(trigger)
  await host.runtime.idle()
  vi.mocked(Commands.prototype.lark).mockResolvedValue({ items: [] } as never)
  await host.runTool(host.runtime.masterId, 'orchestrator_eval', { trigger_id: trigger.id })
  const accepted = await host.runTool(host.runtime.masterId, 'orchestrator_eval_decide', { trigger_id: trigger.id, decision: 'accept', title: '文案修订',
    worktree_name: 'copy-fix', scope: '改副标题', reason: 'explicit copy change', intent_evidence: 'quoted', acknowledgement: '收到，把副标题改成“浏览网页”。',
    rule_assessments: [{ rule_id: 'copy', matched: true, reason: 'copy change' }, { rule_id: 'visual', matched: false, reason: 'not visual' }],
    direction: { implementation_requested: true, target_basis: 'specified', requires_design_decision: false, evidence: 'the message names the replacement' } })
  await host.settle()
  return accepted
}

/** Renders a list of registered sections with `renderPrompt`, as a real request renders an assembly. */
const render = (sections: { name: string; text: string; interpolate?: boolean }[]) =>
  renderPrompt({ sections, contexts: [], tools: [], variables: {} })
/** A Session's registered sections as `renderPrompt` takes them. */
const renderedSections = (target: Host, sessionId: string) =>
  sectionsOf(target, sessionId).map(section => ({ name: section.name, text: section.text({}), interpolate: section.interpolate }))

it('injects the exact bound snapshot into the Worker assembly and never into the main Session', async () => {
  const router = personaRouter({ rule: () => ({ persona: 'implement', signal: 'bug-fix' }) })
  registerRouter(host, router)
  const { ticket, sessionId } = await host.acceptedTicket(feishu('1', '@bot 修一下回归'))
  const snapshot = ticket.persona!.sectionText
  expect(snapshot).toBe(catalogText('implement'))
  const prompt = workerPrompt(host, ticket.id)
  expect(prompt).toContain(snapshot)
  expect(prompt).toContain('[dsh-superagent persona implement@1]')
  // The scoped section contract: only a Worker Session, order 650, literal, and before the team prompt section.
  const section = sectionOf(host, sessionId, 'dsh-superagent-persona')!
  expect(section).toMatchObject({ name: 'dsh-superagent-persona', order: 650, interpolate: false })
  expect(section.text({})).toBe(snapshot)
  expect(prompt.indexOf(snapshot)).toBeLessThan(prompt.indexOf('[dsh-superagent prompt revision'))
  // The main Session and a worker's subagent never receive it.
  expect(renderSession(host, host.runtime.masterId)).not.toContain('dsh-superagent persona')
  expect(sectionOf(host, host.runtime.masterId, 'dsh-superagent-persona')).toBeUndefined()
  // The first message delivered to the Worker is its assignment, after the binding existed.
  const delivered = host.deliveries.mock.calls.map(([call]) => call).filter(call => call.sessionId === sessionId)
  expect(delivered).toHaveLength(1)
  expect(JSON.parse(delivered[0]!.text)).toMatchObject({ ticket_id: ticket.id, title: ticket.title })
})

it('injects the Persona on an inferred accept and leaves the Mandate text untouched', async () => {
  const router = personaRouter({ rule: () => ({ persona: 'implement', signal: 'proactive' }) })
  registerRouter(host, router)
  const accepted = await acceptInferred(feishu('30', '把副标题改成“浏览网页”', { mentions: [] }))
  const ticket = host.runtime.store.tickets.get((accepted.ticket as { ticket_id: string }).ticket_id)!
  const prompt = workerPrompt(host, ticket.id)
  expect(prompt).toContain(ticket.persona!.sectionText)
  // The Mandate's own instruction still follows the team prompt, unchanged by routing.
  expect(prompt).toContain(mandateInstructions(ticket.mandate))
  expect(ticket.mandate.strength).toBe('inferred')
})

it('keeps each of two concurrent Workers to its own snapshot', async () => {
  const router = personaRouter({ rule: input => input.triggerText.includes('研究') ? { persona: 'research', signal: 'wording' }
    : input.triggerText.includes('测试') ? { persona: 'test', signal: 'wording' } : undefined })
  registerRouter(host, router)
  const [one, two] = await Promise.all([host.acceptedTicket(feishu('40', '@bot 研究一下这个报错')), host.acceptedTicket(feishu('41', '@bot 跑一下测试'))])
  const first = workerPrompt(host, one.ticket.id), second = workerPrompt(host, two.ticket.id)
  expect(first).toContain(catalogText('research'))
  expect(first).not.toContain('[dsh-superagent persona test@')
  expect(second).toContain(catalogText('test'))
  expect(second).not.toContain('[dsh-superagent persona research@')
  expect(sectionOf(host, one.sessionId, 'dsh-superagent-persona')!.text({})).toBe(one.ticket.persona!.sectionText)
  expect(sectionOf(host, two.sessionId, 'dsh-superagent-persona')!.text({})).toBe(two.ticket.persona!.sectionText)
})

it('keeps the audited snapshot through a prompt-template update and a catalog change', async () => {
  let persona: PersonaId = 'implement'
  const router: PersonaRouter = { id: 'mutable-router', version: '1', route: () => catalogDecision(persona, 'default', 'configured') }
  registerRouter(host, router)
  const { ticket } = await host.acceptedTicket(feishu('1', '@bot 修一下回归'))
  const snapshot = ticket.persona!.sectionText
  // Change the prompt configuration after the binding, and what the router would decide now.
  const { config, revision } = host.runtime.prompts.current()
  host.runtime.prompts.save({ ...config, delivery: `${config.delivery}\nTemplate updated after binding.` }, revision, 'panel')
  persona = 'review'
  await host.settle()
  const after = workerPrompt(host, ticket.id)
  expect(after).toContain(snapshot)
  expect(after).toContain('Template updated after binding.')
  expect(after).not.toContain('[dsh-superagent persona review@')
  expect(sectionOf(host, workerSessionId(ticket.id), 'dsh-superagent-persona')!.text({})).toBe(snapshot)
  // A Ticket accepted now binds the new Persona; the old Ticket keeps its own snapshot for good.
  const next = await host.acceptedTicket(feishu('2', '@bot 修一下标题'))
  expect(next.ticket.persona!.sectionText).toBe(catalogText('review'))
  expect(workerPrompt(host, ticket.id)).toContain(snapshot)
})

it('injects the bound Persona when a person opens the Worker Session and messages it before the launch', async () => {
  const router = personaRouter({ fallback: 'research' })
  registerRouter(host, router)
  // Hold the launch: accepting writes the Ticket and its binding at once, while the `launch` effect waits.
  await host.runtime.settings.pause(true, 'panel')
  const trigger = feishu('60', '@bot 研究一下这个回归')
  host.runtime.receive(trigger)
  await host.runtime.idle()
  const routed = await host.route({ kind: 'accept', trigger_id: trigger.id, title: '研究回归', worktree_name: 'research-regression',
    acknowledgement: '收到，先研究这个回归。' })
  const ticket = host.runtime.store.tickets.get((routed.ticket as { ticket_id: string }).ticket_id)!
  const sessionId = workerSessionId(ticket.id)
  expect(ticket.assignments).toEqual([expect.objectContaining({ state: 'pending' })])
  // The person opens `worker-<ticketId>` early and types into it, before any launch ran.
  await host.runtime.sessions.ensure(sessionId, ticket.execution!.directory, ticket.title, 'worker')
  await host.runtime.sessions.prompt(sessionId, 'direct:early', '请先看一下日志', 'queue')
  expect(sectionOf(host, sessionId, 'dsh-superagent-persona')!.text({})).toBe(ticket.persona!.sectionText)
  await host.runtime.settings.pause(false, 'panel')
  await host.settle()
  // The launch then delivers its assignment; the first assembly already carried the bound Persona.
  const delivered = host.deliveries.mock.calls.map(([call]) => call).filter(call => call.sessionId === sessionId)
  const direct = delivered.findIndex(call => call.text === '请先看一下日志')
  const assignment = delivered.findIndex(call => call.text.startsWith('{"ticket_id"'))
  expect(direct).toBeGreaterThanOrEqual(0)
  expect(assignment).toBeGreaterThan(direct)
  expect(workerPrompt(host, ticket.id)).toContain(ticket.persona!.sectionText)
})

it('injects nothing for a Ticket without a Persona: the composed prompt is the prompt without that section', async () => {
  const router = personaRouter()
  registerRouter(host, router)
  const { ticket, sessionId } = await host.acceptedTicket(feishu('70', '@bot 修一下回归'))
  // A Ticket written before routing has no `persona` field; drop it to model that stored record.
  const { persona: _persona, ...historical } = host.runtime.store.tickets.get(ticket.id)!
  host.runtime.store.tickets.save(historical)
  await host.settle()
  const sections = renderedSections(host, sessionId)
  const without = sections.filter(section => section.name !== 'dsh-superagent-persona')
  // The empty Persona section renders nothing: the Worker's prompt is exactly the original one.
  expect(render(sections)).toBe(render(without))
  expect(render(sections)).not.toContain('dsh-superagent persona')
  expect(sectionOf(host, sessionId, 'dsh-superagent-persona')!.text({})).toBe('')
  expect(router.inputs).toHaveLength(1)
})

it('keeps the composed Worker prompt unchanged when no router is registered', async () => {
  const { ticket, sessionId } = await host.acceptedTicket(feishu('80', '@bot 修一下回归'))
  const sections = renderedSections(host, sessionId)
  const without = sections.filter(section => section.name !== 'dsh-superagent-persona')
  expect(render(sections)).toBe(render(without))
  expect(ticket.persona).toBeUndefined()
})

it('re-renders the same snapshot after a delivery retry and a host restart', async () => {
  const router = personaRouter({ fallback: 'research' })
  registerRouter(host, router)
  const { ticket } = await host.acceptedTicket(feishu('90', '@bot 研究一下这个回归'))
  const before = workerPrompt(host, ticket.id)
  expect(before).toContain(ticket.persona!.sectionText)
  const assignment = host.runtime.store.tickets.get(ticket.id)!.assignments.at(-1)!
  host.runtime.engine.deliveryFailed(ticket.id, assignment.id, 'feishu: message recalled')
  host.runtime.engine.retryTicket(ticket.id)
  await host.settle()
  expect(workerPrompt(host, ticket.id)).toBe(before)
  await host.restart()
  await host.settle()
  expect(workerPrompt(host, ticket.id)).toBe(before)
  expect(router.inputs).toHaveLength(1)
})
