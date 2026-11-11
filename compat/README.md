# Compatibility: Super-agent baseline vs installed DSH

This directory records what the MVP was built against and what was verified against the DSH that
actually runs on this machine. It is deliberately small: the API deltas between the repository's
locked development dependencies and the installed runtime are measured, not assumed.

## Facts

| Fact | Value | How it was read |
| --- | --- | --- |
| Super-agent baseline | `deepseek-ai/dsh-superagent-prototype` `8c32a9d` ("feat: add the dsh-superagent research prototype") | `git log -1` in the checkout; `git ls-remote` reports the same commit as `main` |
| Lockfile | `pnpm-lock.yaml`, `lockfileVersion: '9.0'`, importers pinned to `@deepseek-ai/*@0.2.1-alpha.2`, `@deepseek-ai/cordis@4.0.5-alpha.1` | `pnpm-lock.yaml` |
| Package manager | `packageManager: pnpm@11.7.0`; sandbox requires `PNPM_HOME`/`npm_config_cache` inside the workspace | `pnpm --version` via the workspace-local home |
| Installed DSH CLI | `0.2.1-rc.5` | `dsh --version` (runtime `cli/bin/dsh.cmd`, bundled Node 24.21.0) |
| Installed desktop app | `44.7.0` shell, `desktopVersion 0.2.1-rc.5` | `<install>/version`, `<install>/resources/runtime/primary-runtime/runtime.json` |
| Node (repo dev) | `^22.19.0 || >=24`, local `v26.7.0` used for `tsc`/`vitest` | `package.json` engines, `node --version` |
| Semver range check | `^0.2.1-alpha.2` includes `0.2.1-rc.5` (same `0.2.x` line, rc > alpha) | `package.json` peer ranges |

## Public API delta: `0.2.1-alpha.2` (lock) vs `0.2.1-rc.5` (installed)

Measured by unpacking the published `0.2.1-rc.5` tarballs into `compat/rc5/` and diffing the
entry `.d.ts` of every package the Super-agent imports (`node_modules/@deepseek-ai/*` vs
`compat/rc5/*/package/lib/types/index.d.ts`). Regenerate with the commands at the bottom.

| Package | Changed lines | Nature of change |
| --- | --- | --- |
| `@deepseek-ai/cordis` | 0 | identical (`4.0.5-alpha.1` is pinned, unchanged) |
| `dsh-session`, `dsh-session-persistence`, `dsh-scope`, `dsh-subprocess`, `dsh-agent`, `dsh-permission-presets` | 0 | identical |
| `dsh-system-prompt` | 3 | additive `CONTEXT_ORDERS` entries only (`TEAM_IDENTITY`, `HARNESS_SOURCE`, `WEB_SURFACE`) |
| `dsh-tools` | 3 | comment + private field |
| `dsh-workspace` | 1 | private field |
| `dsh-llm` | 19 | additive image-control methods on `LlmAdapter` |
| `dsh-api-session-controller` | 10 | comments and one behavior note (below) |

**Behavior note that matters here.** In `0.2.1-rc.5`, `sessionController.create` changed from
"create or idempotently adopt one ordinary Session" to "create one ordinary Session for a new
conversation, **reusing the named blank Session while it is reusable**". The MVP's Worker Sessions
are created by `Sessions.ensure` through this call, and Persona is injected by `Sessions.decorate`
on `agent/created`. A reused blank Session must still be decorated before its first model request,
which is exactly what the isolated-profile e2e (arm 1 of the acceptance list) checks against
`0.2.1-rc.5`. Treat this note as a to-verify item, not a proven regression.

No removed or renamed public export is used by the Super-agent, so the feature can be built
against the locked `0.2.1-alpha.2` dev dependencies and run on the installed `0.2.1-rc.5`. The
`pnpm build` output is what a profile loads; it does not bundle `@deepseek-ai/*` (tsdown
`neverBundle`), so the runtime supplies rc.5 implementations.

