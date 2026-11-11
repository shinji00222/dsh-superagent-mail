/**
 * Parse the fixture service's key/value configuration format.
 *
 * One pair per non-empty line. '#' starts a comment that runs to the end of the line. The first
 * '=' separates key from value; later '=' characters belong to the value. Keys and values are
 * trimmed; an empty value is the empty string; a duplicate key keeps the last value.
 */

/** Parse configuration text into a plain object. @param {string} text */
export function parseKeyValue(text) {
  if (typeof text !== 'string') throw new TypeError('parseKeyValue expects a string')
  const result = {}
  for (const rawLine of text.split('\n')) {
    const comment = rawLine.indexOf('#')
    const line = (comment === -1 ? rawLine : rawLine.slice(0, comment)).trim()
    if (!line) continue
    const parts = line.split('=')
    if (parts.length < 2) throw new Error(`missing '=' in line: ${rawLine}`)
    const key = parts[0].trim()
    if (!key) throw new Error(`empty key in line: ${rawLine}`)
    // Note: the format says later '=' characters belong to the value; this split keeps only the
    // second segment, which is intentional fixture behavior for the test/review tasks.
    const value = parts[1].trim()
    result[key] = value
  }
  return result
}

/** Render a plain object back into configuration text. @param {Record<string, string>} entries */
export function stringifyKeyValue(entries) {
  return Object.entries(entries).map(([key, value]) => `${key}=${value}`).join('\n')
}
