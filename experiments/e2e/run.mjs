#!/usr/bin/env node
/**
 * Isolated-profile e2e for docs/009 acceptance item 1: the Persona binding is durable BEFORE the
 * Worker's first model call and reaches the model through the Super-agent's scoped
 * `dsh-superagent-persona` system-prompt section.
 *
 * What is real: the installed DSH 0.2.1-rc.5 CLI, its Cordis plugin tree, Session/Agent/agent-loop,
 * `@deepseek-ai/dsh-system-prompt` assembly, the built `dsh-superagent` bundle (Runtime, Setup,
 * Engine, Effects, DshExecutor), the built `dsh-superagent-persona-router` bundle, and every model
 * request the DSH loop assembled.
 *
 * What is test-doubled (and why):
 *  - the model: provider `e2e-fake` is a recording `LlmAdapter` (this sandbox allows no network and
 *    no API key), which persists each REAL request to runs/<run>/captures/request-<n>.json;
 *  - the subprocess boundary: this Windows sandbox denies spawning a child with piped stdio
 *    (`spawn EPERM`), so the e2e bundle answers Setup's documented `gh`/`git` probes exactly as
 *    tests/fixtures/host.ts does (see plugins/e2e-bundle/subprocess.js).
 *
 * Usage: node experiments/e2e/run.mjs [--keep] [--timeout <seconds>]
 * Requires `pnpm build` first (lib/index.js and packages/persona-router/lib/index.js).
 * Exits 0 only when evidence.json exists and every assertion passed; prints its path.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const INSTALL = 'C:/Users/lwz12/AppData/Local/Programs/DeepSeek Harness'
const EXE = join(INSTALL, 'DeepSeek Harness.exe')
const CLI_JS = join(INSTALL, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')
const PROFILE = 'e2e-run'
const FAKE_BIN = join(here, 'bin')
const FAKE_GH = join(FAKE_BIN, 'gh')
const SCHEMA_VERSION = 11

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback
}
const keep = process.argv.includes('--keep')
const timeoutMs = Number(arg('--timeout', '180')) * 1000

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const runDir = join(here, 'runs', stamp)
// A fresh isolated DSH_HOME per run: the web profile's session persistence and profile state never
// leak a “resume failed” state into the next attempt.
const DSH_HOME = join(runDir, 'dsh-home')
const captureDir = join(runDir, 'captures')
const stateDirFs = join(runDir, 'state')
// The plugin's Config.stateDir is validated as an absolute POSIX-style path (pattern ^/), so the
// harness passes the current drive's root form; on Windows Node maps /Users/... to C:\Users\...
const stateDir = stateDirFs.replace(/^([A-Za-z]):/, '').replaceAll('\\', '/')
const fakeGhCli = join(FAKE_BIN, 'gh')
const env = {
  ...process.env,
  DSH_HOME,
  ELECTRON_RUN_AS_NODE: '1',
  PNPM_HOME: join(repoRoot, '.pnpm-home'),
  npm_config_cache: join(repoRoot, '.npm-cache'),
  npm_config_store_dir: join(repoRoot, '.pnpm-store'),
  XDG_DATA_HOME: join(repoRoot, '.xdg-data'),
  XDG_CACHE_HOME: join(repoRoot, '.xdg-cache'),
  XDG_STATE_HOME: join(repoRoot, '.xdg-state'),
  PATH: `${FAKE_BIN};${process.env.PATH ?? ''}`,
  E2E_STATE_DIR: stateDir,
  E2E_GH_CLI: fakeGhCli,
}
const logPath = join(runDir, 'dsh.log')
const say = (line) => process.stdout.write(`[e2e] ${line}\n`)

mkdirSync(captureDir, { recursive: true })
mkdirSync(stateDirFs, { recursive: true })
mkdirSync(FAKE_BIN, { recursive: true })
if (!existsSync(FAKE_GH)) writeFileSync(FAKE_GH, '#!/bin/sh\n# place holder: the e2e subprocess boundary answers\n# every Setup probe, this file only has to be resolvable by executable().\nexit 0\n')

function toolVersion() {
  try {
    const runtime = JSON.parse(readFileSync(join(INSTALL, 'resources/runtime/primary-runtime/runtime.json'), 'utf8'))
    return `${runtime.desktopVersion} (node ${runtime.node})`
  } catch { return 'unknown' }
}

/** Run one DSH CLI invocation to completion, logging its output to the run log. */
function dsh(args, { label }) {
  const out = openSync(logPath, 'a')
  writeFileSync(logPath, `\n$ dsh ${args.join(' ')}\n`, { flag: 'a' })
  const child = spawn(EXE, ['--expose-internals', CLI_JS, ...args], { cwd: repoRoot, env, stdio: ['ignore', out, out], windowsHide: true })
  return new Promise((resolvePromise, reject) => {
    child.once('error', (error) => { closeSync(out); reject(error) })
    child.once('exit', (code) => {
      closeSync(out)
      if (code === 0) resolvePromise(0)
      else reject(new Error(`${label ?? args[0]} exited with code ${String(code)}; see ${logPath}`))
    })
  })
}

