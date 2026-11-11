# 009 Persona-aware task routing

A Ticket is still executed by exactly one persistent Worker Session. This document adds one
thing: **before a Ticket's first Assignment runs, the Super-agent chooses a Persona and persists
it on the Ticket; every later launch, retry, reopen, host restart and prompt-template update
reuses that binding.** A Persona contributes only work strategy and output requirements. It
changes no Mandate, tool permission, Ticket goal, workspace or Session history.

Everything here is optional: with no routing Bundle installed the Super-agent behaves exactly as
before (native default, mode A).

## Why the binding is written inside `Tickets.create`

`Sessions.decorate` is triggered by DSH's `agent/created` event, and the worker's System Prompt is
assembled from the sections registered there. A section's text provider runs on **every** model
request, but the *identity* it reads (`ticketId -> persona`) must already be durable when the
session is created. So the binding is written in the same transaction that writes the Ticket and
its first Assignment, before `executor.start()` enqueues the `launch` effect:

```text
Engine.decide(accept)
  -> Tickets.create(id, ...)
       ticket = {...}
       ticket = prepareTicket(ticket, outcome)        // execution: name/directory/assignment
       assignment = newAssignment(ticket)             // first Assignment id
       ticket.persona = personaRouter.route(input)    // NEW: same transaction
       repo.tickets.save(ticket)                      // durable before any session exists
       executor.start(ticket, assignment)             // queues `launch`
```

Consequences that the acceptance tests pin:

- A `launch` effect, an input delivery that recreates a deleted worker Session, a DSH restore of a
  persisted worker Session, a human opening `worker-<ticketId>` early in the Web UI, and a human
  typing directly into that Session all read the same stored binding. None of them can bypass it
  or produce a second decision.
- Concurrent starts of the same Ticket share one stored binding: the binding is a field of the
  Ticket, written once, and later writers only read it.
- A transient delivery failure leaves the Ticket and its binding untouched; the retry reuses it.
- Tickets written before this feature have no `persona` field and therefore inject no Persona
  section: historical workers keep their original behavior.

## Contract (implemented in `src/core`)

```ts
export type PersonaId = 'research' | 'plan' | 'implement' | 'test' | 'review'

export type PersonaReasonCode =
  | 'operator-ticket-override'   // trusted local config, exact Ticket ID
  | 'operator-trigger-override'  // trusted local config, exact Trigger ID
  | 'rule'                       // explainable rule matched
  | 'default'                    // not enough information: fall back to the default Persona

/** The facts a router may use. Never mutable state, never model-visible text beyond the request. */
export interface PersonaRouteInput {
  ticketId: string
  triggerId: string
  triggerText: string            // bounded origin Trigger text
  title: string                  // accepted title
  assignment: string             // assignment text prepared for the Ticket
  acceptance: 'explicit' | 'inferred'
  rules: readonly string[]       // matched admission rule ids (inferred work)
  worker: WorkerCapability       // the Worker's actual capability
}

export interface WorkerCapability {
  provider?: string
  model?: string
  tools: readonly string[]       // tool names the Worker Session actually receives
  maxWorkers: number
  permissions: string            // permission preset id
}

export interface PersonaRouteDecision {
  personaId: PersonaId
  personaVersion: string         // catalog version, e.g. '1'
  sectionText: string            // EXACT text injected into the System Prompt (snapshot)
  reasonCode: PersonaReasonCode
  reasonText: string             // human-readable, stored for audit
  routerId: string
  routerVersion: string
  signals?: Readonly<Record<string, string | number | boolean>>  // matched evidence
}

export interface PersonaRouter {
  readonly id: string
  readonly version: string
  route(input: PersonaRouteInput): PersonaRouteDecision
}

/** What is persisted on the Ticket (audit record). */
export interface PersonaBinding extends PersonaRouteDecision {
  decidedAt: string
  firstAssignmentId: string
  workerSessionId: string        // `worker-<ticketId>`
  acceptance: 'explicit' | 'inferred'
}
```

`Ticket.persona?: PersonaBinding`. `EngineOptions.persona?: PersonaRouter` and
`EngineOptions.workerCapability?(): WorkerCapability` are optional. Core stays I/O-free: the
session id derivation moves to `src/core/ids.ts` so the audit can record it without importing
`src/executor`.

## Injection

`Sessions.decorate` registers one more scoped section on a Worker Session (never on the main
Session, never on a subagent):

```ts
agent.ctx.systemPrompt.section({
  name: 'dsh-superagent-persona',   // unique in this scope
  order: 650,                       // after TEAM_POLICY (600), before tool sections
  interpolate: false,               // Persona text is literal; no {{var}} interpolation
  text: () => personaSection(store.tickets.get(ticketId)?.persona),
})
```

`personaSection(binding)` returns `''` when there is no binding and otherwise the stored
`sectionText`, so the model sees exactly the audited snapshot even after a template update. The
text is:

```text
[dsh-superagent persona <id>@<version>]
<work strategy: how to approach the task>
<output requirements: what the report must contain>
```

