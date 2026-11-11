// Feasibility probe plugin.
// 1. Proves a trivial profile-local plugin loads and can end the process cleanly.
// 2. Probes the two subprocess shapes dsh-superagent's Setup uses on this host:
//    a) `env NAME=VALUE <program>` (what workerProbe builds), b) the plain program.
// The result decides whether the isolated-profile e2e can reach a configured Runtime.
export const name = 'e2e-probe'
export const inject = ['subprocess']

const log = (line) => process.stdout.write(`[e2e-probe] ${line}\n`)

export async function apply(ctx) {
  log('loaded')
  const subprocess = ctx.subprocess
  const cwd = process.cwd()

  const run = async (label, argv) => {
    try {
      const handle = subprocess.spawn({
        argv,
        cwd,
        graceMs: 2000,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 1 << 20 }, stderr: { maxBytes: 1 << 16 } },
      })
      const { exitCode } = await handle.done
      const out = handle.collected.stdout?.readFrom(0).text?.trim() ?? ''
      const err = handle.collected.stderr?.readFrom(0).text?.trim() ?? ''
      log(`spawn ${label} argv=${JSON.stringify(argv)} exit=${exitCode} stdout=${JSON.stringify(out)} stderr=${JSON.stringify(err)}`)
      return { exitCode, out }
    } catch (error) {
      log(`spawn ${label} argv=${JSON.stringify(argv)} THREW ${error?.constructor?.name}: ${String(error?.message ?? error)}`)
      return { error: String(error?.message ?? error) }
    }
  }

  await run('plain-git', ['git', '--version'])
  await run('env-git', ['env', 'PATH=' + (process.env.PATH ?? ''), 'git', '--version'])
  await run('plain-node', ['node', '--version'])
  await run('env-node', ['env', 'PATH=' + (process.env.PATH ?? ''), 'node', '--version'])

  log('done')
  // End the probe process explicitly: the rest of the profile (SDK app) has no reason to keep running.
  setTimeout(() => process.exit(0), 100)
}
