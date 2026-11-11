/**
 * Persona test helpers: a deterministic catalog router (the routing Bundle's rules simplified), the exact section text a
 * Persona contributes, and the `renderPrompt` view of a fake Session's assembled System Prompt.
 */
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { workerSessionId } from '../../src/core/index.ts'
import type { PersonaId, PersonaReasonCode, PersonaRouteDecision, PersonaRouteInput, PersonaRouter } from '../../src/core/index.ts'
import type { Host, PromptSection } from './host.ts'

/** One catalog entry: its stable version and the two lines its Persona section contributes. */
export interface CatalogEntry { id: PersonaId; version: string; strategy: string; requirements: string }

/** The Persona catalog the test router routes to; the text is strategy and output requirements only. */
export const CATALOG: Record<PersonaId, CatalogEntry> = {
  research: { id: 'research', version: '1', strategy: 'Gather the evidence and the constraints before changing anything.',
    requirements: 'Report the evidence, the options and a recommendation with the risks named.' },
  plan: { id: 'plan', version: '1', strategy: 'Split the work into ordered, independently verifiable steps before editing.',
    requirements: 'Report the step plan, each step\'s verification and what remains open.' },
  implement: { id: 'implement', version: '1', strategy: 'Make the smallest change that fixes the reported behavior, in the existing style.',
    requirements: 'Report the files changed, the test that proves the change and any follow-up left out of scope.' },
  test: { id: 'test', version: '1', strategy: 'Reproduce the behavior first and keep the reproduction deterministic.',
    requirements: 'Report the failing case, the root cause it proves and the tests that now pass.' },
  review: { id: 'review', version: '1', strategy: 'Read the change adversarially and verify each claim against the code.',
    requirements: 'Report each finding with severity, a concrete reproduction and the exact location.' },
}

/** The exact text a Persona version contributes: one marker line, then strategy and output requirements. */
export function personaText(persona: PersonaId, version = CATALOG[persona].version): string {
  const entry = CATALOG[persona]
  return `[dsh-superagent persona ${entry.id}@${version}]\n${entry.strategy}\n${entry.requirements}`
}

/** The exact snapshot text a catalog Persona binds. */
export const catalogText = (persona: PersonaId): string => personaText(persona)

/** One routing decision as the catalog router makes it. */
export function catalogDecision(persona: PersonaId, reasonCode: PersonaReasonCode, reasonText: string,
  signals?: Readonly<Record<string, string | number | boolean>>): PersonaRouteDecision {
  return { personaId: persona, personaVersion: CATALOG[persona].version, sectionText: catalogText(persona), reasonCode, reasonText,
    routerId: 'test-persona-router', routerVersion: '1', ...signals ? { signals } : {} }
}

/** The options of the test router: exact overrides, an explainable rule, and the fallback Persona. */
export interface RulesRouterOptions {
  /** Exact Ticket-ID overrides, as a Bundle's trusted local config supplies them; values outside the catalog are ignored. */
  tickets?: Record<string, string>
  /** Exact Trigger-ID overrides; values outside the catalog are ignored. */
  triggers?: Record<string, string>
  /** The explainable rule: the Persona it names and the signal it records, or undefined when no rule matches. */
  rule?(input: PersonaRouteInput): { persona: PersonaId; signal: string } | undefined
  /** The Persona when no override or rule applies; `implement` by default. */
  fallback?: PersonaId
}

/** The test router, with the route inputs it received and the override maps a test may change between decisions. */
export interface CatalogRouter extends PersonaRouter {
  readonly inputs: PersonaRouteInput[]
  readonly overrides: { tickets: Record<string, string>; triggers: Record<string, string> }
}

const inCatalog = (id: string | undefined): id is PersonaId => id !== undefined && Object.hasOwn(CATALOG, id)

/**
 * A deterministic router that applies the documented priority: exact Ticket override, then exact Trigger override, then its
 * explainable rule, then the fallback Persona. Unknown IDs and Personas outside the catalog are ignored.
 */
export function personaRouter(options: RulesRouterOptions = {}): CatalogRouter {
  const inputs: PersonaRouteInput[] = []
  const overrides = { tickets: { ...options.tickets }, triggers: { ...options.triggers } }
  return { id: 'test-persona-router', version: '1', inputs, overrides,
    route(input: PersonaRouteInput): PersonaRouteDecision {
      inputs.push(input)
      const ticket = overrides.tickets[input.ticketId], trigger = overrides.triggers[input.triggerId]
      if (inCatalog(ticket)) return catalogDecision(ticket, 'operator-ticket-override',
        `Ticket ${input.ticketId} is overridden by trusted local configuration`, { ticket: input.ticketId })
      if (inCatalog(trigger)) return catalogDecision(trigger, 'operator-trigger-override',
        `Trigger ${input.triggerId} is overridden by trusted local configuration`, { trigger: input.triggerId })
      const matched = options.rule?.(input)
      if (matched) return catalogDecision(matched.persona, 'rule', `Rule matched on ${matched.signal}`, { signal: matched.signal })
      return catalogDecision(options.fallback ?? 'implement', 'default', 'No override or rule matched; the default Persona applies')
    } }
}

/** Registers `router` on the Runtime's optional Persona service; returns its release. */
export function registerRouter(host: Host, router: PersonaRouter): () => void {
  return host.runtime.persona.register(router)
}

/** The system-prompt sections a Session registered, oldest first. */
export function sectionsOf(host: Host, sessionId: string): PromptSection[] { return host.sections.get(sessionId) ?? [] }

/** The registered section named `name` on a Session, if it registered one. */
export const sectionOf = (host: Host, sessionId: string, name: string): PromptSection | undefined =>
  sectionsOf(host, sessionId).find(section => section.name === name)

/**
 * Renders a Session's assembled System Prompt exactly as DSH's `renderPrompt` does: literal text for sections registered
 * with `interpolate: false`, no prompt variables, and empty sections dropped. This is the Worker's composed request prompt.
 */
export function renderSession(host: Host, sessionId: string): string {
  const sections = sectionsOf(host, sessionId).map(section => ({ name: section.name, text: section.text({}), interpolate: section.interpolate }))
  return renderPrompt({ sections, contexts: [], tools: [], variables: {} })
}

/** Renders the Worker Session's composed System Prompt of `ticketId`. */
export const workerPrompt = (host: Host, ticketId: string): string => renderSession(host, workerSessionId(ticketId))

/** The Persona section text a Worker Session currently declares, `''` without a binding. */
export function workerPersonaText(host: Host, ticketId: string): string {
  return sectionOf(host, workerSessionId(ticketId), 'dsh-superagent-persona')?.text({}) ?? ''
}
