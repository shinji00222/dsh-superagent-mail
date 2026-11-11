/**
 * `dsh-superagent-persona-router`: a self-contained DSH policy bundle for Persona-aware task routing
 * (docs/009-persona-routing.md).
 *
 * The bundle owns the Persona catalog, the explainable rules and the trusted local operator overrides. At startup it
 * registers one `PersonaRouter` on the Super-agent's optional `orchestrator.persona` registry and disposes it with
 * the plugin's own lifetime. The plugin never imports the Super-agent, so it stays a policy bundle rather than part
 * of the core; if the installed Super-agent has no `persona` registry it logs and stays inert, leaving native
 * behavior untouched instead of failing the host.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createRouter, normalizeConfig } from './router.ts'
import type { PersonaRegistry, PersonaRouterConfig } from './types.ts'

/** The plugin id the bundle's `cordis.patch.yml` inserts. */
export const name = 'dsh-superagent-persona-router'

/** The bundle talks to the Super-agent only through its `orchestrator` service. */
export const inject = ['orchestrator']

/**
 * The optional `ctx.orchestrator.persona` registry as this bundle uses it. It is read structurally, never through a
 * module augmentation, so the bundle compiles and installs whether or not `dsh-superagent` is present.
 */
interface PersonaHost {
  readonly persona?: unknown
}

/** The registry on the Super-agent's service, or `undefined` when the installed Super-agent has none. */
function personaRegistryOf(ctx: Context): PersonaRegistry | undefined {
  const host = (ctx as unknown as { orchestrator?: PersonaHost }).orchestrator
  const candidate = host?.persona
  if (candidate === null || (typeof candidate !== 'object' && typeof candidate !== 'function')) return undefined
  return typeof (candidate as PersonaRegistry).register === 'function' ? candidate as PersonaRegistry : undefined
}

/** Validates the plugin config, then registers (and on unload disposes) the configured router. */
export function apply(ctx: Context, config?: PersonaRouterConfig): void {
  const settings = normalizeConfig(config)
  if (settings.mode === 'off') {
    ctx.logger.info(`${name}: mode "off"; no persona router is registered and native behavior stays in effect`)
    return
  }
  const registry = personaRegistryOf(ctx)
  if (!registry) {
    ctx.logger.warn(`${name}: ctx.orchestrator.persona is absent; no persona router is registered and native behavior stays in effect`)
    return
  }
  const router = createRouter(settings, { warn: message => ctx.logger.warn(`${name}: ${message}`) })
  if (!router) return
  ctx.effect(() => {
    const dispose = registry.register(router)
    ctx.logger.info(`${name}: registered persona router "${router.id}@${router.version}" (mode=${settings.mode})`)
    return typeof dispose === 'function' ? dispose : () => {}
  }, `${name}: register`)
}

export type { PersonaId, PersonaReasonCode, PersonaRegistry, PersonaRouteDecision, PersonaRouteInput, PersonaRouteMode,
  PersonaRouter, PersonaRouterConfig, PersonaSignals } from './types.ts'
export { PERSONAS, PERSONA_IDS, isPersonaId, personaOf, personaHeader, type PersonaDefinition } from './catalog.ts'
export { RULES, WRITE_TOOLS, evaluateRules, hasWriteCapability, type PersonaRule, type RuleDecision, type RuleMatch } from './rules.ts'
export { NO_OVERRIDES, OverrideFile, parseOverrides, type OverrideFileOptions, type Overrides, type ParsedOverrides } from './overrides.ts'
export { DEFAULT_MODE, DEFAULT_PERSONA, DEFAULT_SEED, ROUTER_ID, ROUTER_VERSION, createRouter, normalizeConfig, randomBucket,
  randomPersonaFor, type RouterOptions, type RouterSettings } from './router.ts'
