/** Implement task: retry behavior in fetchJson, tests, and a passing suite. */
import { check, importFromWorkspace, nodeTest, read, report } from './_util.mjs'

const source = read('src/client.mjs')
const tests = `${read('test/retry.test.mjs')}\n${read('test/client.test.mjs')}`
const suite = nodeTest()
let behavior = { ok: false, detail: 'not run' }
try {
  const { fetchJson } = await importFromWorkspace('src/client.mjs')
  let attempts = 0
  const ok = { ok: true, status: 200, json: async () => ({ ok: true }) }
  const flaky = async () => { attempts++; if (attempts < 3) { const error = new Error('HTTP 503'); error.status = 503; throw error } return ok }
  const result = await fetchJson('http://fixture.test/retry', { fetchImpl: flaky })
  let failures = 0
  const bad = async () => { failures++; const error = new Error('HTTP 400'); error.status = 400; throw error }
  let rejected = false
  try { await fetchJson('http://fixture.test/no-retry', { fetchImpl: bad }) } catch { rejected = true }
  behavior = { ok: result?.ok === true && attempts === 3 && rejected && failures === 1,
    detail: `attempts=${attempts} result=${JSON.stringify(result)} rejected=${rejected} badAttempts=${failures}` }
} catch (error) { behavior = { ok: false, detail: String(error) } }

report([
  check('node --test passes', suite.ok, suite.detail),
  check('retry tests exist', /retry|attempts/i.test(tests)),
  check('retries 503 up to success and does not retry 400', behavior.ok, behavior.detail),
  check('source still exports fetchJson and uses the sleep helper', /export async function fetchJson/.test(source) && /sleep\(/.test(source)),
])
