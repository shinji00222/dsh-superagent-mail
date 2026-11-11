# 010 Verification

What was built for the Persona-aware task routing MVP (docs/009), what was executed, and what the
results actually show. Every number here comes from a command or a file that can be re-run; nothing
is estimated.

## Things that were checked first

| Fact | Value |
| --- | --- |
| Baseline checkout | `deepseek-ai/dsh-superagent-prototype` `8c32a9d` (the same commit `git ls-remote` reports for `main`) |
| Lockfile | `pnpm-lock.yaml`, `lockfileVersion: '9.0'`, `@deepseek-ai/*` pinned to `0.2.1-alpha.2`, `@deepseek-ai/cordis@4.0.5-alpha.1` |
| Installed DSH | `0.2.1-rc.5` (CLI + desktop runtime), bundled Node 24.21.0 |
| Build toolchain | Node 26.7.0 local `tsc`/`vitest`, pnpm 11.7.0 via `packageManager` |
| Compatibility check | published `0.2.1-rc.5` type tarballs diffed against the locked `0.2.1-alpha.2`; details in `compat/README.md` |

The API delta between the locked dev dependencies and the installed runtime is additive: no
removed or renamed public export the Super-agent uses, three additive prompt-context orders, two
additive image methods on `LlmAdapter`, and one behavior note on `sessionController.create`
(reusing a named blank Session). The feature is therefore built against `alpha.2` and must run on
`rc.5`; the isolated-profile e2e is the runtime proof.

## Deliverables

| Deliverable | Where |
| --- | --- |
| Optional routing contract and Ticket binding | `src/core/persona.ts`, `src/core/tickets.ts`, `src/core/model.ts`, `src/core/part.ts`, `src/core/ids.ts` |
| Optional service surface for a routing Bundle | `src/persona/registry.ts` (`orchestrator.persona`), wired in `src/app/runtime.ts` |
| Scoped System Prompt injection | `src/app/sessions.ts` (`dsh-superagent-persona`, order 650, `interpolate: false`) |
| Audit exposure | `src/app/views/tickets.ts`, `src/app/api.ts` |
| Independent policy Bundle | `packages/persona-router` (`dsh-superagent-persona-router@0.1.0`, packable tarball) |
| Design and limitations | `docs/009-persona-routing.md` |
| Fixed experiment material (not executed) | `experiments/tasks`, `experiments/checkers`, `experiments/blind`, `experiments/fixture` |
| Isolated-profile fake-model proof | `experiments/e2e` (see its own evidence) |

## Executed checks

All commands run from the repository root; the sandbox needs the workspace-local pnpm home and
cache, and `vitest.config.ts` pins `pool: 'threads'` because this Windows sandbox refuses the
forked worker processes (and their piped stdio) the default pool starts.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck (locked dev deps) | `pnpm typecheck` | exit 0 |
| Build (root plugin + Bundle) | `pnpm build` | exit 0; `lib/index.js` and `packages/persona-router/lib/index.js` produced |
| Feature tests | `pnpm exec vitest run --pool=threads tests/persona-binding.spec.ts tests/persona-injection.spec.ts tests/persona-router.spec.ts` | **40/40 passed** (10 binding + 8 injection + 22 router) |
| Isolated-profile spec | `pnpm exec vitest run tests/e2e` | **3/3 passed** (it runs the real DSH profile and asserts the captured requests) |
| Full suite, for the record | `pnpm exec vitest run --pool=threads` | 1240 tests, 1093 passed, 147 failed — **every failure category is the environment set below**; no `persona-*` or `persona-first-request` test failed |
| Regression, comparable subset | same 15 core spec files in a pristine `8c32a9d` worktree and in the working tree | pristine **753 tests / 2 failed**, working tree **753 / 2 failed**; the same two tests (`runtime.spec` POSIX worker shims, `store.spec` file modes), **0 regressions, 0 fixed** |
| Bundle packaging | `pnpm --dir packages/persona-router pack` | tarball contains `package/lib/index.js`, `package/lib/index.d.ts`, `package/cordis.patch.yml`, `package/README.md`, `package/package.json` |
| Isolated-profile e2e | `node experiments/e2e/run.mjs` | exit 0, `PASS`; evidence and captured requests under `experiments/e2e/runs/` |
| Isolated-profile e2e spec | `pnpm exec vitest run tests/e2e` | 1 file, 3 tests passed |

### The isolated-profile run, in detail

The run starts the installed DSH `0.2.1-rc.5` (`dsh web`, isolated `DSH_HOME` under the run
directory) with the built `dsh-superagent`, the real `dsh-superagent-persona-router` Bundle
(`mode: fixed, persona: test`) and a recording fake `LlmAdapter`. A driver injected one Trigger
through `ctx.orchestrator.receive(trigger)` — the same entry every Source uses — and the rest is
the production chain: Intake → Eval → the assessment effect steers a candidate card into the main
Session → the fake model answers with a real `orchestrator_route {kind: 'accept'}` tool call → DSH
runs the tool → `Engine.decide` → `Tickets.create` writes the binding in the same transaction →
the `launch` effect → the real `DshExecutor` → the real `worker-<ticketId>` Session's first model
request.

One verified run (`experiments/e2e/runs/2026-11-11T02-32-02-006Z`, evidence sha256
`1eccee8bf18cec4524e37ae160263ab3ceec5f884aa2587a74ed496872cae957`):

- Ticket `26ac299532c68ce8f8e676774166f631` audit: `persona test@1`, reason
  `Fixed mode routes every ticket to persona "test"` (`rule`), `routerId`
  `dsh-superagent-persona-router`, `firstAssignmentId`, `workerSessionId`, `decidedAt`
  `2026-11-11T02:32:06.778Z`.
