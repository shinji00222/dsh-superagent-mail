/** Test task: four parser edge cases covered, suite passes, and the exposed '=' bug is fixed. */
import { check, importFromWorkspace, nodeTest, read, report } from './_util.mjs'

const source = read('src/parser.mjs')
const tests = read('test/edge-cases.test.mjs')
const suite = nodeTest()
let cases = { ok: false, detail: 'not run' }
try {
  const { parseKeyValue } = await importFromWorkspace('src/parser.mjs')
  const observed = {
    equalsInValue: parseKeyValue('a=b=c'),
    trailingComment: parseKeyValue('key=value # comment'),
    emptyValue: parseKeyValue('empty='),
    duplicate: parseKeyValue('a=1\na=2'),
  }
  const ok = observed.equalsInValue.a === 'b=c' && observed.trailingComment.key === 'value'
    && observed.emptyValue.empty === '' && observed.duplicate.a === '2'
  cases = { ok, detail: JSON.stringify(observed) }
} catch (error) { cases = { ok: false, detail: String(error) } }

report([
  check('node --test passes', suite.ok, suite.detail),
  check('edge-case test file covers all four cases',
    /'='|inside/i.test(tests) && /comment/i.test(tests) && /empty/i.test(tests) && /duplicate/i.test(tests)),
  check("parser keeps '=' inside values and the other three cases behave", cases.ok, cases.detail),
  check('the parser source was changed by the fix', source.includes('indexOf') || source.includes('slice(') ),
])
