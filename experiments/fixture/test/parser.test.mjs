import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseKeyValue, stringifyKeyValue } from '../src/parser.mjs'

test('parses simple pairs, ignores blank lines and comments', () => {
  assert.deepEqual(parseKeyValue('a=1\n\n# note\nb = 2\n'), { a: '1', b: '2' })
})

test('treats an empty value as the empty string', () => {
  assert.deepEqual(parseKeyValue('empty=\n'), { empty: '' })
})

test('round-trips a plain object', () => {
  const entries = { host: 'localhost', port: '8080' }
  assert.deepEqual(parseKeyValue(stringifyKeyValue(entries)), entries)
})

test('rejects a line without a separator and an empty key', () => {
  assert.throws(() => parseKeyValue('just-a-key\n'), /missing '='/)
  assert.throws(() => parseKeyValue('=value\n'), /empty key/)
})
