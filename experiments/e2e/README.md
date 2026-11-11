# Isolated-profile e2e: the Persona binding reaches the Worker's first model request

This directory proves docs/009-persona-routing.md acceptance item 1 on a **real, isolated DSH
profile** with **the real captured model requests**:

> The Ticket's Persona binding is durable before the Worker Session's first model call, and the
> Worker's first captured request contains the exact `[dsh-superagent persona <id>@<version>]`
> snapshot stored on the Ticket audit record; the main Session's requests contain none of it.

## Exact commands

```powershell
# from the repository root, with the repo's pnpm sandbox fix
$env:PNPM_HOME="$PWD\.pnpm-home"; $env:npm_config_cache="$PWD\.npm-cache"
pnpm build                                   # lib/ + packages/persona-router/lib/

node experiments/e2e/run.mjs                # boots one isolated run; prints evidence path; exits 0 on PASS
pnpm exec vitest run tests/e2e              # same run + assertions as a vitest spec
```

`run.mjs` provisions a fresh `DSH_HOME` under `experiments/e2e/runs/<stamp>/dsh-home`, a fresh
SQLite state under `.../state`, boots `dsh --profile e2e-run --no-open --port 0 --host 127.0.0.1`,
waits for `evidence.json`, and exits 0 only when every assertion passed. Run takes ~20 s on this
machine (profile creation + `dsh plugin add` ≈ 5 s, boot ≈ 3 s, chain < 2 s).

### Minimal boot probe (feasibility gate, step 1)

The trivial isolated-profile probe is `plugins/e2e-probe`:

```powershell
# DSH_INSTALL is the installed DeepSeek Harness directory (contains resources/app.asar).
$env:DSH_INSTALL="$env:LOCALAPPDATA\Programs\DeepSeek Harness"
$env:DSH_HOME="$PWD\.e2e-dsh-home"; $dsh="$env:DSH_INSTALL\resources\runtime\cli\bin\dsh.cmd"
& $dsh --profile feas --from-default-profile sdk-minimal --dump-config
& $dsh plugin --profile feas add "file:$PWD\experiments\e2e\plugins\e2e-probe"
# profile patch: insert {id: e2e-probe, name: e2e-probe}
& $dsh --profile feas        # prints "[e2e-probe] loaded", probes subprocess shapes, exits 0
```

It also established the environment blocker below: every `ctx.subprocess.spawn` with piped stdio
fails `spawn EPERM` in this Windows sandbox.

## What is real, what is test-doubled

| Piece | Real? |
| --- | --- |
| DSH CLI/profile/Cordis tree/Session/Agent/agent-loop | **real** — installed 0.2.1-rc.5, `dsh --profile e2e-run` |
| `@deepseek-ai/dsh-system-prompt` assembly and scoped section registration | **real** (the captured system prompt is the assembled one) |
| `dsh-superagent` Runtime, Setup, Engine, Intake, Evals, Tickets, Effects, DshExecutor | **real** (built `lib/index.js`) |
| `dsh-superagent-persona-router` Bundle | **real** (`packages/persona-router`, config `mode: fixed, persona: test`) |
| Trigger entry | `runtime.receive(trigger)` — the same entry `SourceContext.receive` uses for every Source |
| Decision | scripted main-Session `orchestrator_route` accept tool call, executed by DSH's real tool runner → `Engine.decide` |
| Worker launch + first request | real launch effect → real `worker-<ticketId>` Session → real DSH model request |
| **Model** | fake `LlmAdapter` provider `e2e-fake` (`plugins/e2e-bundle/model.js`): records the REAL `GenerateOptions` to `runs/<run>/captures/request-<n>.json` + `.sha256`, then streams a scripted reply |
| **Subprocess boundary** | scripted (`plugins/e2e-bundle/subprocess.js`) — the sandbox refuses piped child stdio; answers Setup's documented `gh`/`git` probes exactly like `tests/fixtures/host.ts` |
| **workspaceRegistry.create boundary** | qualified (`plugins/e2e-bundle/host.js`) — Windows baseline bug, see Compatibility findings |

The fake model is the only thing that is not DSH: the request bodies it records are the exact
messages, system prompt and tool schemas the real DSH loop assembled for that Session.

## Trigger → decision path used

```
driver plugin: ctx.orchestrator.receive(trigger)          (Runtime.receive → Passes.receive → Engine.receive)
  → Intake stores the Trigger, queues Eval on its primary Thread
  → Passes.evaluateDue starts the Eval
  → MasterAssessor assessment effect steers the candidate card into the main Session
  → fake model sees the real candidate card and emits orchestrator_route { kind: accept, trigger_id, … }
  → main-Session tool executes Engine.decide(triggerId, accept)
  → Tickets.create writes ticket.persona IN THE SAME TRANSACTION, before executor.start()
  → launch effect → DshExecutor.launch → worker-<ticketId> Session → first model request captured
```

