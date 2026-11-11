/** Review task: a review document that finds the seeded blocking defects; no source/test edits. */
import { check, containsAll, hasFile, read, report, unchanged } from './_util.mjs'

const doc = read('docs/review.md')
const groups = {
  'a null/undefined dereference': /null|undefined/i,
  'a missing await on an async call': /await|async/i,
  'an off-by-one loop bound': /off.by.one|<=|out.of.bounds|last page|empty page/i,
  'the unawaited response.json()': /json\(\)|body|response/i,
  'a file:line reference': /[A-Za-z0-9_-]+\.mjs:\d+/,
}
const missing = Object.entries(groups).filter(([, pattern]) => !pattern.test(doc)).map(([name]) => name)
const untouched = unchanged(['src', 'test'])
report([
  check('docs/review.md exists', hasFile('docs/review.md')),
  check('review groups findings by severity', /blocking/i.test(doc) && /major/i.test(doc)),
  check('review finds at least 4 of the 5 seeded defect signals', missing.length <= 1, `missing: ${missing.join(', ')}`),
  check('no source or test file was modified', untouched.clean, untouched.detail),
])
