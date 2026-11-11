/**
 * Deterministic, explainable routing rules over `PersonaRouteInput` (docs/009).
 *
 * The rules read only the facts the contract supplies: the Trigger's wording (`triggerText`), the target artifact
 * named by the accepted title and the prepared assignment (`docs/`, `tests/`, `src/`, a review diff, a plan or
 * design document), the complexity (text length, explicit versus inferred acceptance, how many admission rules
 * matched) and the Worker's real capability (a Worker without `write`/`edit` can never implement).
 *
 * The table is ordered and the first match wins, so the same input always produces the same Persona, the same
 * reason text and the same recorded signals. When nothing matches, `evaluateRules` returns `undefined` and the
 * router applies its default Persona.
 */
import type { PersonaId, PersonaRouteInput, PersonaSignals, WorkerCapability } from './types.ts'

/** The DSH tool names that can change a workspace; a Worker with neither can never choose the implementation. */
export const WRITE_TOOLS: readonly string[] = ['write', 'edit']

/** Whether the Worker Session receives a tool that can write or edit files. */
export function hasWriteCapability(worker: WorkerCapability): boolean {
  return worker.tools.some(tool => WRITE_TOOLS.includes(tool))
}

/** One keyword with its precompiled start-boundary pattern; plurals and inflections still match the stem. */
interface Keyword {
  readonly word: string
  readonly pattern: RegExp
}

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const keywords = (words: readonly string[]): readonly Keyword[] => words.map(word =>
  ({ word, pattern: new RegExp(`(^|[^a-z0-9])${escape(word)}`, 'i') }))
const firstKeyword = (text: string, list: readonly Keyword[]): string | undefined =>
  list.find(entry => entry.pattern.test(text))?.word

/** The request-wording keywords of each task type; Chinese words work through the same non-alphanumeric boundary. */
const REVIEW_WORDS = keywords(['review', 'code review', 'critique', 'feedback', 'audit', 'inspect', 'assess', '评审', '审查', '复核'])
const TEST_WORDS = keywords(['test', 'testing', 'failing test', 'flaky', 'coverage', 'reproduce', 'regression', '测试', '复现'])
const PLAN_WORDS = keywords(['plan', 'design', 'approach', 'proposal', 'rfc', 'architecture', 'break down', 'roadmap', 'strategy', '计划', '设计', '方案'])
const RESEARCH_WORDS = keywords(['research', 'investigate', 'explain', 'understand', 'analyze', 'analyse', 'compare', 'survey',
  'look into', 'find out', 'where is', 'what is', 'why', 'how', '调研', '调查', '分析', '解释', '为什么', '如何'])
const IMPLEMENT_WORDS = keywords(['implement', 'add', 'create', 'build', 'fix', 'patch', 'refactor', 'change', 'update',
  'remove', 'delete', 'rename', 'migrate', 'upgrade', 'wire', 'integrate', 'write', 'edit', 'document', 'clean', 'tidy',
  '实现', '添加', '创建', '修复', '修改', '重构', '更新', '删除'])

/** The artifact patterns of each target; they look at the title and the prepared assignment only. */
const ARTIFACTS = {
  review: [/(^|[\/\\\s_.-])reviews?(?=$|[\/\\\s_.-])/i, /(^|[\/\\\s_.-])diffs?(?=$|[\/\\\s_.-])/i, /\.diff(?=$|[^\w])/i],
  test: [/(^|[\/\\\s_.-])tests?(?=$|[\/\\\s_.-])/i, /(^|[\/\\\s_.-])__tests__(?=$|[\/\\\s_.-])/i,
    /\.(?:spec|test)\.[a-z0-9]+/i, /(^|[\/\\\s_.-])specs?(?=$|[\/\\\s_.-])/i],
  plan: [/(^|[\/\\\s_.-])(?:plans?|designs?|rfcs?|proposals?)(?=$|[\/\\\s_.-])/i],
  docs: [/(^|[\/\\\s])docs?(?=$|[\/\\\s_.-])/i, /\.md(?=$|[^\w])/i, /(^|[\/\\\s])readme(?=$|[\/\\\s_.-])/i],
  source: [/(^|[\/\\\s])(?:src|lib|sources?|packages?)(?=$|[\/\\\s_.-])/i,
    /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|cpp|cs|kt|swift|sh|ps1|sql)(?=$|[^\w])/i],
} as const

