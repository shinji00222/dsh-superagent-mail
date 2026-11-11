/**
 * The router this Bundle registers on the Super-agent's optional `orchestrator.persona` registry (docs/009).
 *
 * One config field selects the experiment arm:
 *
 * | `mode`   | Behavior |
 * | -------- | -------- |
 * | `off`    | No router is registered; native behavior. |
 * | `fixed`  | Every Ticket binds the configured Persona. |
 * | `random` | A seeded choice keyed by `seed` and `ticketId`, reproducible across processes and restarts. |
 * | `rules`  | Ticket override > Trigger override > first matching rule > default. |
 *
 * `fixed` and `random` ignore the override file, because their whole point is that only the configured Persona or
 * the seed and Ticket id decide. Every mode records a `reasonCode`: overrides use the two operator codes, matched
 * rules use `rule`, and the fallback uses `default`. `fixed` and `random` also record `rule`, with their mode as a
 * signal, since neither is an operator override nor a fallback.
 */
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { PERSONA_IDS, PERSONAS, isPersonaId, personaOf } from './catalog.ts'
import { OverrideFile } from './overrides.ts'
import { evaluateRules, hasWriteCapability } from './rules.ts'
import type { PersonaId, PersonaReasonCode, PersonaRouteDecision, PersonaRouteInput, PersonaRouteMode, PersonaRouter } from './types.ts'

/** The id every decision records as `routerId`. */
export const ROUTER_ID = 'dsh-superagent-persona-router'

/** The router contract version; it changes only when the accepted config or the decision shape changes. */
export const ROUTER_VERSION = '1'

/** The mode an installed Bundle runs with when the profile configures nothing. */
export const DEFAULT_MODE: PersonaRouteMode = 'rules'

/** The fixed seed `random` mode uses when the profile configures none, so restarts stay reproducible. */
export const DEFAULT_SEED = 'dsh-superagent'

/** The Persona the router falls back to when no override or rule explains the request. */
export const DEFAULT_PERSONA: PersonaId = 'implement'

/** The accepted modes, in the order the error message lists them. */
const MODES: readonly PersonaRouteMode[] = ['off', 'fixed', 'random', 'rules']

/** The config keys this Bundle accepts; another key is an operator typo and is refused. */
const CONFIG_KEYS: readonly string[] = ['mode', 'persona', 'seed', 'overridesPath']

/** A validated configuration: the mode plus the defaults and required fields resolved. */
export interface RouterSettings {
  readonly mode: PersonaRouteMode
  /** Set in `fixed` mode; may also be set elsewhere without effect. */
  readonly persona?: PersonaId
  readonly seed: string
  /** An absolute path; only `rules` mode reads it. */
  readonly overridesPath?: string
}

/** What a router may do besides routing: report override-file problems to the plugin's log. */
export interface RouterOptions {
  readonly warn?: (message: string) => void
}

/**
 * Validates one raw plugin configuration and resolves its defaults. Throws a `TypeError` with the plugin id in the
 * message on any unknown key or invalid value, so a bad profile patch fails where it is written; an absent
 * configuration is valid and means `rules` mode with the fixed default seed.
 */
export function normalizeConfig(config?: unknown): RouterSettings {
  if (config === undefined || config === null) return { mode: DEFAULT_MODE, seed: DEFAULT_SEED }
  if (typeof config !== 'object' || Array.isArray(config)) throw new TypeError(`${ROUTER_ID}: config must be an object`)
  const record = config as Record<string, unknown>
  for (const key of Object.keys(record)) if (!CONFIG_KEYS.includes(key)) throw new TypeError(`${ROUTER_ID}: unknown config key ${JSON.stringify(key)}`)
  const rawMode = record.mode ?? DEFAULT_MODE
  if (typeof rawMode !== 'string' || !(MODES as readonly string[]).includes(rawMode))
    throw new TypeError(`${ROUTER_ID}: "mode" must be one of ${MODES.join(', ')}; got ${JSON.stringify(rawMode)}`)
  const mode = rawMode as PersonaRouteMode
  const rawPersona = record.persona
  if (rawPersona !== undefined && !isPersonaId(rawPersona))
    throw new TypeError(`${ROUTER_ID}: "persona" must be one of ${PERSONA_IDS.join(', ')}; got ${JSON.stringify(rawPersona)}`)
  if (mode === 'fixed' && rawPersona === undefined) throw new TypeError(`${ROUTER_ID}: "persona" is required in fixed mode`)
  const rawSeed = record.seed
  if (rawSeed !== undefined && (typeof rawSeed !== 'string' || rawSeed.length === 0))
    throw new TypeError(`${ROUTER_ID}: "seed" must be a non-empty string when given`)
  const rawOverrides = record.overridesPath
  if (rawOverrides !== undefined) {
    if (typeof rawOverrides !== 'string' || rawOverrides.length === 0)
      throw new TypeError(`${ROUTER_ID}: "overridesPath" must be a non-empty absolute path`)
    if (!isAbsolute(rawOverrides))
      throw new TypeError(`${ROUTER_ID}: "overridesPath" must be an absolute path; got ${JSON.stringify(rawOverrides)}`)
  }
  return {
    mode,
    seed: typeof rawSeed === 'string' ? rawSeed : DEFAULT_SEED,
    ...(rawPersona !== undefined ? { persona: rawPersona } : {}),
    ...(typeof rawOverrides === 'string' ? { overridesPath: rawOverrides } : {}),
  }
}

