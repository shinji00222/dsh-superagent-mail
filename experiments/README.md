# Persona routing experiments (arms A–D)

Question: does choosing a Persona before the first Assignment, and injecting only a work-strategy
section, improve task outcomes at a reasonable cost?

The comparison is only valid because every arm shares **the same fixed tasks, the same pinned
repository snapshot, the same model, the same token budget, the same tool permissions and the same
handoff/report procedure**. The only difference is which Persona section (if any) the Worker's
System Prompt carries. Collaboration quality is therefore comparable across arms; do not compare it
against runs that use a different handoff flow.

## Arms

| Arm | Meaning | Configuration |
| --- | --- | --- |
| A | Native default — exactly the upstream baseline | no persona-router Bundle loaded, no Persona section |
| B | Uniform fixed — one Persona for everyone | bundle `mode: fixed`, `persona: implement` |
| C | Reproducible random — control for "any extra text helps" | bundle `mode: random`, `seed: <fixed>`, same seed for every task |
| D | Automatic routing — the MVP under test | bundle `mode: rules` (with the operator override file empty) |

Arms B and C are controls: B isolates "a specific strategy" from "routing", C isolates "routing
signal" from "some extra prompt text". If D does not beat B and C, the routing rules carry no
demonstrated value and the MVP's claim is only mechanism-level.

## Fixed material

- Tasks: `experiments/tasks/tasks.json` (five tasks, one per Persona). Each task names its
  acceptance checker and its expected primary Persona.
- Repository snapshot: `experiments/fixture/` copied into a fresh git repository for every run and
  pinned by content hash (`experiments/tasks/snapshot.json`). No network, no GitHub, no Feishu.
- Model: same provider/model for every run in a campaign. `--model fake` uses the deterministic
  fake model and is **mechanism validation only**; `--model real` is required to measure benefit.
- Budget/permissions/handoff: fixed in the arm-independent profile (`permissions:
  danger-full-access`, `executor.maxWorkers`, identical assignment/report instructions).

## Metrics

| Metric | Definition | Source |
| --- | --- | --- |
| Acceptance pass rate | checker exit 0 per task | `experiments/checkers/*` |
| Blind quality | rubric score 0–5, scored by a human/LLM judge from an anonymized artifact bundle, arm labels shuffled | `experiments/blind/` |
| Tokens | sum of provider usage (prompt+completion) over all model calls of the run | captured requests/responses or DSH session log |
| Duration | wall clock from trigger injection to Ticket completion | runner timestamps |
| Mechanism checks | persona bound once, snapshot injected, no rebind, no cross-Ticket leak | runner evidence |

A run that cannot produce a metric records `null` with a reason; never a guess. The fake model
returns deterministic usage numbers, so its tokens are pipeline placeholders, not measurements.

## Execution status

**Real-model benefit experiment: not executed.** No real-model tokens were spent and no quality
claim is made. A portable fake-model mechanism campaign is now available; it runs the fixed fixture
and checkers for all four arms, records the router decision and placeholder usage, and creates a
blind artifact bundle. Its outputs are mechanism evidence only, not model-effect measurements.

## Running

Each arm is the same harness with one Bundle configuration; arm A loads no Bundle at all.

```powershell
# workspace-local caches first
$env:PNPM_HOME="$PWD\.pnpm-home"; $env:npm_config_cache="$PWD\.npm-cache"

# A: native default — profile patch without dsh-superagent-persona-router
# B: fixed —   - id: dsh-superagent-persona-router   config: { mode: fixed, persona: implement }
# C: random —  - id: dsh-superagent-persona-router   config: { mode: random, seed: 20261111 }
# D: rules —   - id: dsh-superagent-persona-router   config: { mode: rules, overridesPath: <abs path> }

# Windows PowerShell, all 4 arms x 5 tasks
$runDir = "experiments/runs/fake-campaign-windows-$(Get-Date -Format yyyyMMdd-HHmmss)"
node experiments/fake-campaign.mjs --out $runDir --seed 20261111
node experiments/aggregate.mjs --summary --campaign $runDir
node experiments/aggregate.mjs --anonymize --campaign $runDir

# acceptance for one generated workspace
node experiments/checkers/<checker>.mjs experiments/runs/<campaign>/<arm>/<task>/workspace

# optional human/LLM scoring after filling the blind CSV
node experiments/aggregate.mjs --scores --campaign experiments/runs/<campaign>
```

The harness records the model requests, the Ticket audit (Persona id/version/snapshot/reason) and
timestamps; `experiments/tasks/snapshot.json` pins the fixture so every arm sees the same
repository. Metrics are then read from the run evidence: acceptance checker exit code, captured
token usage, wall-clock duration. Blind quality follows the rubric below.

A real-model campaign needs an explicit key and operator consent; it is never started implicitly.

## Blind scoring

1. `aggregate.mjs --anonymize` copies each run's artifacts (report, diff, tests) into
   `blind/<shuffle-id>/` and writes `blind/key.json` (kept out of the scoring sheet).
2. A scorer fills `blind/sheets/<shuffle-id>.csv` using `blind/rubric.md` only.
3. `aggregate.mjs --scores` joins the sheet with the key and reports quality by arm.

The rubric scores deliverable quality (does the artifact satisfy the task, is it correct,
is it reviewable), not "did the Persona text read well".

## Scope

Top-level Ticket Workers only. No template-management UI, no multi-role orchestration, no
push/release integration. Arms A–D are configs of the same Bundle, except A, which loads no
Bundle at all (the native default that must keep working).


## Runner compatibility notes

`experiments/fake-campaign.mjs` runs on Windows and WSL/Linux. It uses the same fixed tasks,
fixture snapshot, permissions and checkers for A/B/C/D, calls the real router implementation for
B/C/D, and records each config, decision, checker result and deterministic placeholder usage. Arm C
re-routes each Ticket with the same seed and records the equality check. It does not boot DSH and its
tokens, duration and artifacts are not model measurements.

`experiments/e2e/run.mjs` remains the isolated-profile DSH proof for the first-request mechanism and
is currently Windows-specific. It requires `DSH_INSTALL`, runs a single task with `mode: rules`,
and supports only `--keep` and `--timeout`. It does not implement the older
`--task` / `--out` command shown in previous documentation. The A/B/C/D campaign should use
`fake-campaign.mjs` until a portable real DSH profile runner is designed.

`experiments/aggregate.mjs` writes `summary.json`, `summary.csv`, `blind/<shuffle-id>/` and a
separate `blind/key.json`. Generated campaign directories are ignored by Git but remain available
locally for inspection.
