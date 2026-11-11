# dsh-superagent-persona-router

A DSH (DeepSeek Harness) policy bundle for `dsh-superagent`. It owns the Persona catalog, the explainable routing
rules and the trusted local operator overrides of [Persona-aware task routing](../../docs/009-persona-routing.md), and
registers one `PersonaRouter` on the Super-agent's optional `orchestrator.persona` registry at startup.

A Persona contributes only a work strategy and the report's output requirements. It changes no Mandate, tool
permission, Ticket goal, workspace or Session history, and the Super-agent stores the injected text as a snapshot on
the Ticket. Without a `persona` registry (an older Super-agent) this bundle logs and stays inert, so native behavior
is unchanged.

### Identity boundary

This bundle does not own the agent's identity persona. A DSH agent preset mounts `@deepseek-ai/dsh-persona`, which
owns the `deployment:persona-prefix` and `deployment:persona-suffix` System Prompt slots and shadows the deployment
persona for one Session; this bundle never registers, shadows or imports those slots, and its catalog text carries no
`You are ...` identity claim. The Super-agent injects a Persona as its own separate scoped work-strategy section
(`dsh-superagent-persona`, order 650), built only from the catalog's `sectionText`: the documented
`[dsh-superagent persona <id>@<version>]` marker, a work strategy and output requirements. It changes how the work is
approached without changing who the agent is.

## Install

The bundle is a normal package with a DSH bundle patch (`dsh.bundle.patch`). Install it into the same profile as
`dsh-superagent`, next to the Super-agent bundle:

```sh
dsh plugin install /path/to/dsh-superagent-persona-router-0.1.0.tgz
```

Its `cordis.patch.yml` inserts the plugin after the Super-agent in the profile layer:

```yaml
- insert:
    - id: dsh-superagent-persona-router
      name: dsh-superagent-persona-router
```

Configure it in the profile's `cordis.patch.yml` by that id (arm A is "no bundle installed"; this bundle with
`mode: off` is equivalent):

```yaml
- id: dsh-superagent-persona-router
  config:
    mode: rules                              # off | fixed | random | rules
    overridesPath: /absolute/path/persona-overrides.json   # rules mode only
```

The bundle needs only the peer `@deepseek-ai/cordis`, because it talks to the Super-agent solely through the
`orchestrator` service; it imports nothing from `dsh-superagent` and does not read Tickets or Sessions.

## Config schema

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mode` | `off` \| `fixed` \| `random` \| `rules` | `rules` | The experiment arm; `off` registers no router at all. |
| `persona` | Persona id | — | Required in `fixed` mode; must be one of `research`, `plan`, `implement`, `test`, `review`. |
| `seed` | non-empty string | `dsh-superagent` | The `random` mode seed. A fixed default keeps restarts reproducible. |
| `overridesPath` | absolute path | — | The trusted local override file; read only in `rules` mode. |

`apply` validates the config: an unknown key, an unknown mode, an unknown Persona id, a missing `fixed` Persona, an
empty seed or a relative `overridesPath` throws a `TypeError` at startup, so a mistyped profile patch fails where it
was written. An absent config is valid and means `rules` mode.

## Modes

| Mode | Behavior | Arm |
| --- | --- | --- |
| `off` | No router is registered; the Super-agent behaves exactly as before. | A |
| `fixed` | Every Ticket binds the configured `persona`; the override file is ignored. | B |
| `random` | `sha256("<seed>:<ticketId>")`, first 32 bits big-endian, modulo 5 (catalog order); ignores the override file. | C |
| `rules` | Exact Ticket override > exact Trigger override > the first matching rule > default `implement`. | D |

`random` mode is reproducible from the seed and the Ticket id alone, so the same seed picks the same Persona for the
same Ticket in any process, after any restart, and on any host. Every mode records an audit `reasonCode`:
`operator-ticket-override`, `operator-trigger-override`, `rule` or `default` (`fixed` and `random` record `rule` with
their mode in `signals`).

### Rule table (`rules` mode)

The table is ordered; the first match wins and records its rule id, reason text and signals in the decision audit.
Task-type keywords come from the origin Trigger's text; artifact hints come from the accepted title and the prepared
assignment; complexity covers text length, explicit versus inferred acceptance, and matched admission rules; and the
Worker's real capability is checked first.

| Order | Rule id | Persona | Match |
| --- | --- | --- | --- |
| 1 | `capability-read-only` | review, else research | The Worker Session has neither the `write` nor the `edit` tool, so it can never implement. |
| 2 | `review-artifact` | review | Title/assignment names `review` or a `diff`. |
| 3 | `review-request` | review | Trigger asks for a review, critique, feedback, audit or inspection. |
| 4 | `test-artifact` | test | Title/assignment names `tests/`, `*.spec.*`, `*.test.*` or `spec/`. |
| 5 | `test-request` | test | Trigger asks for tests, a reproduction, coverage or a regression check. |
| 6 | `plan-artifact` | plan | Title/assignment names a plan, design, RFC or proposal document. |
| 7 | `plan-request` | plan | Trigger asks for a plan, design, approach, proposal or architecture. |
| 8 | `research-request` | research | Trigger asks to research, investigate, explain, compare or understand. |
| 9 | `docs-artifact` | research | Title/assignment names a documentation artifact and the Trigger asks for no change. |
| 10 | `implement-artifact` | implement | Title/assignment names `src/`, `lib/`, a package directory or a code file. |
| 11 | `implement-request` | implement | Trigger asks to implement, add, fix, refactor, change, update, remove or rename. |
| 12 | `complex-inferred-work` | plan | Inferred (proactive) work of at least 1200 characters or with two or more admission rules. |
| — | `default` | implement | Nothing matched; `reasonCode` is `default` and the decision records the facts it had. |

The catalog is versioned; bump a Persona's `version` (and its header line) whenever its text changes, because the
Super-agent injects the stored snapshot and never re-renders it.

## Operator override file

`overridesPath` names a trusted local JSON file, normally outside the repository, written only by an operator. Its
shape:

```json
{
  "version": 1,
  "byTicket": {
    "ticket-3f9a1c": "review"
  },
  "byTrigger": {
    "trigger-7d2e": "test"
  }
}
```

Matching is exact string equality on the Ticket id and on the Trigger id, never on their text. A Ticket override
beats a Trigger override, which beats a rule. The file is read only in `rules` mode, cached by its modification time,
and re-read after it changes; a missing file means no overrides. Anything wrong in it — invalid JSON, a non-object
document, an unknown key, an unknown Persona id — is collected and logged and then ignored, so a bad local file never
takes the Super-agent down. Treat it as trustworthy local configuration: it is not read from Tickets, Triggers or
model output, and a Persona cannot grant tools or permissions.
