/**
 * Driver for the isolated-profile e2e (docs/009 acceptance item 1).
 *
 * It runs inside a real, isolated DSH profile next to the real dsh-superagent Runtime:
 *  1. waits for the Runtime to be configured (the profile state is seeded with a resolved
 *     deployment, and the scripted subprocess boundary answers Setup's probes);
 *  2. injects one Trigger through `runtime.receive(trigger)`, the very entry point Source
 *     plugins use (`SourceContext.receive` -> `Passes.receive` -> `Engine.receive`);
 *  3. lets the production chain run: Intake -> Eval -> candidate delivery to the main Session ->
 *     scripted main-Session `orchestrator_route` accept tool call -> Engine.decide ->
 *     Tickets.create (Persona bound in the same transaction) -> launch effect -> worker Session;
 *  4. waits until the recording fake model has captured the Worker Session's FIRST request;
 *  5. writes `evidence.json` with the Ticket audit record, the request files/digests and the
 *     assertions, then exits the process 0 or 1.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'e2e-driver'
export const inject = []

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const iso = () => new Date().toISOString()

/** Poll `probe` until it returns a truthy value or the deadline passes. */
async function waitFor(probe, deadline, interval = 200) {
  for (;;) {
    const value = await probe()
    if (value !== undefined && value !== null && value !== false) return value
    if (Date.now() > deadline) return undefined
    await sleep(interval)
  }
}

/** All captured requests in call order, each with its persisted file and digest. */
function captured(runDir) {
  const directory = join(runDir, 'captures')
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter((file) => /^request-\d+\.json$/.test(file))
    .sort()
    .map((file) => {
      const path = join(directory, file)
      const raw = readFileSync(path, 'utf8')
      const parsed = JSON.parse(raw)
      return { file: path, sha256: sha256(raw), ...parsed }
    })
}

const headerOf = (persona) => `[dsh-superagent persona ${persona.personaId}@${persona.personaVersion}]`

export function apply(ctx, config = {}) {
  const runDir = config.runDir
  if (!runDir) throw new Error('e2e-driver: config.runDir is required')
  mkdirSync(runDir, { recursive: true })
  const log = (message) => appendFileSync(join(runDir, 'driver.log'), `${iso()} ${message}\n`)
  const fail = (error) => {
    try {
      writeFileSync(join(runDir, 'driver-error.txt'), String(error?.stack ?? error))
      log(`FAILED ${String(error?.stack ?? error)}`)
    } finally {
      setTimeout(() => process.exit(1), 200)
    }
  }
  // Mounting must not hold the loader; the Runtime this driver observes is mounted after this layer.
  Promise.resolve().then(() => run(ctx, config, log)).catch(fail)
}

