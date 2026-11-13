import type { z } from 'zod'

/** Structural subset of Superagent's documented Source contract (docs/008-cookbook.md). */
export interface Trigger {
  id: string
  source: string
  threads: { source: string; id: string }[]
  actor: { source: string; id: string }
  human: boolean
  addressed?: 'mention' | 'direct'
  at: string
  text: string
  meta: Record<string, unknown>
}

type Localized = { zh: string; en: string }
type TextField = { key: string; label: Localized; type: 'text' }
type Field = TextField | { key: string; label: Localized; type: 'number'; min: number; max: number; advanced?: true }

export interface SourceKind<C> {
  kind: string
  title: Localized
  description: Localized
  health: string[]
  schema: z.ZodType<C>
  fields: Field[]
  scope(): { listened: true; observed: boolean; row: string }
  policy: {
    schema: z.ZodType<{ allowed: { id: string }[] }>
    fields: { key: string; type: 'rows'; label: Localized; columns: TextField[] }[]
    explicit: Localized
    rows(): {
      id: string; label: Localized; note: Localized
      cells: { listedUnaddressed: boolean; unlistedAddressed: boolean; unlistedUnaddressed: boolean }
    }[]
  }
}

export interface SourceContext {
  readonly ready: Promise<void>
  configured(): boolean
  config<C extends Record<string, unknown>>(kind: string): C | undefined
  receive(trigger: Trigger): 'stored' | 'duplicate' | 'filtered' | Promise<'stored' | 'duplicate' | 'filtered'>
  state: {
    get<T>(key: string): T | undefined
    set<T>(key: string, value: T): void
  }
  threads: { describe(key: string, description: { label: string }): void }
  report(entry: string, health: { state: 'ready' | 'paused' | 'error'; detail: string; at?: string }): void
}

interface SourceHost {
  sources: { register<C>(kind: SourceKind<C>): () => void }
  context(kind: { kind: string; health: string[] }): SourceContext
}

export interface PluginContext {
  orchestrator: SourceHost
  effect(register: () => () => void | Promise<void>, label?: string): void
}