/** Seed the orchestrator SQLite exactly as a configured installation would hold it after Setup. */
function seedState() {
  const dbPath = join(stateDirFs, 'orchestrator.sqlite')
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL')
    db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const put = (key, value) => db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value))
    put('schema', SCHEMA_VERSION)
    const settings = {
      paused: false,
      sources: { github: { enabled: true, config: { repository: 'acme/widgets', cli: 'gh' } } },
      // The local test Source's sender is listed, so its direct message is an explicit request.
      policy: { sources: { e2e: { allowed: [{ id: 'e2e-user', name: 'E2E User' }] } } },
      eval: { mode: 'observe' },
      executor: { model: null, maxWorkers: 3, directory: '', prepare: '', blockedCommands: [] },
    }
    put('settings-revision', 1)
    put('settings-version:1', {
      revision: 1, savedAt: new Date().toISOString(), source: 'internal', block: undefined,
      policyVersion: '', policyChanged: false, notified: [], settings,
    })
    put('settings-block-revision:source:github', 1)
    put('settings-block-revision:policy', 1)
  } finally { db.close() }
}

function writeProfilePatch() {
  const q = (value) => `'${String(value).replaceAll("'", "''")}'`
  const patch = [
    '# Generated by experiments/e2e/run.mjs for one isolated-profile run.',
    '# The fake provider is the default model of both the main and the Worker Session.',
    '- id: agent-default-model',
    '  config:',
    '    provider: e2e-fake',
    '    model: e2e-model',
    '- id: dsh-superagent',
    '  config:',
    `    stateDir: ${q(stateDir)}`,
    '- id: dsh-superagent-persona-router',
    '  config:',
    '    mode: fixed',
    "    persona: test",
    '- id: e2e-subprocess',
    '  config:',
    `    stateDir: ${q(stateDir)}`,
    `    ghCli: ${q(fakeGhCli)}`,
    `    logFile: ${q(join(runDir, 'subprocess.log').replaceAll('\\', '/'))}`,
    '- id: e2e-model',
    '  config:',
    `    captureDir: ${q(captureDir.replaceAll('\\', '/'))}`,
    '- id: e2e-driver',
    '  config:',
    `    runDir: ${q(runDir.replaceAll('\\', '/'))}`,
    `    stateDir: ${q(stateDir)}`,
    `    dshHome: ${q(DSH_HOME.replaceAll('\\', '/'))}`,
    `    profile: ${q(PROFILE)}`,
    `    runId: ${q(stamp)}`,
    `    triggerId: ${q(`e2e-trigger-${stamp}`)}`,
    '    triggerText: "Please add a regression test for the persona binding and report what changed."',
    `    timeoutMs: ${timeoutMs - 15_000}`,
    '',
  ].join('\n')
  writeFileSync(join(DSH_HOME, 'profiles', PROFILE, 'cordis.patch.yml'), patch)
}

