/** Read-only research task: findings document, no source/test edits. */
import { check, containsAll, hasFile, read, report, unchanged } from './_util.mjs'

const doc = read('docs/findings.md')
const missing = containsAll(doc, ['parseKeyValue', 'fetchJson', 'retr|失败|failure|backoff'])
const untouched = unchanged(['src', 'test'])
report([
  check('docs/findings.md exists', hasFile('docs/findings.md')),
  check('findings name the parser, the client and the missing retry behavior', missing.length === 0, `missing: ${missing.join(', ')}`),
  check('findings are substantive (>= 20 non-empty lines)', doc.split('\n').filter(line => line.trim()).length >= 20),
  check('no source or test file was modified', untouched.clean, untouched.detail),
])
