/**
 * Persona-aware task routing: the optional routing contract and the binding an accepted Ticket persists.
 *
 * A Persona contributes only work strategy and output requirements; it changes no Mandate, tool permission, goal,
 * workspace or Session history. Everything here is optional: without a registered `PersonaRouter` the Super-agent
 * behaves exactly as before, and a Ticket keeps no `persona`.
 */

/** The Personas a catalog may bind. */
export type PersonaId = 'research' | 'plan' | 'implement' | 'test' | 'review'

/** Why a Persona was chosen, as the binding's audit record states it. */
export type PersonaReasonCode =
  /** A trusted local configuration overrode the route for this exact Ticket ID. */
  | 'operator-ticket-override'
  /** A trusted local configuration overrode the route for this exact Trigger ID. */
  | 'operator-trigger-override'
  /** An explainable rule matched. */
  | 'rule'
  /** Not enough information: the catalog's default Persona applies. */
  | 'default'

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

/** One routing decision: the Persona, the exact text it injects, and the audit of why it was chosen. */
export interface PersonaRouteDecision {
  personaId: PersonaId
  /** The catalog version, such as `'1'`. */
  personaVersion: string
  /** The EXACT text injected into the Worker's System Prompt, kept as the snapshot the Ticket binds. */
  sectionText: string
  reasonCode: PersonaReasonCode
  /** Human-readable why, stored for audit. */
  reasonText: string
  routerId: string
  routerVersion: string
  /** The matched evidence a rule recorded, if any. */
  signals?: Readonly<Record<string, string | number | boolean>>
}

/** Routes one Ticket to the Persona its first Assignment runs under; a routing Bundle supplies one. */
export interface PersonaRouter {
  readonly id: string
  readonly version: string
  route(input: PersonaRouteInput): PersonaRouteDecision
}

/** What is persisted on the Ticket: the decision plus where and how it was bound (audit record). */
export interface PersonaBinding extends PersonaRouteDecision {
  decidedAt: string
  firstAssignmentId: string
  /** `worker-<ticketId>`, the one Session every Assignment of the Ticket runs in. */
  workerSessionId: string
  acceptance: 'explicit' | 'inferred'
}

/** The Persona section a Worker Session's System Prompt carries: the stored `sectionText`, or `''` without a binding. */
export const personaSection = (binding?: PersonaBinding): string => binding?.sectionText ?? ''

/** The capability reported to a router when no `workerCapability` is configured: nothing is known about the Worker. */
export const UNKNOWN_WORKER_CAPABILITY: WorkerCapability = { tools: [], maxWorkers: 0, permissions: '' }

/** How much of the origin Trigger's text a router receives; the rest stays in the domain, never model-visible here. */
export const PERSONA_TRIGGER_CHARS = 600
