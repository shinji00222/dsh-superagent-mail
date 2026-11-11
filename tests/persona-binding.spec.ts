/**
 * Persona binding: the routing decision is persisted inside the transaction that creates the Ticket and its first
 * Assignment, audited on the Ticket, and never decided again — for retries, restarts, host restarts or historical Tickets.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { key, threadKey, type Ticket } from '../src/core/index.ts'
import { ticketDetail } from '../src/app/views/tickets.ts'
import { Commands } from '../src/infra/commands.ts'
import { CHAT, feishu, startRuntime, type Host } from './fixtures/host.ts'
import { catalogText, personaRouter, registerRouter, sectionOf } from './fixtures/persona.ts'

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

/** The Persona section text a Worker Session declares now, `''` without a registered section. */
const personaSectionOf = (target: Host, sessionId: string): string => sectionOf(target, sessionId, 'dsh-superagent-persona')?.text({}) ?? ''

it('binds the Persona in the transaction that creates an explicit Ticket, with the audit record', async () => {
  const router = personaRouter({ rule: input => input.triggerText.includes('修') ? { persona: 'implement', signal: 'bug-fix' } : undefined })
  registerRouter(host, router)
  const { trigger, ticket, sessionId } = await host.acceptedTicket(feishu('1', '@bot 修一下回归'))
  const binding = ticket.persona!
  expect(binding).toMatchObject({ personaId: 'implement', personaVersion: '1', sectionText: catalogText('implement'), reasonCode: 'rule',
    routerId: 'test-persona-router', routerVersion: '1', acceptance: 'explicit', firstAssignmentId: ticket.assignments[0]!.id,
    workerSessionId: sessionId, signals: { signal: 'bug-fix' } })
  expect(binding.reasonText).toContain('bug-fix')
  expect(binding.decidedAt).toBe(ticket.createdAt)
  // The router saw exactly the contract's facts: the origin Trigger, the accepted title, the prepared assignment, the
  // Mandate's acceptance and rules, and the Worker's real capability.
  expect(router.inputs).toHaveLength(1)
  expect(router.inputs[0]).toMatchObject({ ticketId: ticket.id, triggerId: trigger.id, triggerText: trigger.text, title: ticket.title,
    acceptance: 'explicit', rules: [], assignment: ticket.execution!.assignment, worker: { maxWorkers: 3, permissions: 'danger-full-access' } })
  expect(router.inputs[0]!.worker.tools).toEqual(expect.arrayContaining(['read', 'write', 'edit', 'glob', 'grep', 'bash', 'pwsh']))
  // No Executor role model is configured in this host, so the capability names no provider or model.
  expect(router.inputs[0]!.worker).not.toHaveProperty('provider')
})

it('binds an inferred accept without changing the Mandate', async () => {
  const router = personaRouter({ rule: () => ({ persona: 'implement', signal: 'proactive' }) })
  registerRouter(host, router)
  const trigger = feishu('30', '把副标题改成“浏览网页”', { mentions: [] })
  const accepted = await acceptInferred(trigger)
  const ticket = host.runtime.store.tickets.get((accepted.ticket as { ticket_id: string }).ticket_id)!
  expect(ticket.mandate).toMatchObject({ strength: 'inferred', basis: expect.objectContaining({ rules: ['copy'] }) })
  // The Mandate keeps exactly the fields the accept produced: routing only read it.
  expect(Object.keys(ticket.mandate).sort()).toEqual(['actor', 'basis', 'policyVersion', 'scope', 'strength'])
  expect(ticket.persona).toMatchObject({ personaId: 'implement', acceptance: 'inferred', reasonCode: 'rule', firstAssignmentId: ticket.assignments[0]!.id })
  expect(router.inputs.at(-1)).toMatchObject({ ticketId: ticket.id, triggerId: trigger.id, acceptance: 'inferred', rules: ['copy'], title: '文案修订' })
  expect(router.inputs.at(-1)!.assignment).toContain('Proactively accepted under copy')
})