/**
 * The `random` mode bucket of one Ticket: the first 32 bits of `sha256("<seed>:<ticketId>")`, read big-endian, modulo
 * the catalog size. The function is pure, so the same seed and Ticket id pick the same Persona in any process, after
 * any restart, and in any language that computes the same digest.
 */
export function randomBucket(seed: string, ticketId: string): number {
  return createHash('sha256').update(`${seed}:${ticketId}`, 'utf8').digest().readUInt32BE(0) % PERSONAS.length
}

/** The Persona `random` mode picks for one Ticket; reproducible from the seed and the Ticket id alone. */
export function randomPersonaFor(seed: string, ticketId: string): PersonaId {
  return PERSONA_IDS[randomBucket(seed, ticketId)] ?? DEFAULT_PERSONA
}

/** Builds one decision: the catalog entry's exact text plus the audit fields. */
function decisionOf(personaId: PersonaId, reasonCode: PersonaReasonCode, reasonText: string, signals: Readonly<Record<string, string | number | boolean>>): PersonaRouteDecision {
  const persona = personaOf(personaId)
  return { personaId, personaVersion: persona.version, sectionText: persona.sectionText, reasonCode, reasonText, routerId: ROUTER_ID,
    routerVersion: ROUTER_VERSION, signals: Object.freeze({ ...signals }) }
}

/** `fixed` mode: one configured Persona for every Ticket. */
function fixedRouter(personaId: PersonaId): PersonaRouter {
  return {
    id: ROUTER_ID,
    version: ROUTER_VERSION,
    route: () => decisionOf(personaId, 'rule', `Fixed mode routes every ticket to persona "${personaId}".`, { mode: 'fixed' }),
  }
}

/** `random` mode: the seeded bucket of the Ticket id, and nothing else. */
function randomRouter(seed: string): PersonaRouter {
  return {
    id: ROUTER_ID,
    version: ROUTER_VERSION,
    route: (input) => {
      const bucket = randomBucket(seed, input.ticketId)
      const personaId = PERSONA_IDS[bucket] ?? DEFAULT_PERSONA
      return decisionOf(personaId, 'rule', `Random mode (seed "${seed}", bucket ${bucket}) chose persona "${personaId}" for ticket "${input.ticketId}".`, { mode: 'random', seed, bucket })
    },
  }
}

/** `rules` mode: exact Ticket override, exact Trigger override, the rule table, then the default. */
function rulesRouter(settings: RouterSettings, options: RouterOptions): PersonaRouter {
  const overrides = new OverrideFile(settings.overridesPath, { warn: options.warn })
  return {
    id: ROUTER_ID,
    version: ROUTER_VERSION,
    route: (input) => {
      const current = overrides.current()
      const ticketPersona = Object.hasOwn(current.byTicket, input.ticketId) ? current.byTicket[input.ticketId] : undefined
      if (ticketPersona) return decisionOf(ticketPersona, 'operator-ticket-override',
        `Operator override for ticket "${input.ticketId}" selects persona "${ticketPersona}".`, { source: 'byTicket', ticketId: input.ticketId, overrideVersion: current.version })
      const triggerPersona = Object.hasOwn(current.byTrigger, input.triggerId) ? current.byTrigger[input.triggerId] : undefined
      if (triggerPersona) return decisionOf(triggerPersona, 'operator-trigger-override',
        `Operator override for trigger "${input.triggerId}" selects persona "${triggerPersona}".`, { source: 'byTrigger', triggerId: input.triggerId, overrideVersion: current.version })
      const match = evaluateRules(input)
      if (match) return decisionOf(match.personaId, 'rule', match.reasonText, match.signals)
      return decisionOf(DEFAULT_PERSONA, 'default', `No operator override or explainable rule applies; the default persona "${DEFAULT_PERSONA}" is used.`,
        { rule: 'default', acceptance: input.acceptance, chars: input.triggerText.length + input.title.length + input.assignment.length, canImplement: hasWriteCapability(input.worker) })
    },
  }
}

/** Builds the router for validated settings, or `undefined` in `off` mode (nothing is registered at all). */
export function createRouter(settings: RouterSettings, options: RouterOptions = {}): PersonaRouter | undefined {
  switch (settings.mode) {
    case 'off': return undefined
    case 'fixed': return fixedRouter(settings.persona ?? DEFAULT_PERSONA)
    case 'random': return randomRouter(settings.seed)
    case 'rules': return rulesRouter(settings, options)
  }
}

/** Re-exported for callers that only need the input-side contract. */
export type { PersonaRouteInput }