- `captures/request-003.json` is the first request of `worker-26ac2995…`; its assembled system
  prompt contains `[dsh-superagent persona test@1]` and the exact `sectionText` from the Ticket.
- `request-001`, `-002` and `-004` belong to the main Session (`orchestrator-e781…`) and contain
  neither the header nor the snapshot.
- The spec asserts the same evidence, so a regression in the capture or the binding fails CI-like.

What is real vs doubled: the DSH version, Cordis plugin tree, Session/Agent/agent-loop, prompt
assembly, the built Super-agent and the Bundle are real; the model (this sandbox has no provider
network/key) and two OS boundaries (Setup's `gh`/`git` subprocesses, and the workspace-create call
that needs a drive-qualified path) are test doubles documented in `experiments/e2e/README.md`.

### What "the full suite is red" means here

`pnpm test` on this Windows sandbox reports failures that the pristine baseline also reports; they
are environment facts, not this feature:

- panel/client/controls specs: the hoisted dependency layout the sandbox requires gives jsdom two
  React copies ("Cannot read properties of null (reading 'useCallback')");
- `service-script`, `environment`, `deployment`, `commands`, `sources`: the sandbox refuses
  `spawn` with piped stdio and `symlink` (EPERM), and the tests need POSIX `sh`, `sleep`, `tmux`
  and `python3`;
- `docs.spec`: the checkout's CRLF line endings break its table parser on Windows.

The meaningful comparison is the like-for-like one above: the same files, the same command, one run
in a pristine `8c32a9d` worktree, one in the working tree. That comparison shows no regression.

## Acceptance matrix (docs/009)

| # | Acceptance item | Test |
| --- | --- | --- |
| 1 | First-round injection on an explicit accept | `binds the Persona in the transaction that creates an explicit Ticket, with the audit record` + `injects the exact bound snapshot into the Worker assembly and never into the main Session` |
| 2 | Inferred accept | `binds an inferred accept without changing the Mandate` + `injects the Persona on an inferred accept and leaves the Mandate text untouched` |
| 3 | Manual override priority, unknown/invalid ignored | `applies exact overrides in priority order and ignores unknown or invalid ones` |
| 4 | Cross-Ticket isolation | `binds two concurrent Tickets their own Personas` + `keeps each of two concurrent Workers to its own snapshot` |
| 5 | Concurrent starts of one Ticket reuse one decision | `records one decision and one binding when one Ticket is started twice at once` |
| 6 | Retry and recovery reuse the snapshot | `reuses the stored binding through a delivery failure, a retry, a worker restart and a host restart` + `re-renders the same snapshot after a delivery retry and a host restart` |
| 7 | Pre-opened / directly messaged Worker cannot bypass | `injects the bound Persona when a person opens the Worker Session and messages it before the launch` |
| 8 | Historical Tickets keep native behavior | `leaves a historical Ticket without a Persona, also after a host restart` + `injects nothing for a Ticket without a Persona` |
| 9 | Template update does not change the snapshot | `keeps the audited snapshot through a prompt-template update and a catalog change` |

Also verified: the audit is readable through the Ticket detail view and the management API
(`exposes the Persona audit through the Ticket detail view and the management API`), the router
receives the Worker's capability (`reports the Worker's real capability to the router`), and no
router means no binding and no section (`keeps native behavior with no router...`,
`keeps the composed Worker prompt unchanged when no router is registered`).

## Borrowed patterns, concretely

- **Identity mapping readable before decoration** (mengzhongjie/dsh-superagent-local `fe5929a`,
  `src/app/runtime.ts` + `src/executor/dsh.ts`): the binding is written in `Tickets.create` before
  `executor.start`, so `Sessions.decorate`, triggered by DSH's `agent/created`, always finds it.
  The e2e's pre-open/direct-message test pins this order.
- **Audit keyed by explicit Ticket ID** (same branch): the executor's relay ID is a report ID and
  cannot be used as a Ticket key. Here every audit row lives on the Ticket itself
  (`Ticket.persona`), and the view/API read it by the Ticket's own ID.
- **A local Source with the production dispatch chain** (same branch, `src/sources/dsh.ts`): the
  e2e injects its Trigger through `orchestrator.receive(trigger)`, the same entry every Source
  uses; nothing skips Intake, Eval, Decision, Ticket or launch.
- **Do not leak the worker environment into a shared host** (jwangkun/dsh-superagent `5fbec53`,
  `src/app/setup.ts`): the routing Bundle registers a router only; it never touches `process.env`,
  PATH, git configuration, accounts, permissions or the execution environment. The Super-agent's
  existing setup behavior is unchanged, and the Bundle's own configuration is one trusted local
  file that no Ticket, Trigger or model output can write.

## Known gaps

- Experiments A–D are delivered as fixed tasks, checkers, a pinned fixture and a blind rubric; they
  were **not executed** in this delivery (explicitly out of scope): no real-model tokens were
  spent. The Bundle's `off|fixed|random|rules` modes are the arms.
- No template-management UI, multi-role orchestration, push or release integration.
- The isolated-profile e2e runs the real DSH `0.2.1-rc.5` plugin tree, agent loop and prompt
  assembly, but its model and its Setup subprocess boundary are provider-owned test doubles; see
  `experiments/e2e/README.md` for exactly what is real and what is doubled.
- Baseline Windows incompatibilities found while running the e2e are recorded in
  `compat/README.md`; they are not introduced by this feature.
