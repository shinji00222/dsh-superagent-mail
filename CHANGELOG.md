# Changelog

All notable changes to this fork are recorded here. The upstream project is
[`deepseek-ai/dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype);
this fork starts from its `8c32a9d` commit, so everything up to that commit is upstream work.

## v0.2.0 — 2026-11-11

Persona-aware task routing MVP over the upstream prototype. A Ticket is still executed by one
persistent Worker Session; the new part is that the Persona is chosen **and persisted on the Ticket
before the first Assignment runs**, and every later launch, retry, reopen, host restart and prompt
template update reuses that binding.

### Added

- `src/core/persona.ts`: the optional routing contract (`PersonaId`, `PersonaRouteInput`,
  `WorkerCapability`, `PersonaRouteDecision`, `PersonaRouter`, `PersonaBinding`).
- `Ticket.persona` audit record written in the same transaction as the Ticket and its first
  Assignment: persona id/version, the exact injected text snapshot, reason code and text, router
  id/version, `decidedAt`, `firstAssignmentId`, `workerSessionId`, explicit/inferred acceptance.
- `orchestrator.persona` registry (`src/persona/registry.ts`) so a separate Bundle can register one
  router after startup; with no router the Super-agent behaves exactly as before.
- Worker-only scoped `systemPrompt.section` `dsh-superagent-persona` (order 650, literal snapshot).
- `packages/persona-router`: standalone `dsh-superagent-persona-router@0.1.0` DSH bundle with five
  Personas (research, plan, implement, test, review), explainable rules, trusted local exact-id
  overrides, and `off | fixed | random | rules` modes.
- Read-only Persona audit in the Ticket page view and the management API.
- `tests/persona-binding.spec.ts`, `tests/persona-injection.spec.ts`, `tests/persona-router.spec.ts`
  (40 tests), plus `tests/e2e/persona-first-request.spec.ts` (real isolated DSH profile with a
  recording fake model; asserts the Worker's first real model request carries the audited snapshot).
- `docs/009-persona-routing.md` (design and limitations), `docs/010-verification.md` (evidence),
  `compat/README.md` (lockfile vs installed DSH API delta and Windows findings).
- `experiments/`: fixed task set, acceptance checkers, pinned fixture snapshot and blind rubric for
  arms A–D. **Not executed in this release**; no benefit result is claimed.
- Isolated-profile e2e harness under `experiments/e2e/`.

### Changed

- `workerSessionId`/`ticketOfSession` moved to `src/core/ids.ts` and re-exported from
  `src/executor/dsh.ts` (the core records the worker Session id without importing the executor).
- Test fixture `tests/fixtures/host.ts` gained registered-section capture, `settle()` and `restart()`
  for the Persona tests; existing timing-sensitive tests keep their previous behavior.

### Compatibility

- Built against the locked `@deepseek-ai/*@0.2.1-alpha.2`; verified on the installed DSH
  `0.2.1-rc.5`. Public API deltas are additive (`compat/README.md`).
- Three pre-existing Windows incompatibilities were found and are documented, not changed: the
  main-Session `tools.restrict` allow-list hardcodes `bash`, the `stateDir`/`executor.directory`
  schema only accepts leading-`/` paths while DSH workspace creation needs a drive-qualified path,
  and this host's sandbox denies piped-stdio child processes.

### Not included

- Template-management UI, multi-role orchestration, push/release integration, subagent Personas.
- Executed A–D benefit experiment and real-model quality/token results.

## v0.1.0 — upstream baseline

Commit `8c32a9d` of `deepseek-ai/dsh-superagent-prototype`: the proactive GitHub/Feishu coding agent
bundle as published by the upstream team. See the upstream repository for its history.
