// Minimal read-only ASAR reader for inspecting the installed DeepSeek Harness app.
// Usage:
//   node experiments/e2e/tools/asar.mjs <asar> list [prefix]
//   node experiments/e2e/tools/asar.mjs <asar> cat <virtual-path>
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ASAR_HEADER_SIZE_FIELD = 4

// Layout observed in the shipped app.asar (Chromium pickle prefix):
// u32 pickledSize(=4) | u32 headerSize | u32 jsonLength+4 | u32 jsonLength | JSON | data
// dataStart = 8 + headerSize, and JSON starts at 16.
function readHeader(blob) {
  if (blob.readUInt32LE(0) !== ASAR_HEADER_SIZE_FIELD) throw new Error('not an asar archive')
  const headerSize = blob.readUInt32LE(4)
  const jsonLength = blob.readUInt32LE(12)
  const start = 16
  const json = blob.subarray(start, start + jsonLength).toString('utf8')
  const parsed = JSON.parse(json)
  return { parsed, dataStart: 8 + headerSize }
}

function index(root) {
  const files = []
  const walk = (node, prefix) => {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name
      if (entry.files) walk(entry, path)
      else files.push({ path, size: entry.size ?? 0, offset: Number(entry.offset ?? 0), unpacked: !!entry.unpacked })
    }
  }
  walk(root, '')
  return files
}

const [, , asarPath, command, arg] = process.argv
if (!asarPath || !command) {
  console.error('usage: asar.mjs <asar> list [prefix] | cat <path>')
  process.exit(2)
}
const blob = readFileSync(asarPath)
const { parsed, dataStart } = readHeader(blob)
const files = index(parsed)

if (command === 'list') {
  const prefix = arg ?? ''
  for (const file of files) if (!prefix || file.path.startsWith(prefix)) console.log(`${file.size}\t${file.path}`)
} else if (command === 'cat') {
  const file = files.find(entry => entry.path === arg)
  if (!file) throw new Error(`no such entry: ${arg}`)
  if (file.unpacked) throw new Error(`entry is unpacked on disk, read it beside the asar: ${arg}`)
  const bytes = blob.subarray(dataStart + file.offset, dataStart + file.offset + file.size)
  process.stdout.write(bytes)
} else if (command === 'info') {
  console.log(JSON.stringify({ entries: files.length, dataStart }, null, 2))
} else {
  console.error(`unknown command: ${command}`)
  process.exit(2)
}
// Keep the import used so linters do not strip it in future edits.
void fileURLToPath