## Runtime findings on Windows with `0.2.1-rc.5`

These were found while running the isolated-profile e2e. They are properties of the **baseline**
Super-agent on Windows, not of the Persona feature; the feature's code does not touch them. They are
recorded because they block a real Windows profile and because the e2e has to work around them.

1. **`tools.restrict()` names a tool Windows does not mount.** `@deepseek-ai/dsh-base` disables the
   global `tool-bash` when `process.platform === 'win32'` and mounts `tool-pwsh` instead. The
   baseline `src/app/sessions.ts` restricts the main Session to
   `['skill','bash','read','read_image','job_output','job_list','job_kill']`, naming `bash` and not
   `pwsh`. On Windows DSH answers `tools.restrict() names unknown global tool "bash"` while
   `Runtime.initialize` ensures the main Session, so the whole plugin never becomes ready. The e2e
   profile re-enables the global `tool-bash` row in its own patch layer to get past this.
2. **POSIX-only paths vs Windows workspace creation.** `Config.stateDir` validates a leading `/`
   and so does the Executor's `directory` setting, but DSH's `workspaceRegistry.create` requires a
   fully qualified Windows path. `executionRoot` joins `stateDir` with `work` and loses the drive
   (`\Users\...`), and the Executor then fails the launch with `Workspace path is not fully
   qualified`. The e2e qualifies the drive-less root at that one workspace-create boundary, which
   keeps the product untouched; a Windows deployment of the baseline needs the same or a
   drive-qualified `stateDir` policy.
3. **Constrained sandbox.** The DSH sandbox on this host refuses `spawn` with piped stdio and
   `symlink` (EPERM), and the Super-agent's own `prepare`/`verifyDirectory` path spawns `sh`.
   The e2e answers the Setup subprocess boundary itself (as `tests/fixtures/host.ts` does) and
   records that fact in its README; this is a test double, not a product change.

## Verification status

| Check | Command | Status |
| --- | --- | --- |
| Typecheck against locked dev deps | `pnpm typecheck` | pass |
| Build the plugin a profile loads | `pnpm build` | pass (root plugin + routing Bundle) |
| Feature tests | `tests/persona-*.spec.ts` | pass (40/40) |
| Comparable regression subset | pristine `8c32a9d` worktree vs working tree, 15 spec files | pass (753 tests each; 2 environment failures each; 0 regressions) |
| Real runtime on `0.2.1-rc.5` | `node experiments/e2e/run.mjs` | see `experiments/e2e/README.md` and its evidence directory |

The full `pnpm test` suite is red on this Windows sandbox for environment reasons documented in
`docs/010-verification.md`; the like-for-like comparison is the evidence that matters.

## Regenerating this delta

```powershell
# workspace-local caches first (the sandbox only writes the workspace)
$env:PNPM_HOME="$PWD\.pnpm-home"; $env:npm_config_cache="$PWD\.npm-cache"
$pkgs = 'dsh-system-prompt','dsh-session','dsh-agent','dsh-llm','dsh-scope','dsh-tools',
        'dsh-api-session-controller','dsh-subprocess','dsh-session-persistence','dsh-workspace',
        'dsh-permission-presets'
foreach ($p in $pkgs) { npm pack "@deepseek-ai/$p@0.2.1-rc.5" --pack-destination compat/packs }
npm pack "@deepseek-ai/cordis@4.0.5-alpha.1" --pack-destination compat/packs
# extract each tarball into compat/rc5/<name>/package, then diff
git --no-pager diff --no-index -- "node_modules\@deepseek-ai\dsh-system-prompt\lib\types\index.d.ts" `
  "compat\rc5\dsh-system-prompt\package\lib\types\index.d.ts"
```

`compat/packs/` and `compat/rc5/` are build artifacts of this check and are not part of the
deliverable. The evidence that matters is the isolated-profile run against the installed binary.
