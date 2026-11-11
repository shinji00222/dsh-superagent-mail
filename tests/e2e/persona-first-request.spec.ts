/**
 * Acceptance test for docs/009-persona-routing.md item 1 on a REAL, isolated DSH profile.
 *
 * It executes `experiments/e2e/run.mjs`, which boots the installed DSH 0.2.1-rc.5 web profile with
 * the built `dsh-superagent` and `dsh-superagent-persona-router` bundles, a recording fake LLM
 * adapter, and a driver that injects one Trigger through `runtime.receive` (the Source entry point).
 * The production chain then runs Intake -> Eval -> candidate delivery to the main Session -> scripted
 * `orchestrator_route` accept tool call -> Engine.decide -> Tickets.create (Persona bound in the
 * same transaction) -> launch effect -> Worker Session -> its first model request.
 *
 * The spec asserts against the captured request files and the evidence JSON, never against anything
 * the harness could have asserted for the Runtime: the model request bodies are the real ones DSH
 * assembled, persisted by the adapter before it replies.
 *
 * Run standalone:
 *   node experiments/e2e/run.mjs          # prints the evidence path
 *   pnpm exec vitest run tests/e2e       # boots one isolated run and asserts it
 * Set E2E_SKIP=1 to skip (e.g. no installed DSH CLI on the machine).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const runsDir = join(repoRoot, 'experiments/e2e/runs')
const runner = join(repoRoot, 'experiments/e2e/run.mjs')
const skip = process.env.E2E_SKIP === '1'

interface CapturedRequest {
  file: string
  sha256: string
  n: number
  at: string
  sessionId: string
  purpose: string | null
  system: string
  messages: { role: string; content: { type: string; text?: string }[] }[]
}

interface RequestDigest {
  file: string
  sha256: string
  n: number
  at: string
  sessionId: string
  purpose: string | null
  containsPersonaHeader: boolean
  containsSnapshot: boolean
}

interface Evidence {
  schema: string
  generatedAt: string
  passed: boolean
  assertions: Record<string, boolean>
  masterSessionId: string
  personaHeader: string
  captureDir: string
  ticket: {
    id: string
    createdAt: string
    firstAssignmentId: string
    workerSessionId: string
    persona: {
      personaId: string
      personaVersion: string
      sectionText: string
      reasonCode: string
      signals: Record<string, string>
      routerId: string
      workerSessionId: string
      firstAssignmentId: string
      decidedAt: string
      acceptance: string
    }
  }
  workerFirstRequest: { file: string; sha256: string; sessionId: string; n: number; at: string }
  requests: RequestDigest[]
}

const evidenceOf = (path: string): Evidence => JSON.parse(readFileSync(path, 'utf8')) as Evidence

/** The evidence written by the run this spec just executed (newest evidence.json). */
function latestEvidence(): string | undefined {
  if (!existsSync(runsDir)) return undefined
  return readdirSync(runsDir)
    .map((name) => join(runsDir, name, 'evidence.json'))
    .filter((path) => existsSync(path))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
    .at(0)
}

const digest = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const systemOf = (request: CapturedRequest): string => request.system

describe.skipIf(skip)('docs/009 item 1: Persona binding reaches the Worker first model request', () => {
  let evidencePath = ''
  let evidence: Evidence
  let workerFirst: CapturedRequest
  let mainRequests: CapturedRequest[]

  beforeAll(() => {
    const before = latestEvidence()
    const beforeMtime = before === undefined ? 0 : statSync(before).mtimeMs
    // stdio: 'inherit' avoids the piped stdio this Windows sandbox refuses for child processes.
    const result = spawnSync(process.execPath, [runner, '--timeout', '150'], { cwd: repoRoot, stdio: 'inherit', timeout: 300_000 })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`experiments/e2e/run.mjs exited with ${String(result.status)}; inspect ${runsDir} for the run's dsh.log/driver.log`)
    const found = latestEvidence()
    if (found === undefined) throw new Error(`no evidence.json under ${runsDir}`)
    evidencePath = found
    if (beforeMtime !== 0 && statSync(evidencePath).mtimeMs < beforeMtime) throw new Error(`the run wrote no new evidence.json (still ${evidencePath})`)
    evidence = evidenceOf(evidencePath)
  }, 300_000)

  it('the isolated-profile run passed every recorded assertion', () => {
    expect(evidence.passed, evidencePath).toBe(true)
    expect(Object.values(evidence.assertions).every(Boolean)).toBe(true)
    expect(evidence.schema).toBe('dsh-superagent-e2e/persona-first-request/1')
  })

  it('the Ticket audit carries the exact Persona snapshot before the Worker Session first calls the model', () => {
    const { persona } = evidence.ticket
    expect(persona).toMatchObject({
      personaId: 'implement',
      reasonCode: 'rule',
      signals: { rule: 'implement-request', field: 'triggerText' },
    })
    expect(evidence.personaHeader).toBe(`[dsh-superagent persona ${persona.personaId}@${persona.personaVersion}]`)
    expect(persona.sectionText.startsWith(evidence.personaHeader)).toBe(true)
    expect(persona.workerSessionId).toBe(evidence.ticket.workerSessionId)
    expect(persona.firstAssignmentId).toBe(evidence.ticket.firstAssignmentId)
    expect(persona.acceptance).toBe('explicit')
    // The binding was committed before the Worker's first request was assembled.
    expect(persona.decidedAt <= evidence.workerFirstRequest.at).toBe(true)
  })

  it('the Worker first captured request contains the audited snapshot and the main Session never does', () => {
    workerFirst = JSON.parse(readFileSync(evidence.workerFirstRequest.file, 'utf8')) as CapturedRequest
    // A first request is the first capture of that Session, not just any request of it.
    const workerRequests = evidence.requests.filter((request) => request.sessionId === evidence.ticket.workerSessionId)
    expect(workerRequests.length).toBeGreaterThan(0)
    expect(workerRequests[0]?.n).toBe(
      [...evidence.requests].filter((request) => request.sessionId === evidence.ticket.workerSessionId).sort((left, right) => left.n - right.n)[0]?.n,
    )
    expect(workerFirst.sessionId).toBe(evidence.ticket.workerSessionId)
    expect(evidence.workerFirstRequest.sha256).toBe(digest(evidence.workerFirstRequest.file))

    const system = systemOf(workerFirst)
    expect(system).toContain(evidence.personaHeader)
    expect(system).toContain(evidence.ticket.persona.sectionText)

    mainRequests = evidence.requests
      .filter((request) => request.sessionId === evidence.masterSessionId)
      .map((request) => JSON.parse(readFileSync(request.file, 'utf8')) as CapturedRequest)
    expect(mainRequests.length).toBeGreaterThan(0)
    for (const request of mainRequests) {
      expect(systemOf(request)).not.toContain(evidence.personaHeader)
      expect(systemOf(request)).not.toContain(evidence.ticket.persona.sectionText)
    }
  })
})