it('applies exact overrides in priority order and ignores unknown or invalid ones', async () => {
  const router = personaRouter({ rule: () => ({ persona: 'implement', signal: 'default-rule' }) })
  registerRouter(host, router)
  // An exact Trigger override beats the rule.
  const first = feishu('10', '@bot 修一下回归')
  router.overrides.triggers[first.id] = 'research'
  const one = await host.acceptedTicket(first)
  expect(one.ticket.persona).toMatchObject({ personaId: 'research', reasonCode: 'operator-trigger-override' })
  // An exact Ticket override beats the Trigger override. The Ticket ID is derived from the started Eval, so learn it first.
  const second = feishu('11', '@bot 修一下标题')
  router.overrides.triggers[second.id] = 'research'
  host.runtime.receive(second)
  await host.runtime.idle()
  const evaluating = host.runtime.store.threads.get(threadKey(second.threads[0]!))!.evaluating!
  router.overrides.tickets[key('ticket', evaluating.id)] = 'plan'
  const routed = await host.route({ kind: 'accept', trigger_id: second.id, title: '修复标题', worktree_name: 'fix-title', acknowledgement: '收到，修复标题。' })
  const two = host.runtime.store.tickets.get((routed.ticket as { ticket_id: string }).ticket_id)!
  expect(two.persona).toMatchObject({ personaId: 'plan', reasonCode: 'operator-ticket-override' })
  // An unknown Ticket ID, an unknown Trigger ID and a Persona outside the catalog are ignored: the rule still applies.
  const third = feishu('12', '@bot 跑一下测试')
  router.overrides.tickets['ticket-that-does-not-exist'] = 'review'
  router.overrides.triggers[third.id] = 'wizard'
  router.overrides.triggers['om_999'] = 'review'
  const three = await host.acceptedTicket(third)
  expect(three.ticket.persona).toMatchObject({ personaId: 'implement', reasonCode: 'rule' })
  expect(router.inputs.at(-1)!.ticketId).toBe(three.ticket.id)
})

it('records one decision and one binding when one Ticket is started twice at once', async () => {
  const router = personaRouter()
  registerRouter(host, router)
  const trigger = feishu('20', '@bot 修一下回归')
  host.runtime.receive(trigger)
  await host.runtime.idle()
  const accept = () => host.route({ kind: 'accept', trigger_id: trigger.id, title: '修复回归', worktree_name: 'fix-regression',
    acknowledgement: '收到，修复回归。' })
  const [left, right] = await Promise.all([accept(), accept()])
  expect((left.ticket as { ticket_id: string }).ticket_id).toBe((right.ticket as { ticket_id: string }).ticket_id)
  const ticket = host.runtime.store.tickets.get((left.ticket as { ticket_id: string }).ticket_id)!
  expect(router.inputs).toHaveLength(1)
  expect(ticket.assignments).toHaveLength(1)
  expect(ticket.persona).toMatchObject({ personaId: 'implement', firstAssignmentId: ticket.assignments[0]!.id })
  expect(host.runtime.store.decisions.byThread(threadKey(trigger.threads[0]!)).filter(decision => decision.kind === 'accept')).toHaveLength(1)
})

it('binds two concurrent Tickets their own Personas', async () => {
  const router = personaRouter({ rule: input => input.triggerText.includes('研究') ? { persona: 'research', signal: 'wording' }
    : input.triggerText.includes('测试') ? { persona: 'test', signal: 'wording' } : undefined })
  registerRouter(host, router)
  const [one, two] = await Promise.all([host.acceptedTicket(feishu('40', '@bot 研究一下这个报错')), host.acceptedTicket(feishu('41', '@bot 跑一下测试'))])
  expect([one.ticket.persona!.personaId, two.ticket.persona!.personaId]).toEqual(['research', 'test'])
  expect(one.ticket.persona!.sectionText).toBe(catalogText('research'))
  expect(two.ticket.persona!.sectionText).toBe(catalogText('test'))
  expect(router.inputs.map(input => input.ticketId).sort()).toEqual([one.ticket.id, two.ticket.id].sort())
})

