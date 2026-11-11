/** Pin and verify the fixed repository snapshot used by every experiment arm.
 *  Usage: node experiments/tasks/snapshot.mjs [--write] [--verify]
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = join(here, '..', 'fixture')
const pinned = join(here, 'snapshot.json')

export function walk(root, current = root, files = []) {
  for (const name of readdirSync(current).sort()) {
    const path = join(current, name)
    if (statSync(path).isDirectory()) walk(root, path, files)
    else files.push(relative(root, path).split(sep).join('/'))
  }
  return files
}
export const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export function snapshot() {
  const files = {}
  for (const name of walk(fixture)) files[name] = sha256(readFileSync(join(fixture, name)))
  const digest = sha256(Object.entries(files).map(([name, hash]) => `${name}:${hash}`).join('\n'))
  return { version: 1, fixture: 'experiments/fixture', digest, files }
}

const mode = process.argv[2]
if (mode === '--write') {
  const value = snapshot()
  writeFileSync(pinned, `${JSON.stringify(value, null, 2)}\n`)
  console.log(`pinned ${Object.keys(value.files).length} files, digest ${value.digest}`)
} else if (mode === '--verify' || mode === undefined) {
  const current = snapshot()
  let expected
  try { expected = JSON.parse(readFileSync(pinned, 'utf8')) } catch { console.error('snapshot.json is missing; run --write'); process.exit(1) }
  const changed = Object.keys(current.files).filter(name => expected.files[name] !== current.files[name])
  const added = Object.keys(current.files).filter(name => expected.files[name] === undefined)
  const removed = Object.keys(expected.files).filter(name => current.files[name] === undefined)
  const ok = expected.digest === current.digest
  console.log(JSON.stringify({ ok, expected: expected.digest, current: current.digest, changed, added, removed }, null, 2))
  process.exit(ok ? 0 : 1)
}
