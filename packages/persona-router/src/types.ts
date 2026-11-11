/**
 * The Persona routing contract of `docs/009-persona-routing.md`, declared locally.
 *
 * This Bundle must build and install without importing the Super-agent's package, so it mirrors the shapes of the
 * core's `PersonaRouter`, `PersonaRouteInput` and `PersonaRouteDecision` instead of importing them. A router this
 * Bundle registers satisfies the core interface structurally; nothing here reaches into the Super-agent's internals.
 */

/** The Personas a catalog may bind. */
export type PersonaId = 'research' | 'plan' | 'implement' | 'test' | 'review'

/** Why a Persona was chosen, as the binding's audit record states it. */
export type PersonaReasonCode =
  /** The trusted local override file names this exact Ticket ID. */
  | 'operator-ticket-override'
  /** The trusted local override file names this exact Trigger ID. */
  | 'operator-trigger-override'
  /** An explainable rule matched, or a non-`rules` mode decided deterministically. */
  | 'rule'
  /** Not enough information: the default Persona applies. */
  | 'default'

/** What the Worker Session actually receives, as the routing rules see it. */
export interface WorkerCapability {
  provider?: string
  model?: string
  /** The tool names the Worker Session actually receives. */
  tools: readonly string[]
  maxWorkers: number
  /** The permission preset id. */
  permissions: string
}

/** The facts a router may use. Never mutable state, never model-visible text beyond the request itself. */
export interface PersonaRouteInput {
  ticketId: string
  triggerId: string
  /** Bounded text of the origin Trigger. */
  triggerText: string
  /** The accepted title. */
  title: string
  /** The assignment text prepared for the Ticket. */
  assignment: string
  acceptance: 'explicit' | 'inferred'
  /** The matched admission rule ids, for work accepted proactively. */
  rules: readonly string[]
  /** The Worker's actual capability. */
  worker: WorkerCapability
}

/** The matched evidence a rule recorded: a flat record of strings, numbers and booleans. */
export type PersonaSignals = Readonly<Record<string, string | number | boolean>>

/** One routing decision: the Persona, the exact text it injects, and the audit of why it was chosen. */
export interface PersonaRouteDecision {
  personaId: PersonaId
  /** The catalog version, such as `'1'`. */
  personaVersion: string
  /** The EXACT text injected into the Worker's System Prompt. */
  sectionText: string
  reasonCode: PersonaReasonCode
  /** Human-readable why, stored for audit. */
  reasonText: string
  routerId: string
  routerVersion: string
  signals?: PersonaSignals
}

/** Routes one Ticket to the Persona its first Assignment runs under; this Bundle supplies one. */
export interface PersonaRouter {
  readonly id: string
  readonly version: string
  route(input: PersonaRouteInput): PersonaRouteDecision
}

/** The optional registry the Super-agent exposes at `ctx.orchestrator.persona` (docs/009). */
export interface PersonaRegistry {
  /** Registers the router; returns a function that unregisters it, if the registry supports disposal. */
  register(router: PersonaRouter): void | (() => void)
}

/** The four experiment arms of docs/009, one per configuration of this Bundle. */
export type PersonaRouteMode = 'off' | 'fixed' | 'random' | 'rules'

/** The plugin configuration this Bundle accepts. Every field is optional so an installed Bundle runs with defaults. */
export interface PersonaRouterConfig {
  /** Routing mode; `rules` when omitted (installing the Bundle is the opt-in; arm A installs no Bundle at all). */
  mode?: PersonaRouteMode
  /** The Persona `fixed` mode binds to every Ticket; required in `fixed` mode, ignored elsewhere. */
  persona?: PersonaId
  /** The `random` mode seed; defaults to a fixed constant so the picks stay reproducible across restarts. */
  seed?: string
  /** Absolute path of the trusted local override file; read only in `rules` mode. */
  overridesPath?: string
}
