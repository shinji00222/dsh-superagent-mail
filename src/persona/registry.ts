/**
 * The Super-agent's optional Persona registry: the minimal service surface `ctx.orchestrator.persona` a routing Bundle
 * registers its `PersonaRouter` on.
 *
 * A Bundle loaded after dsh-superagent registers here at startup, so the registry is read when a Ticket is accepted rather
 * than when the Engine was constructed. While no router is registered the Engine keeps native behavior: no routing decision
 * and no Persona binding.
 */
import type { PersonaRouter } from '../core/index.ts'

/** Holds the one active `PersonaRouter`; absence is the native mode. */
export class PersonaRegistry {
  private active?: PersonaRouter
  /** The router that routes the next accepted Ticket, if a Bundle registered one. */
  get current(): PersonaRouter | undefined { return this.active }
  /**
   * Register a Bundle's router as the active one; a later registration replaces it. The returned release unregisters it only
   * while it is still active, so a reloaded Bundle never removes its successor's router.
   */
  register(router: PersonaRouter): () => void {
    this.active = router
    return () => { if (this.active === router) this.active = undefined }
  }
}