Nothing else: no tools, no permissions, no Mandate text.

### Not the same thing as `@deepseek-ai/dsh-persona`

DSH already ships an identity persona: the `dsh-persona` row inside an agent preset registers the
`deployment:persona-prefix` / `deployment:persona-suffix` sections and shadows the deployment-wide
identity for that session. The `dsh-superagent-worker` preset mounts it with a fixed prefix, and
that must keep working unchanged.

This feature is a different axis: the identity persona answers "who is this agent", the routed
Persona answers "what kind of work is this Ticket and how should it be approached". It therefore
uses its own section name (registering the persona-prefix slot again in the same scope would throw
a duplicate). The two texts coexist in one System Prompt; neither overwrites the other, and this
feature never sets `complete: true`.

## Routing Bundle

`packages/persona-router` is a separate DSH bundle (`dsh-superagent-persona-router`) that owns the
Persona catalog, the rules and the operator overrides. It registers a `PersonaRouter` on the
Super-agent's optional `orchestrator.persona` registry at startup. It does not import the core, so
it is not coupled to Ticket internals.

Modes (one config field; the four experiment arms are configs of the same Bundle):

| Mode | Behavior |
| --- | --- |
| `off` | No router is registered; native behavior (arm A uses no Bundle at all) |
| `fixed` | One configured Persona for every Ticket (arm B) |
| `random` | Seeded reproducible choice keyed by `ticketId` + seed (arm C) |
| `rules` | Explainable rules, then default (arm D) |

Priority in `rules` mode: exact Ticket override > exact Trigger override > first matching rule >
default. Overrides come from a trusted local JSON file named by an absolute path in the Bundle
config; they are exact-string matches, validated, and never read from Ticket or Trigger text.

Rule inputs are exactly `PersonaRouteInput`: task type (request wording of the Trigger), target
artifact (`assignment`/title paths, e.g. `docs/`, `test/`, `src/`), complexity (text length,
inferred vs explicit, matched rules), and the Worker's real capability (e.g. no write tools ⇒
never choose `implement`). Every rule records the matched signal in `signals`.

## Known limitations (first version)

- The Worker capability a router sees is the deployment's configured allow-list (`WORK_TOOLS` in
  `src/app/sessions.ts`), the Executor role model, `maxWorkers` and the permission preset. It is the
  ceiling the profile offers, not the set a particular Session was finally granted after DSH's
  preset filtering. A rule such as "no write tool ⇒ never implement" therefore fires only for a
  deployment whose configured list lacks `write`/`edit`; a narrower preset is not detected.
- A router that throws rejects the accept transaction (fail closed): the Ticket is not created and
  the Decision remains, so the main Session can decide again. A router must not throw for "not
  enough information"; it returns the default Persona instead.
- The binding is decided from the accepted request and the configured capability. It does not
  inspect the Worker Session after it starts, so a later capability change does not rebind — by
  design, since the binding is locked.
- Scope is the top-level Ticket Worker only. Subagents of a Worker get no Persona section (they
  keep the preset's identity persona and the Worker's prompt is their parent context); multi-role
  orchestration and a template-management UI are out of scope for this version.

## Acceptance tests (must exist and pass)

The fake DSH host fixture (`tests/fixtures/host.ts`) drives the real `Runtime`. The isolated
profile e2e (`experiments/e2e`) captures the actual provider request with a fake model.

1. **First-round injection** — explicit accept: the Worker's first captured model request contains
   `[dsh-superagent persona ...]` and the exact snapshot; the same text is on the Ticket audit.
2. **Inferred accept** — a proactive rule acceptance binds and injects the same way; the Mandate
   text is unchanged.
3. **Manual override priority** — a Trigger-ID override beats rules; a Ticket-ID override beats a
   Trigger-ID override; an unknown ID or invalid Persona is ignored.
4. **Cross-Ticket isolation** — two concurrent Tickets choose different Personas; each Worker's
   request contains only its own snapshot.
5. **Concurrency** — two simultaneous starts of one Ticket produce one decision and one binding.
6. **Retry and recovery** — a failed delivery, `retryTicket`, `restart` and a host restart
   (`resume`) reuse the snapshot; no rebind happens.
7. **Direct worker access** — pre-opening `worker-<ticketId>` and sending it a message before the
   launch still yields the bound Persona on the first request.
8. **Historical tickets** — a Ticket with no `persona` injects nothing and keeps the original
   prompt.
9. **Template update** — changing the prompt configuration after binding does not change the
   injected Persona text.

## Experiments (arms A–D)

`experiments/README.md` owns the protocol: fixed tasks, pinned repository snapshot, fixed model,
budget, permissions and handoff flow. All arms share the same assignment text, tool set and
handoff procedure; only the Persona section differs. Metrics: acceptance pass rate, blind quality
score (rubric, scored without arm labels), tokens, wall-clock duration. Collaboration quality is
comparable only because the handoff flow is identical.
