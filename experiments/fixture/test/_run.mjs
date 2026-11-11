/**
 * Run every test file in this directory in one process.
 *
 * `node --test` starts a child process per file and needs piped stdio; constrained sandboxes can
 * refuse that with EPERM. Importing the files registers the same node:test cases in this process,
 * so `node test/_run.mjs` is equivalent and dependency-free.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const files = readdirSync(import.meta.dirname).filter(name => name.endsWith('.test.mjs')).sort()
for (const name of files) await import(pathToFileURL(join(import.meta.dirname, name)).href)
