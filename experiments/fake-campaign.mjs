#!/usr/bin/env node
/**
 * Portable A-D fake-model campaign for the fixed experiment fixture.
 * This exercises config, routing, snapshot, artifact checkers and evidence only.
 * It is not a DSH runtime run and cannot measure model quality.
 */
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(fileURLToPath(new URL('.', import.meta.url)))
const root = resolve(here, '..')
const tasks = JSON.parse(readFileSync(join(here, 'tasks', 'tasks.json'), 'utf8')).tasks
const fixture = join(here, 'fixture')
const router = await import('../packages/persona-router/lib/index.js')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const outRoot = resolve(root, arg('--out', join('experiments', 'runs', `fake-campaign-${stamp}`)))
const seed = arg('--seed', '20261111')
const model = 'fake-deterministic-v1'
const permissions = 'danger-full-access'
const budget = { maxWorkers: 3, maxTokens: 12000 }
const arms = [
  { id: 'A', mode: 'off', bundle: false },
  { id: 'B', mode: 'fixed', bundle: true, persona: 'implement' },
  { id: 'C', mode: 'random', bundle: true, seed },
  { id: 'D', mode: 'rules', bundle: true },
]

function hashFile(path) { return createHash('sha256').update(readFileSync(path)).digest('hex') }
function snapshotDigest() {
  const snapshot = JSON.parse(readFileSync(join(here, 'tasks', 'snapshot.json'), 'utf8'))
  const current = {}
  for (const [name] of Object.entries(snapshot.files)) current[name] = hashFile(join(fixture, name))
  const digest = createHash('sha256').update(Object.entries(current).map(([name, hash]) => `${name}:${hash}`).join('\n')).digest('hex')
  if (digest !== snapshot.digest) throw new Error(`fixture snapshot mismatch: expected ${snapshot.digest}, got ${digest}`)
  return digest
}
function git(cwd, args) { execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' }) }
function initWorkspace(path) {
  cpSync(fixture, path, { recursive: true })
  git(path, ['init', '-q'])
  git(path, ['config', 'user.email', 'fake-campaign@example.invalid'])
  git(path, ['config', 'user.name', 'Fake campaign'])
  git(path, ['add', '.'])
  git(path, ['commit', '-qm', 'fixture snapshot'])
}
function inputFor(task, ticketId) {
  return {
    ticketId, triggerId: `trigger-${task.id}`, triggerText: task.prompt,
    title: task.id, assignment: task.prompt, acceptance: 'explicit', rules: [],
    worker: { provider: 'fake', model, tools: ['read', 'write', 'edit', 'bash'], maxWorkers: 3, permissions },
  }
}
function decisionFor(arm, input) {
  if (arm.mode === 'off') return null
  const settings = router.normalizeConfig({ mode: arm.mode, ...(arm.persona ? { persona: arm.persona } : {}), ...(arm.seed ? { seed: arm.seed } : {}) })
  return router.createRouter(settings).route(input)
}
function write(path, value) { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, value) }
function generateArtifact(task, workspace) {
  if (task.id === 'research') write(join(workspace, 'docs/findings.md'), `# Fixture findings\n\n## parseKeyValue\n\n- Accepts one key/value pair per non-empty line.\n- Trims keys and values.\n- Uses the first equals sign as the separator and preserves later equals signs.\n- Removes trailing comments beginning with #.\n- Allows an empty value.\n- A duplicate key keeps the last value.\n\n## fetchJson\n\n- Calls the injected fetch implementation.\n- Requires a successful HTTP response.\n- Parses the response JSON body.\n- The current implementation has no retry loop.\n\n## Retry risks\n\n1. Retrying non-transient errors can amplify failures and load.\n2. A missing abort check can delay cancellation and waste budget.\n3. Unbounded or incorrectly timed backoff can make latency unpredictable.\n4. A retry may repeat side effects when a request is not idempotent.\n5. Logging must distinguish the first failure from the final failure.\n6. Tests should inject fetch and sleep so timing stays deterministic.\n7. Retry limits should remain visible to callers and operators.\n`)
  if (task.id === 'plan') write(join(workspace, 'docs/plan.md'), `# Exponential-backoff retry plan\n\n## Steps\n\n1. Keep the public fetchJson signature unchanged.\n2. Classify HTTP 408, 429, 5xx and transient network errors.\n3. Retry at most three total attempts with bounded exponential delays.\n4. Stop immediately for permanent errors and abort signals.\n\n## Files\n\n- src/client.mjs: retry loop and error policy.\n- test/retry.test.mjs: injected-fetch behavior tests.\n\n## Risks\n\n- Retries can duplicate a non-idempotent request.\n- Backoff can increase wall-clock latency.\n- Abort handling must clear timers.\n\n## Test plan\n\n- Verify 503 succeeds on the third attempt.\n- Verify 400 is not retried.\n- Verify a network error is retried and a permanent error is surfaced.\n- Run node --test.\n`)
  if (task.id === 'implement') {
    write(join(workspace, 'src/client.mjs'), `/** Resolve after ms, rejecting when the signal aborts. */\nexport function sleep(ms, signal) {\n  return new Promise((resolve, reject) => {\n    if (signal?.aborted) { reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); return }\n    const timer = setTimeout(resolve, ms)\n    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')) }, { once: true })\n  })\n}\nexport function isTransient(error) {\n  const status = error?.status\n  return typeof status === 'number' ? status === 408 || status === 429 || status >= 500 : /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|socket hang up/i.test(String(error?.message ?? error))\n}\nasync function attempt(url, { fetchImpl, signal, timeoutMs }) {\n  const controller = new AbortController()\n  const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs)\n  try {\n    const response = await fetchImpl(url, { signal: controller.signal })\n    if (!response.ok) { const error = new Error("HTTP " + response.status + " for " + url); error.status = response.status; throw error }\n    return await response.json()\n  } finally { clearTimeout(timer) }\n}\nexport async function fetchJson(url, { fetchImpl = fetch, signal, timeoutMs = 5000 } = {}) {\n  for (let attemptNumber = 0; ; attemptNumber++) {\n    try { return await attempt(url, { fetchImpl, signal, timeoutMs }) }\n    catch (error) {\n      if (!isTransient(error) || attemptNumber >= 2) throw error\n      await sleep(10 * 2 ** attemptNumber, signal)\n    }\n  }\n}\n`)
    write(join(workspace, 'test/retry.test.mjs'), `import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { fetchJson } from '../src/client.mjs'\ntest('retries transient 503 twice', async () => { let calls = 0; const result = await fetchJson('http://fixture.test', { fetchImpl: async () => { calls++; if (calls < 3) { const e = new Error('HTTP 503'); e.status = 503; throw e }; return { ok: true, json: async () => ({ ok: true }) } } }); assert.deepEqual(result, { ok: true }); assert.equal(calls, 3) })\ntest('does not retry 400', async () => { let calls = 0; await assert.rejects(() => fetchJson('http://fixture.test', { fetchImpl: async () => { calls++; const e = new Error('HTTP 400'); e.status = 400; throw e } })); assert.equal(calls, 1) })\n`)
  }
  if (task.id === 'test') {
    const source = readFileSync(join(workspace, 'src/parser.mjs'), 'utf8').replace("const parts = line.split('=')\n    if (parts.length < 2) throw new Error(`missing '=' in line: ${rawLine}`)\n    const key = parts[0].trim()\n    if (!key) throw new Error(`empty key in line: ${rawLine}`)\n    // Note: the format says later '=' characters belong to the value; this split keeps only the\n    // second segment, which is intentional fixture behavior for the test/review tasks.\n    const value = parts[1].trim()", "const separator = line.indexOf('=')\n    if (separator < 0) throw new Error(`missing '=' in line: ${rawLine}`)\n    const key = line.slice(0, separator).trim()\n    if (!key) throw new Error(`empty key in line: ${rawLine}`)\n    const value = line.slice(separator + 1).trim()")
    write(join(workspace, 'src/parser.mjs'), source)
    write(join(workspace, 'test/edge-cases.test.mjs'), `import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { parseKeyValue } from '../src/parser.mjs'\ntest('keeps = inside value', () => assert.equal(parseKeyValue('a=b=c').a, 'b=c'))\ntest('removes trailing comment', () => assert.equal(parseKeyValue('key=value # comment').key, 'value'))\ntest('accepts empty value', () => assert.equal(parseKeyValue('empty=').empty, ''))\ntest('duplicate keeps last', () => assert.equal(parseKeyValue('a=1\\na=2').a, '2'))\n`)
  }
  if (task.id === 'review') write(join(workspace, 'docs/review.md'), `# Review findings\n\n## Blocking\n\n- **Null/undefined dereference** — src/accounts.mjs:13: account.owner.email crashes for a missing account or owner. Guard the object before reading email.\n\n- **Missing await on async call** — src/accounts.mjs:17: response.json() returns a Promise, so await it before reading accounts.\n\n## Major\n\n- **Off-by-one loop bound** — src/accounts.mjs:23: <= rows.length creates an empty final page. Use less than rows.length.\n\n- **Unawaited response.json()** — src/accounts.mjs:17: the body is a Promise and body.accounts is undefined.\n\n## Minor\n\n- **Unsafe session access** — src/session.mjs:5: session.user.name crashes when user is absent; preserve the anonymous fallback.\n\nEach finding includes a file:line location and a concrete fix.\n`)
}

