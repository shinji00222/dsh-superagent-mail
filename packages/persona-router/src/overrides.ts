/**
 * The trusted local operator override file (docs/009).
 *
 * The file is named by an absolute path in this Bundle's configuration and is read as JSON:
 *
 * ```json
 * { "version": 1, "byTicket": { "ticket-abc": "review" }, "byTrigger": { "trigger-9": "test" } }
 * ```
 *
 * Matching is exact string equality on the Ticket or Trigger id, never on Ticket or Trigger text. Anything the file
 * gets wrong (a malformed document, an unknown key, an unknown Persona id) is collected as a problem and ignored:
 * the plugin logs it and keeps routing, because a bad local file must never take the Super-agent down. The parsed
 * document is cached by the file's modification time, so routing does not re-read it on every Ticket; a missing file
 * means no overrides.
 */
import { readFileSync, statSync } from 'node:fs'
import { isPersonaId } from './catalog.ts'
import type { PersonaId } from './types.ts'

/** The valid override map: the schema version and the two exact-id maps. */
export interface Overrides {
  readonly version: string
  readonly byTicket: Readonly<Record<string, PersonaId>>
  readonly byTrigger: Readonly<Record<string, PersonaId>>
}

/** No overrides, for a missing or unreadable file and for a document with no valid entries. */
export const NO_OVERRIDES: Overrides = Object.freeze({ version: '1', byTicket: Object.freeze({}), byTrigger: Object.freeze({}) })

/** What parsing one override document produced: the valid entries and every problem found along the way. */
export interface ParsedOverrides {
  readonly overrides: Overrides
  readonly problems: readonly string[]
}

/** The top-level keys the override schema defines. */
const OVERRIDE_KEYS: readonly string[] = ['version', 'byTicket', 'byTrigger']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** One exact-id map; unknown Persona ids are dropped and reported. */
function parseMap(value: unknown, key: string, problems: string[]): Readonly<Record<string, PersonaId>> {
  if (value === undefined) return {}
  if (!isRecord(value)) {
    problems.push(`"${key}" must be an object; ignored`)
    return {}
  }
  const entries: [string, PersonaId][] = []
  for (const [id, persona] of Object.entries(value)) {
    if (typeof persona === 'string' && isPersonaId(persona)) entries.push([id, persona])
    else problems.push(`"${key}"[${JSON.stringify(id)}] has an unknown persona ${JSON.stringify(persona)}; ignored`)
  }
  // `Object.fromEntries` keeps an own `__proto__` key an ordinary data property, so a hostile id cannot pollute.
  return Object.fromEntries(entries)
}

/** Parses one already-decoded override document; never throws. */
export function parseOverrides(raw: unknown): ParsedOverrides {
  const problems: string[] = []
  if (!isRecord(raw)) return { overrides: NO_OVERRIDES, problems: ['the override file must contain one JSON object'] }
  let version = NO_OVERRIDES.version
  if (raw.version !== undefined) {
    if (typeof raw.version === 'string' && raw.version.trim()) version = raw.version
    else if (typeof raw.version === 'number' && Number.isFinite(raw.version)) version = String(raw.version)
    else problems.push('"version" must be a non-empty string or a number; using "1"')
  }
  for (const key of Object.keys(raw)) if (!OVERRIDE_KEYS.includes(key)) problems.push(`unknown key ${JSON.stringify(key)}; ignored`)
  return { overrides: { version, byTicket: parseMap(raw.byTicket, 'byTicket', problems), byTrigger: parseMap(raw.byTrigger, 'byTrigger', problems) }, problems }
}

/** What a reader may do with problems; the plugin passes its logger, and a test passes a collector. */
export interface OverrideFileOptions {
  readonly warn?: (message: string) => void
}

/**
 * One override file reader, cached by modification time. A missing file (`ENOENT`) means no overrides; a malformed
 * or unreadable file is reported once and also means no overrides. The cache means one `stat` per decision at most,
 * and the document is re-read only after its mtime changes.
 */
export class OverrideFile {
  private cache: { readonly mtimeMs: number; readonly value: Overrides } | undefined
  private lastFailure: string | undefined
  private readonly path: string | undefined
  private readonly warn: (message: string) => void

  constructor(path: string | undefined, options: OverrideFileOptions = {}) {
    this.path = path
    this.warn = options.warn ?? (() => {})
  }

  /** The valid overrides now in force; never throws. */
  current(): Overrides {
    if (!this.path) return NO_OVERRIDES
    let mtimeMs: number
    try {
      mtimeMs = statSync(this.path).mtimeMs
    } catch (error) {
      // A file that is not there at all is the normal "no overrides" state: no report.
      this.cache = undefined
      if (!isMissing(error)) this.report(`cannot read override file "${this.path}": ${String(error)}`)
      return NO_OVERRIDES
    }
    if (this.cache?.mtimeMs === mtimeMs) return this.cache.value
    let text: string
    try {
      text = readFileSync(this.path, 'utf8')
    } catch (error) {
      this.cache = undefined
      this.report(`cannot read override file "${this.path}": ${String(error)}`)
      return NO_OVERRIDES
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (error) {
      this.cache = { mtimeMs, value: NO_OVERRIDES }
      this.report(`override file "${this.path}" is not valid JSON: ${String(error)}`)
      return NO_OVERRIDES
    }
    const { overrides, problems } = parseOverrides(raw)
    for (const problem of problems) this.report(`override file "${this.path}": ${problem}`)
    this.cache = { mtimeMs, value: overrides }
    return overrides
  }

  /** Reports a problem once for as long as it is the same problem. */
  private report(message: string): void {
    if (message === this.lastFailure) return
    this.lastFailure = message
    this.warn(message)
  }
}

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
