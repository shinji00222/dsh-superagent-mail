/** Plan-only task: docs/plan.md with the required sections, no source/test edits. */
import { check, containsAll, hasFile, read, report, unchanged } from './_util.mjs'

const doc = read('docs/plan.md')
const missing = containsAll(doc, ['steps', 'files', 'risks', 'test plan'])
const untouched = unchanged(['src', 'test'])
report([
  check('docs/plan.md exists', hasFile('docs/plan.md')),
  check('plan has Steps/Files/Risks/Test plan sections', missing.length === 0, `missing: ${missing.join(', ')}`),
  check('plan is substantive (>= 15 non-empty lines)', doc.split('\n').filter(line => line.trim()).length >= 15),
  check('no source or test file was modified', untouched.clean, untouched.detail),
])
