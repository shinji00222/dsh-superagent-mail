/**
 * The Persona catalog: the five work strategies this Bundle can bind to a Ticket.
 *
 * Each `sectionText` carries ONLY a work strategy and the report's output requirements. It starts with the header
 * `[dsh-superagent persona <id>@<version>]`, and the rest is literal text the Super-agent injects unchanged. It
 * names no tool, permission, Mandate, workspace or Session, because a Persona must not change any of them.
 */
import type { PersonaId } from './types.ts'

/** One catalog entry: the identity, its stable version, and the exact text injected for it. */
export interface PersonaDefinition {
  /** The Persona id the routing contract knows. */
  readonly id: PersonaId
  /** The catalog version; bump it whenever this entry's `sectionText` changes. */
  readonly version: string
  /** The exact System Prompt section for this Persona. */
  readonly sectionText: string
}

/** The header line every section starts with, as docs/009 specifies. */
export const personaHeader = (id: PersonaId, version: string): string => `[dsh-superagent persona ${id}@${version}]`

/** The catalog version of every entry below. */
const CATALOG_VERSION = '1'

/** The five Personas, in the order `random` mode indexes them. */
export const PERSONAS: readonly PersonaDefinition[] = Object.freeze([
  {
    id: 'research',
    version: CATALOG_VERSION,
    sectionText: [
      personaHeader('research', CATALOG_VERSION),
      'Work strategy: read the source material before proposing anything; trace the code, docs and history that bound the request; separate confirmed facts from hypotheses; cite the file and line behind each claim.',
      'Output requirements: state the question answered, the evidence found with its paths, the options or next steps, and the risks and open questions; make no code changes.',
    ].join('\n'),
  },
  {
    id: 'plan',
    version: CATALOG_VERSION,
    sectionText: [
      personaHeader('plan', CATALOG_VERSION),
      'Work strategy: break the request into ordered, verifiable steps; identify the affected modules and interfaces first; call out dependencies, migrations and rollback; keep each step small enough to check on its own.',
      'Output requirements: an ordered plan with each step\'s scope, the files it touches, its acceptance check and its risk; list the assumptions that still need confirmation; change no code.',
    ].join('\n'),
  },
  {
    id: 'implement',
    version: CATALOG_VERSION,
    sectionText: [
      personaHeader('implement', CATALOG_VERSION),
      'Work strategy: change the smallest set of files that satisfies the request; follow the existing module boundaries and conventions; keep every edit reversible; verify each step with the narrowest typecheck or test that covers it.',
      'Output requirements: what changed and why, the exact files touched, the commands run with their results, and the remaining risks or follow-ups.',
    ].join('\n'),
  },
  {
    id: 'test',
    version: CATALOG_VERSION,
    sectionText: [
      personaHeader('test', CATALOG_VERSION),
      'Work strategy: derive cases from the contract and from the reported failure; cover the boundary, error and regression cases first; run the narrowest suite that proves each case before widening it.',
      'Output requirements: the cases covered with the command and result for each, a pass or fail verdict with its evidence, and the areas left untested or observed as flaky.',
    ].join('\n'),
  },
  {
    id: 'review',
    version: CATALOG_VERSION,
    sectionText: [
      personaHeader('review', CATALOG_VERSION),
      'Work strategy: read the change against the contract before judging it; check behaviour, boundaries, error paths and test coverage; distinguish defects from preferences and verify each claim against the code.',
      'Output requirements: findings ordered by severity with file and line references and the evidence for each, a clear approve or change-request verdict, and the parts that were not reviewed.',
    ].join('\n'),
  },
])

/** The Persona ids in catalog order. */
export const PERSONA_IDS: readonly PersonaId[] = PERSONAS.map(persona => persona.id)

/** Whether `value` names a Persona of the contract. */
export function isPersonaId(value: unknown): value is PersonaId {
  return typeof value === 'string' && (PERSONA_IDS as readonly string[]).includes(value)
}

/** The definition of one Persona; throws for an id outside the catalog. */
export function personaOf(id: PersonaId): PersonaDefinition {
  const persona = PERSONAS.find(entry => entry.id === id)
  if (!persona) throw new RangeError(`unknown persona "${String(id)}"`)
  return persona
}