const digest = snapshotDigest()
mkdirSync(outRoot, { recursive: true })
const summary = { schema: 1, kind: 'fake-model-mechanism-campaign', model, seed, snapshot: digest, permissions, budget, arms: [], startedAt: new Date().toISOString() }
for (const arm of arms) {
  const armSummary = { arm: arm.id, mode: arm.mode, runs: [] }
  for (const task of tasks) {
    const runId = `${arm.id}-${task.id}`
    const runDir = join(outRoot, arm.id, task.id)
    const workspace = join(runDir, 'workspace')
    mkdirSync(runDir, { recursive: true })
    initWorkspace(workspace)
    const input = inputFor(task, `ticket-${runId}`)
    const started = Date.now()
    const decision = decisionFor(arm, input)
    const repeat = arm.mode === 'random' ? decisionFor(arm, input) : decision
    const reproducible = JSON.stringify(decision) === JSON.stringify(repeat)
    const config = { arm: arm.id, mode: arm.mode, bundleLoaded: arm.bundle, taskId: task.id, model, budget, permissions, snapshot: digest, flow: 'fixed fixture -> fake model -> artifact -> checker' }
    write(join(runDir, 'config.json'), JSON.stringify(config, null, 2) + '\n')
    write(join(runDir, 'decision.json'), JSON.stringify({ decision, reproducible }, null, 2) + '\n')
    generateArtifact(task, workspace)
    const fakeTokens = 120 + task.prompt.length + (decision?.sectionText?.length ?? 0)
    write(join(runDir, 'model-log.jsonl'), JSON.stringify({ model, taskId: task.id, arm: arm.id, prompt: task.prompt, personaInjected: decision?.personaId ?? null, usage: { promptTokens: fakeTokens, completionTokens: 80, totalTokens: fakeTokens + 80 }, placeholder: true }) + '\n')
    const checker = spawnSync(process.execPath, [join(root, task.checker), workspace], { cwd: root, encoding: 'utf8' })
    const checkerOutput = `${checker.stdout ?? ''}${checker.stderr ?? ''}`
    let checkerResult
    try { checkerResult = JSON.parse(checkerOutput) } catch { checkerResult = { pass: false, parseError: true, output: checkerOutput.slice(-4000) } }
    const result = { schema: 1, runId, arm: arm.id, taskId: task.id, snapshot: digest, decision, reproducible, acceptance: checkerResult, durationMs: Date.now() - started, usage: { promptTokens: fakeTokens, completionTokens: 80, totalTokens: fakeTokens + 80, kind: 'deterministic-placeholder-not-model-measurement' }, log: 'model-log.jsonl' }
    write(join(runDir, 'result.json'), JSON.stringify(result, null, 2) + '\n')
    armSummary.runs.push({ taskId: task.id, runId, pass: checkerResult.pass === true, persona: decision?.personaId ?? null, reproducible, durationMs: result.durationMs, totalTokens: result.usage.totalTokens })
  }
  summary.arms.push(armSummary)
}
summary.finishedAt = new Date().toISOString()
write(join(outRoot, 'campaign.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ out: outRoot, snapshot: digest, arms: summary.arms.map(arm => ({ arm: arm.arm, passed: arm.runs.filter(run => run.pass).length, total: arm.runs.length, randomReproducible: arm.runs.filter(run => arm.arm === 'C').every(run => run.reproducible) })) }, null, 2))