/** The first named artifact of one kind in the title and assignment, as the evidence string a signal records. */
function firstArtifact(text: string, patterns: readonly RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match) return match[0].trim().replace(/^[\/\\]+/, '')
  }
  return undefined
}

/** The title and assignment, where a task's target artifact is named. */
const artifactText = (input: PersonaRouteInput): string => `${input.title}\n${input.assignment}`

/** The evidence when the request points at review work: a review artifact or review wording. */
function reviewEvidence(input: PersonaRouteInput): string | undefined {
  const artifact = firstArtifact(artifactText(input), ARTIFACTS.review)
  if (artifact) return `review artifact "${artifact}"`
  const word = firstKeyword(input.triggerText, REVIEW_WORDS)
  return word ? `review wording "${word}"` : undefined
}

/** What one rule decided, before the router adds the audit fields. */
export interface RuleMatch {
  readonly personaId: PersonaId
  /** Stable human-readable why; the same input always yields the same text. */
  readonly reasonText: string
  /** The matched evidence this rule recorded. */
  readonly signals: PersonaSignals
}

/** One row of the rule table. */
export interface PersonaRule {
  readonly id: string
  /** One line for the README's rule table and for tests. */
  readonly description: string
  readonly evaluate: (input: PersonaRouteInput) => RuleMatch | undefined
}

/** A rule match with its rule id and the `rule` signal filled in, as the router records it. */
export interface RuleDecision extends RuleMatch {
  readonly rule: string
}