it('reuses the stored binding through a delivery failure, a retry, a worker restart and a host restart', async () => {
  const router = personaRouter({ fallback: 'research' })
  registerRouter(host, router)
  const { ticket } = await host.acceptedTicket(feishu('50', '@bot 研究一下这个回归'))
  const binding = ticket.persona!
  expect(binding.personaId).toBe('research')
  const stored = () => host.runtime.store.tickets.get(ticket.id)!
  // A failed Input delivery makes the Ticket retryable; the retry starts a new Assignment under the same Mandate.
  const running = stored().assignments.at(-1)!
  host.runtime.engine.deliveryFailed(ticket.id, running.id, 'feishu: message recalled')
  expect(stored().delivery).toBeDefined()
  host.runtime.engine.retryTicket(ticket.id)
  await host.settle()
  expect(stored().persona).toEqual(binding)
  // An interrupted running Assignment (a host restart in-process) starts a new one.
  const current = stored().assignments.at(-1)!
  host.runtime.engine.assignmentInterrupted(ticket.id, current.id)
  await host.settle()
  expect(stored().assignments.length).toBeGreaterThan(2)
  expect(stored().persona).toEqual(binding)
  // A host restart over the same state directory reads the same binding and decides nothing again.
  await host.restart()
  await host.settle()
  expect(host.runtime.store.tickets.get(ticket.id)!.persona).toEqual(binding)
  expect(router.inputs).toHaveLength(1)
})

it('leaves a historical Ticket without a Persona, also after a host restart', async () => {
  const router = personaRouter()
  registerRouter(host, router)
  const { ticket, sessionId } = await host.acceptedTicket(feishu('60', '@bot 修一下回归'))
  // A Ticket written before routing has no `persona` field; drop it to model that stored record.
  const { persona: _persona, ...historical } = host.runtime.store.tickets.get(ticket.id)!
  host.runtime.store.tickets.save(historical as Ticket)
  await host.settle()
  expect(host.runtime.store.tickets.get(ticket.id)!.persona).toBeUndefined()
  expect(personaSectionOf(host, sessionId)).toBe('')
  // The router is never asked to bind it retroactively, not even when a host restart decorates its Worker Session again.
  await host.restart()
  await host.settle()
  expect(host.runtime.store.tickets.get(ticket.id)!.persona).toBeUndefined()
  expect(router.inputs).toHaveLength(1)
  expect(personaSectionOf(host, sessionId)).toBe('')
})

it('reports the Worker\'s real capability to the router', async () => {
  const router = personaRouter()
  registerRouter(host, router)
  const current = host.runtime.store.settings()
  host.runtime.store.saveSettings({ ...current, executor: { ...current.executor,
    model: { provider: 'test-provider', model: 'test-model' }, maxWorkers: 5 } })
  await host.acceptedTicket(feishu('15', '@bot 修一下回归'))
  expect(router.inputs.at(-1)!.worker).toEqual({ provider: 'test-provider', model: 'test-model',
    tools: expect.arrayContaining(['read', 'write', 'edit', 'bash']), maxWorkers: 5, permissions: 'danger-full-access' })
})

it('exposes the Persona audit through the Ticket detail view and the management API', async () => {
  const router = personaRouter()
  registerRouter(host, router)
  const { ticket } = await host.acceptedTicket(feishu('16', '@bot 修一下回归'))
  const detail = ticketDetail({ store: host.runtime.store, sources: host.runtime.sources, links: host.runtime.links() }, ticket.id)!
  expect(detail.persona).toEqual(ticket.persona)
  const response = await host.api('GET', `tickets/${ticket.id}`)
  expect(response.status).toBe(200)
  expect((response.body as { persona: unknown }).persona).toEqual(ticket.persona)
})

it('keeps native behavior with no router: no binding and no routing decision', async () => {
  // `host` was started without a registered router.
  const { ticket, sessionId } = await host.acceptedTicket(feishu('70', '@bot 修一下回归'))
  expect(ticket.persona).toBeUndefined()
  expect(host.runtime.store.tickets.get(ticket.id)!.persona).toBeUndefined()
  expect(personaSectionOf(host, sessionId)).toBe('')
})