async function run(ctx, config, log) {
  const timeoutMs = config.timeoutMs ?? 150_000
  const deadline = Date.now() + timeoutMs
  log(`waiting for the orchestrator service (timeout ${timeoutMs} ms)`)
  const orchestrator = await waitFor(() => ctx.get('orchestrator'), deadline, 100)
  if (!orchestrator) throw new Error('dsh-superagent never provided ctx.orchestrator in this profile')
  await orchestrator.ready
  log(`runtime ready; configured=${String(orchestrator.configured())} setupProblem=${JSON.stringify(orchestrator.setupProblem ?? null)}`)
  if (!orchestrator.configured()) {
    throw new Error(`dsh-superagent is not configured in the isolated profile: ${JSON.stringify(orchestrator.setupProblem ?? null)}`)
  }

  const triggerId = config.triggerId ?? `e2e-trigger-${Date.now()}`
  const trigger = {
    id: triggerId,
    source: 'e2e',
    threads: [{ source: 'e2e', id: config.threadId ?? 'e2e-thread-1' }],
    actor: { source: 'e2e', id: 'e2e-user' },
    human: true,
    addressed: 'direct',
    at: iso(),
    text: config.triggerText ?? 'Please add a regression test for the persona binding and report what changed.',
    meta: {},
  }
  log(`injecting trigger ${triggerId} through runtime.receive (the Source entry point)`)
  const received = orchestrator.receive(trigger)
  log(`receive -> ${JSON.stringify(received)}`)

  // Let the production pass pipeline run: Eval -> assessment candidate -> main Session -> tool call.
  let ticket
  while (!ticket) {
    if (Date.now() > deadline) throw new Error('no Ticket was created from the injected Trigger before the timeout')
    await orchestrator.pump?.().catch(() => {})
    ticket = orchestrator.store.tickets.list().find((item) => item.origin?.triggerId === triggerId)
    if (!ticket) await sleep(250)
  }
  log(`ticket ${ticket.id} created; persona=${JSON.stringify(ticket.persona ?? null)}`)

  const persona = ticket.persona
  if (!persona) throw new Error(`Ticket ${ticket.id} has no persona binding; the routing Bundle may not be registered`)
  const workerSessionId = persona.workerSessionId ?? `worker-${ticket.id}`
  const firstAssignmentId = ticket.assignments?.[0]?.id

  const workerFirst = await waitFor(() => {
    const requests = captured(config.runDir).filter((request) => request.sessionId === workerSessionId)
    return requests.length ? requests[0] : undefined
  }, deadline, 250)
  if (!workerFirst) throw new Error(`no model request was captured for the Worker Session ${workerSessionId} before the timeout`)

  // Wait one beat so any request racing the worker's first one is on disk, then classify.
  await sleep(500)
  const requests = captured(config.runDir)
  const workerRequests = requests.filter((request) => request.sessionId === workerSessionId)
  const mainRequestIds = new Set([orchestrator.masterId])
  const mainRequests = requests.filter((request) => mainRequestIds.has(request.sessionId))
  const header = headerOf(persona)

  const assertions = {
    /** The binding exists on the Ticket's audit record and names the first Assignment and its Session. */
    ticketHasPersonaBinding: !!persona,
    bindingNamesFirstAssignment: persona.firstAssignmentId === firstAssignmentId,
    bindingNamesWorkerSession: persona.workerSessionId === `worker-${ticket.id}`,
    /** Durability BEFORE the first model call: the binding was decided no later than the worker request. */
    bindingPersistedBeforeWorkerRequest: String(persona.decidedAt) <= String(workerFirst.at),
    /** The Worker's FIRST request carries the exact audited snapshot. */
    workerFirstRequestSystemContainsSnapshot: String(workerFirst.system).includes(persona.sectionText),
    workerFirstRequestSystemContainsHeader: String(workerFirst.system).includes(header),
    /** The main Session's requests carry no Persona section at all. */
    mainSessionNeverContainsPersona: mainRequests.every((request) => !String(request.system).includes(header)
      && !String(request.system).includes(persona.sectionText)),
    mainSessionRequestCaptured: mainRequests.length > 0,
  }
  const evidence = {
    schema: 'dsh-superagent-e2e/persona-first-request/1',
    generatedAt: iso(),
    runId: config.runId ?? null,
    dshHome: config.dshHome ?? null,
    profile: config.profile ?? null,
    stateDir: config.stateDir ?? null,
    captureDir: join(config.runDir, 'captures'),
    trigger,
    ticket: {
      id: ticket.id,
      title: ticket.title,
      createdAt: ticket.createdAt,
      mandateStrength: ticket.mandate?.strength ?? null,
      firstAssignmentId,
      workerSessionId,
      persona,
    },
    masterSessionId: orchestrator.masterId,
    personaHeader: header,
    workerFirstRequest: {
      file: workerFirst.file,
      sha256: workerFirst.sha256,
      sessionId: workerFirst.sessionId,
      n: workerFirst.n,
      at: workerFirst.at,
      systemSha256: sha256(String(workerFirst.system)),
    },
    requests: requests.map((request) => ({
      file: request.file,
      sha256: request.sha256,
      n: request.n,
      at: request.at,
      sessionId: request.sessionId,
      purpose: request.purpose,
      systemSha256: sha256(String(request.system)),
      containsPersonaHeader: String(request.system).includes(header),
      containsSnapshot: String(request.system).includes(persona.sectionText),
    })),
    assertions,
    passed: Object.values(assertions).every(Boolean),
  }
  const evidencePath = join(config.runDir, 'evidence.json')
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
  log(`evidence written to ${evidencePath}; passed=${String(evidence.passed)}`)
  if (!evidence.passed) {
    log(`failed assertions: ${Object.entries(assertions).filter(([, value]) => !value).map(([key]) => key).join(', ')}`)
    setTimeout(() => process.exit(1), 200)
    return
  }
  setTimeout(() => process.exit(0), 200)
}
