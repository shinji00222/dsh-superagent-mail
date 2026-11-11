/**
 * Scripted subprocess boundary for the isolated-profile e2e.
 *
 * This Windows sandbox denies creating a child process with piped stdio (`spawn EPERM`), and the
 * Super-agent's Setup/Executor boundaries are implemented as `ctx.subprocess.spawn({argv, stdio})`.
 * The harness therefore replaces only that OS boundary with a scripted implementation, exactly as
 * tests/fixtures/host.ts replaces it in-process. Everything above it is the real Runtime: real
 * Store, Setup.resolve, Engine, Effects, DshExecutor, DSH Agent/Session and system prompt assembly.
 *
 * The answers are the documented `tests/fixtures/host.ts` recipe:
 *  - `gh api user` -> the agent's login and id
 *  - `gh api repos/<owner>/<name> --jq …` -> canonical name + push access
 *  - `git config -z --show-origin --get-all credential.https://github.com.helper` -> the exact
 *    string Setup.verifyEnvironment compares against
 *  - every other command -> exit 0 with empty output (no prepare command is configured, and the
 *    ticket directory's `git config` verification then finds no local credential keys)
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'e2e-subprocess'
export const inject = ['subprocess']

/** Same quoting and suffix as `credentialHelper` in src/infra/environment.ts, so the answer matches byte for byte. */
const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`
const credentialHelper = (cli) => `!${shellQuote(cli)} auth git-credential`

/** Remove the `env NAME=VALUE …` prefix `runAsWorker` prepends, as tests/fixtures/host.ts does. */
function commandOf(argv) {
  const args = [...argv]
  while (args[0] === 'env' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0] ?? '')) args.shift()
  return args
}

export function apply(ctx, config = {}) {
  const service = ctx.subprocess
  const stateDir = config.stateDir ?? process.env.E2E_STATE_DIR ?? ''
  const ghCli = config.ghCli ?? process.env.E2E_GH_CLI ?? 'gh'
  const trace = (message) => {
    if (config.logFile) appendFileSync(config.logFile, `${new Date().toISOString()} ${message}\n`)
  }
  trace(`install stateDir=${stateDir} ghCli=${ghCli} PATH=${String(process.env.PATH).slice(0, 400)}`)
  const reader = (text) => ({ readFrom: () => ({ text, nextOffset: text.length, lossy: false }) })
  const handle = (stdout, exitCode = 0) => ({
    done: Promise.resolve({ exitCode, signal: null }),
    collected: { stdout: reader(stdout), stderr: reader('') },
  })
  const answer = (rawArgv) => {
    const argv = commandOf(rawArgv)
    const line = argv.join(' ')
    trace(`spawn ${JSON.stringify(rawArgv)} -> ${JSON.stringify(argv)}`)
    if (argv.includes('api') && argv.includes('user')) return handle(`${JSON.stringify({ login: 'e2e-agent', id: 1001 })}\n`)
    if (argv.some((arg) => arg.startsWith('repos/'))) return handle(`${JSON.stringify({ name: 'acme/widgets', push: true })}\n`)
    if (line.includes('--show-origin') && line.includes('credential.https://github.com.helper')) {
      // Setup.verifyEnvironment compares `[file:<workerGitConfig>, credentialHelper(<resolved gh>), '']`.
      // GIT_CONFIG_GLOBAL is set by applyEnvironment just before the comparison, so it names the file
      // Setup wrote; the helper string is derived from the gh CLI this profile resolved (the place-holder
      // file on PATH) exactly as src/infra/environment.ts writes it.
      const configFile = process.env.GIT_CONFIG_GLOBAL ?? join(stateDir, 'worker-gitconfig')
      const answerText = `file:${configFile}\0${credentialHelper(ghCli)}\0`
      trace(`git-credential answer=${JSON.stringify(answerText)}`)
      return handle(answerText)
    }
    return handle('')
  }
  // Confine the replacement to this service instance; other DSH plugins that lazily spawn keep the
  // scripted boundary too, which is required because the sandbox denies every piped spawn here.
  const replace = (target) => {
    try { target.spawn = (spec) => answer(spec?.argv ?? []); return true } catch { /* fall through */ }
    try {
      Object.defineProperty(target, 'spawn', { configurable: true, value: (spec) => answer(spec?.argv ?? []) })
      return true
    } catch { return false }
  }
  if (!replace(service)) throw new Error('e2e-subprocess: could not install the scripted subprocess boundary')
  ctx.logger.info('e2e-subprocess: scripted subprocess boundary installed (gh=%s, stateDir=%s)', ghCli, stateDir)
}