No shortcut skips Intake/Eval/Ticket/launch; the only substitution is that the model that calls the
production tool is scripted.

## Evidence

`runs/<stamp>/evidence.json` (also `runs/<stamp>/captures/request-NNN.json`,
`driver.log`, `subprocess.log`, `dsh.log`):

- `ticket.persona`: the full audit binding (`personaId`, `personaVersion`, `sectionText`,
  `reasonCode`, `routerId/version`, `decidedAt`, `firstAssignmentId`, `workerSessionId`,
  `acceptance`) read back from the Runtime's Store.
- `workerFirstRequest`: the worker Session's first capture, its file and sha256.
- `requests[]`: every capture with its session, purpose, system sha256 and
  `containsPersonaHeader` / `containsSnapshot`.
- `assertions{}` + `passed`: binding names first Assignment/Session; `decidedAt <=` worker request
  time; worker first request contains the header and the exact `sectionText`; the main Session's
  requests contain neither; a main-Session request was captured.

Typical passing run (`runs/2026-11-11T02-29-35-642Z`): request-001/002 main Session (no Persona),
request-003 `worker-<ticketId>` (Persona header + snapshot), request-004 main Session (no Persona).

## Configuration of the isolated profile (`run.mjs` writes it)

- profile template `web` (`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`; the Super-agent
  injects `webServer`, `workspaceRegistry`, `permissionPresets`, `skills`, … which the lighter
  templates do not provide);
- bundle order `base, web-app, dsh-superagent-e2e, dsh-superagent, dsh-superagent-persona-router`
  (the e2e bundle precedes the Super-agent so its host boundaries are patched first);
- `agent-default-model` → `{provider: e2e-fake, model: e2e-model}`;
- `dsh-superagent` → `stateDir: /<drive-stripped-state-path>` (the plugin's `Config` demands a
  POSIX-style absolute path; Node maps it to the drive);
- `dsh-superagent-persona-router` → `{mode: fixed, persona: test}`;
- state seeded before boot: resolved deployment (`repository: acme/widgets`, `cli: gh`) and
  `policy.sources.e2e.allowed = [{id: e2e-user}]` so the test Source's direct message is an
  explicit request. Sessions are recreated from a fresh `DSH_HOME` every run, so a half-created
  session from an earlier attempt can never be resumed.

## Compatibility findings (baseline Super-agent, Windows; not caused by the Persona change)

1. `src/app/sessions.ts` restricts the main Session to
   `['skill','bash','read','read_image','job_output','job_list','job_kill']`, but the shipped
   profile disables `tool-bash` on win32 (and mounts `tool-pwsh`); `ctx.tools.restrict` throws
   “unknown global tool bash” and `Runtime.initialize` never becomes ready. This e2e registers a
   placeholder `bash` tool in `plugins/e2e-bundle/host.js`; it is never executed.
2. `Config.stateDir` and `ExecutorConfigSchema.directory` both require a POSIX-style absolute path
   (`/…`), so on Windows the Runtime hands DSH's `workspaceRegistry.create` a drive-less path and it
   rejects it (“Workspace path is not fully qualified”). `host.js` prefixes the current drive at
   that one call boundary. (Seeding `executor.directory` cannot avoid this: that schema has the same
   leading-`/` rule.)
3. This sandbox denies any child process with piped stdio (`spawn EPERM`), so both the Super-agent's
   Setup probes and a real provider adapter's fetch are unavailable; hence the scripted subprocess
   boundary and the fake `LlmAdapter`. On a normal host, the same harness can instead point
   `dsh-llm-deepseek` at a local Messages-compatible server via its `baseURL` config.

## Limitations

- The model is scripted; this proves request *assembly/snapshot*, not model behaviour.
- The subprocess and workspace `create` boundaries are adapted; everything the assertions cover
  (Trigger→Ticket→Persona→System Prompt→model request) runs unmodified product code.
- One run covers acceptance item 1 (explicit accept, first-round injection). The other items
  (inferred accept, overrides, cross-Ticket isolation, concurrency, retry/restart, direct worker
  access, historical tickets, template updates) are covered by the core's in-process tests.
- Windows-only harness: paths assume the installed DeepSeek Harness app location recorded in
  `run.mjs` (`INSTALL`); adjust it for another machine.