/** The ordered rule table; the first row whose `evaluate` returns a match wins. */
const TABLE: readonly PersonaRule[] = [
  {
    id: 'capability-read-only',
    description: 'A Worker without the write and edit tools never implements: review work goes to review, everything else to research.',
    evaluate: (input) => {
      if (hasWriteCapability(input.worker)) return undefined
      const signals: Record<string, string | number | boolean> = { write: false, edit: false }
      const review = reviewEvidence(input)
      if (review) signals.evidence = review
      return review
        ? { personaId: 'review', reasonText: `The Worker Session has no write or edit tool, so implementation is not possible; the ${review} points at review.`, signals }
        : { personaId: 'research', reasonText: 'The Worker Session has no write or edit tool, so implementation is not possible; routing to the research Persona.', signals }
    },
  },
  {
    id: 'review-artifact',
    description: 'The title or assignment names a review target (`review`, `diff`): review.',
    evaluate: (input) => {
      const artifact = firstArtifact(artifactText(input), ARTIFACTS.review)
      return artifact
        ? { personaId: 'review', reasonText: `The title or assignment names a review artifact ("${artifact}"); routing to the review Persona.`, signals: { artifact } }
        : undefined
    },
  },
  {
    id: 'review-request',
    description: 'The Trigger wording asks for a review, critique, feedback or audit: review.',
    evaluate: (input) => {
      const word = firstKeyword(input.triggerText, REVIEW_WORDS)
      return word
        ? { personaId: 'review', reasonText: `The Trigger wording asks for a review ("${word}"); routing to the review Persona.`, signals: { keyword: word } }
        : undefined
    },
  },
  {
    id: 'test-artifact',
    description: 'The title or assignment names a test artifact (`tests/`, `*.spec.*`, `*.test.*`): test.',
    evaluate: (input) => {
      const artifact = firstArtifact(artifactText(input), ARTIFACTS.test)
      return artifact
        ? { personaId: 'test', reasonText: `The title or assignment names a test artifact ("${artifact}"); routing to the test Persona.`, signals: { artifact } }
        : undefined
    },
  },
  {
    id: 'test-request',
    description: 'The Trigger wording asks for tests, reproductions, coverage or a regression check: test.',
    evaluate: (input) => {
      const word = firstKeyword(input.triggerText, TEST_WORDS)
      return word
        ? { personaId: 'test', reasonText: `The Trigger wording asks for test work ("${word}"); routing to the test Persona.`, signals: { keyword: word } }
        : undefined
    },
  },
  {
    id: 'plan-artifact',
    description: 'The title or assignment names a plan or design artifact: plan.',
    evaluate: (input) => {
      const artifact = firstArtifact(artifactText(input), ARTIFACTS.plan)
      return artifact
        ? { personaId: 'plan', reasonText: `The title or assignment names a plan artifact ("${artifact}"); routing to the plan Persona.`, signals: { artifact } }
        : undefined
    },
  },
  {
    id: 'plan-request',
    description: 'The Trigger wording asks for a plan, design, approach, proposal or architecture: plan.',
    evaluate: (input) => {
      const word = firstKeyword(input.triggerText, PLAN_WORDS)
      return word
        ? { personaId: 'plan', reasonText: `The Trigger wording asks for planning ("${word}"); routing to the plan Persona.`, signals: { keyword: word } }
        : undefined
    },
  },
  {
    id: 'research-request',
    description: 'The Trigger wording asks to research, investigate, explain, compare or understand: research.',
    evaluate: (input) => {
      const word = firstKeyword(input.triggerText, RESEARCH_WORDS)
      return word
        ? { personaId: 'research', reasonText: `The Trigger wording asks for research ("${word}"); routing to the research Persona.`, signals: { keyword: word } }
        : undefined
    },
  },
  {
    id: 'docs-artifact',
    description: 'The title or assignment names documentation and the Trigger asks for no change: research.',
    evaluate: (input) => {
      const artifact = firstArtifact(artifactText(input), ARTIFACTS.docs)
      if (!artifact || firstKeyword(input.triggerText, IMPLEMENT_WORDS)) return undefined
      return { personaId: 'research', reasonText: `The title or assignment names a documentation artifact ("${artifact}") and the Trigger asks for no change; routing to the research Persona.`, signals: { artifact } }
    },
  },
  {
    id: 'implement-artifact',
    description: 'The title or assignment names source files (`src/`, a code extension): implement.',
    evaluate: (input) => {
      const artifact = firstArtifact(artifactText(input), ARTIFACTS.source)
      return artifact
        ? { personaId: 'implement', reasonText: `The title or assignment names source files ("${artifact}"); routing to the implement Persona.`, signals: { artifact } }
        : undefined
    },
  },
  {
    id: 'implement-request',
    description: 'The Trigger wording asks to implement, add, fix, refactor, change or remove: implement.',
    evaluate: (input) => {
      const word = firstKeyword(input.triggerText, IMPLEMENT_WORDS)
      return word
        ? { personaId: 'implement', reasonText: `The Trigger wording asks for a change ("${word}"); routing to the implement Persona.`, signals: { keyword: word } }
        : undefined
    },
  },
  {
    id: 'complex-inferred-work',
    description: 'Inferred (proactive) work that is long or matched several admission rules: plan.',
    evaluate: (input) => {
      const chars = input.triggerText.length + input.title.length + input.assignment.length
      if (input.acceptance !== 'inferred') return undefined
      if (chars < 1200 && input.rules.length < 2) return undefined
      return { personaId: 'plan', reasonText: `Inferred work is large (${chars} characters, ${input.rules.length} admission rules); routing to the plan Persona.`, signals: { chars, admissionRules: input.rules.length, acceptance: input.acceptance } }
    },
  },
]

/** The ordered rule table; the first row whose `evaluate` returns a match wins. */
export const RULES: readonly PersonaRule[] = Object.freeze(TABLE)

/** Evaluates the table in order and returns the first match with its rule id recorded, or `undefined`. */
export function evaluateRules(input: PersonaRouteInput): RuleDecision | undefined {
  for (const rule of RULES) {
    const match = rule.evaluate(input)
    if (match) return { ...match, rule: rule.id, signals: Object.freeze({ rule: rule.id, ...match.signals }) }
  }
  return undefined
}