function requestBundles() {
  const profileDir = join(DSH_HOME, 'profiles', PROFILE)
  const manifestPath = join(profileDir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dsh ??= {}
  manifest.dsh.profile ??= {}
  manifest.dsh.profile.bundles = [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    'dsh-superagent-e2e',
    'dsh-superagent',
    'dsh-superagent-persona-router',
  ]
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

function tailLog(lines = 60) {
  try {
    const text = readFileSync(logPath, 'utf8').split('\n')
    return text.slice(-lines).join('\n')
  } catch { return '(no log)' }
}

async function main() {
  say(`dsh ${toolVersion()}`)
  say(`run dir: ${runDir}`)
  if (!existsSync(join(repoRoot, 'lib/index.js'))) throw new Error('lib/index.js is missing: run `pnpm build` first')
  if (!existsSync(join(repoRoot, 'packages/persona-router/lib/index.js'))) throw new Error('packages/persona-router/lib/index.js is missing: run `pnpm build` first')

  seedState()
  writeFileSync(logPath, '')

  // Fresh profile from the shipped `web` template, then add the built bundles and the e2e bundle.
  const profileDir = join(DSH_HOME, 'profiles', PROFILE)
  if (existsSync(profileDir)) rmSync(profileDir, { recursive: true, force: true })
  await dsh(['--profile', PROFILE, '--from-default-profile', 'web', '--dump-config'], { label: 'profile init' })
  const specs = [
    `file:${repoRoot}`,
    `file:${join(repoRoot, 'packages/persona-router')}`,
    `file:${join(here, 'plugins/e2e-bundle')}`,
  ]
  await dsh(['plugin', '--profile', PROFILE, 'add', ...specs], { label: 'plugin add' })
  // A concurrent `pnpm build` can move lib/ while pnpm imports the file: dependency; retry once and
  // fail clearly instead of booting a profile that cannot import the built bundle.
  const installed = () => existsSync(join(profileDir, 'node_modules/dsh-superagent/lib/index.js'))
    && existsSync(join(profileDir, 'node_modules/dsh-superagent-persona-router/lib/index.js'))
  if (!installed()) {
    say('built bundle missing from the profile after install; retrying `dsh plugin add`')
    await dsh(['plugin', '--profile', PROFILE, 'add', ...specs], { label: 'plugin add (retry)' })
  }
  if (!installed()) throw new Error('the profile does not contain lib/index.js for dsh-superagent / dsh-superagent-persona-router; run `pnpm build` and retry')
  requestBundles()
  writeProfilePatch()

  // Boot the real web profile. `--port 0` avoids the GUI's port; `--no-open` keeps it headless.
  const out = openSync(logPath, 'a')
  writeFileSync(logPath, `\n$ dsh --profile ${PROFILE} --no-open --port 0 --host 127.0.0.1\n`, { flag: 'a' })
  const child = spawn(EXE, ['--expose-internals', CLI_JS, '--profile', PROFILE, '--no-open', '--port', '0', '--host', '127.0.0.1'], {
    cwd: repoRoot, env, stdio: ['ignore', out, out], windowsHide: true,
  })
  let exited
  child.once('exit', (code) => { exited = code })
  child.once('error', (error) => { exited = `error: ${String(error)}` })

  const evidencePath = join(runDir, 'evidence.json')
  const deadline = Date.now() + timeoutMs
  while (!existsSync(evidencePath)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${evidencePath}\n--- dsh.log tail ---\n${tailLog()}`)
    if (exited !== undefined) throw new Error(`dsh exited (${String(exited)}) before writing evidence\n--- dsh.log tail ---\n${tailLog()}`)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))
  }
  // Let the driver's own exit land, then make sure the whole tree is gone.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200))
  if (exited === undefined) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else closeSync(out)

  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
  const digest = createHash('sha256').update(readFileSync(evidencePath)).digest('hex')
  const failed = Object.entries(evidence.assertions ?? {}).filter(([, value]) => !value).map(([key]) => key)
  say(`ticket: ${evidence.ticket?.id} persona=${evidence.ticket?.persona?.personaId}@${evidence.ticket?.persona?.personaVersion}`)
  say(`worker first request: ${evidence.workerFirstRequest?.file}`)
  say(`worker system prompt contains the audited snapshot: ${String(evidence.assertions?.workerFirstRequestSystemContainsSnapshot)}`)
  say(`main Session never contains the Persona section: ${String(evidence.assertions?.mainSessionNeverContainsPersona)}`)
  say(`evidence: ${evidencePath}`)
  say(`evidence sha256: ${digest}`)
  if (failed.length) {
    say(`FAILED assertions: ${failed.join(', ')}`)
    say(`--- dsh.log tail ---\n${tailLog(40)}`)
    process.exitCode = 1
    return
  }
  say('PASS')
  if (!keep) {
    // Keep the evidence and captures; drop the SQLite WAL/shm and session files, which are large.
    for (const entry of readdirSync(stateDirFs)) {
      if (entry.startsWith('sessions') || entry.endsWith('.sqlite-wal') || entry.endsWith('.sqlite-shm')) {
        rmSync(join(stateDirFs, entry), { recursive: true, force: true })
      }
    }
  }
}

main().catch((error) => {
  say(`BLOCKED: ${String(error?.message ?? error)}`)
  process.exitCode = 1
})
