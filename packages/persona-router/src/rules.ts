/**
 * Deterministic, explainable routing rules over `PersonaRouteInput` (docs/009).
 *
 * The rules read only the facts the contract supplies: the Trigger's wording (`triggerText`), the target artifact
 * named by the accepted title and the prepared assignment (`docs/`, `tests/`, `src/`, a review diff, a plan or
 * design document), the complexity (text length, explicit versus inferred acceptance, how many admission rules
 * matched) and the Worker's real capability (a Worker without `write`/`edit` can never implement).
 *
 * Rules are evaluated against one actionable clause at a time. The first match wins, with the Trigger
 * considered before the title and assignment. Capability is checked before applying the selected intent.
 */
import type { PersonaId, PersonaRouteInput, PersonaSignals, WorkerCapability } from './types.ts'

/** The DSH tool names that can change a workspace; a Worker with neither can never choose the implementation. */
export const WRITE_TOOLS: readonly string[] = ['write', 'edit']

/** Whether the Worker Session receives a tool that can write or edit files. */
export function hasWriteCapability(worker: WorkerCapability): boolean {
  return worker.tools.some(tool => WRITE_TOOLS.includes(tool))
}

/** A leading action. English actions end on a word boundary, Chinese actions can abut their object. */
interface Keyword {
  readonly word: string
  readonly pattern: RegExp
}

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const keywords = (words: readonly string[]): readonly Keyword[] => words.map(word =>
  ({ word, pattern: new RegExp('^' + escape(word) + (/^[a-z]/i.test(word) ? '(?=$|[\\s:?!,])' : ''), 'i') }))
const firstKeyword = (text: string, list: readonly Keyword[]): string | undefined =>
  list.find(entry => entry.pattern.test(text))?.word

function requestText(text: string): string {
  return text.replace(/^(?:(?:please|can you|could you|we need to|first|then)[,\s]+|(?:请|先|帮我|麻烦)\s*)+/i, '')
}

const REVIEW_WORDS = keywords(['review', 'code review', 'critique', 'feedback', 'audit', 'inspect', 'assess', '评审', '审查', '复核'])
const REVIEW_OUTPUT = /^(?:write|prepare|provide)\s+(?:(?:a|the)\s+)?(?:code review|review report|feedback)(?=\s+(?:of|on|for)\b|[.,:!?]|$)/i
const TEST_ACTION = /^(?:test|reproduce|reproduction|coverage|flaky tests?|regression check)\b(?!\s+plans?\b)|^(?:测试|复现)/i
const ENGLISH_TEST_TARGET = /^(?:add|write|create|fix|update|improve|run|include|edit|tidy)\s+(?:(?:a|an|the|some|failing|flaky|unit|integration|regression|e2e)\s+)*(?:tests?|coverage)(?=\s+(?:for|of|in|on|with|that|to|and)\b|[.,:!?]|$)/i
const CHINESE_TEST_TARGET = /^(?:添加|增加|补充|编写|修复|运行|更新|修改)\s*(?:单元|回归|集成)?测试(?:用例)?(?=$|[，。！？；,\s]|的(?:失败|断言)|覆盖|验证)/
const TEST_FILE_TARGET = /^(?:add|write|create|fix|update|edit|tidy|modify)\s+[\x60"']?(?:(?:tests?|__tests__|specs?)[\/\\]|[^\s\x60"']+\.(?:spec|test)\.[a-z0-9]+\b)/i
const TEST_COMMAND = /^run\s+[\x60"']?(?:(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?test\b|node\s+--test\b|pytest\b|go\s+test\b)/i

function testRequest(text: string): string | undefined {
  const request = requestText(text)
  return TEST_ACTION.exec(request)?.[0] ?? ENGLISH_TEST_TARGET.exec(request)?.[0]
    ?? CHINESE_TEST_TARGET.exec(request)?.[0] ?? TEST_FILE_TARGET.exec(request)?.[0]
    ?? TEST_COMMAND.exec(request)?.[0]
}
const PLAN_WORDS = keywords(['plan', 'design', 'approach', 'proposal', 'rfc', 'architecture', 'break down', 'roadmap', 'strategy', '计划', '设计', '方案'])
const PLAN_OUTPUT = /^(?:write|draft|prepare|propose|create|produce|outline)\s+[\x60"']?(?:(?:[^\s\x60"']*[\/\\])?(?:plan|test-plan|design|proposal|rfc|roadmap)\.md\b|(?:(?:a|an|the|test|migration|implementation|design|technical|rollout|project)\s+)*(?:plan|proposal|roadmap|rfc|design doc)\b)|^(?:写|起草|制定|拟定|整理|给出)\s*(?:一份|一个|个)?\s*(?:测试|迁移|实现|技术|改造)?(?:计划|方案|路线图|设计文档)/i
const RESEARCH_WORDS = keywords(['research', 'investigate', 'explain', 'understand', 'analyze', 'analyse', 'compare', 'survey',
  'look into', 'find out', 'where is', 'what is', 'why', 'how', '调研', '调查', '分析', '解释', '为什么', '如何'])
const IMPLEMENT_WORDS = keywords(['implement', 'add', 'create', 'build', 'fix', 'patch', 'refactor', 'change', 'update',
  'remove', 'delete', 'rename', 'migrate', 'upgrade', 'wire', 'integrate', 'write', 'edit', 'document', 'clean', 'tidy', 'apply', 'modify', 'improve',
  '实现', '添加', '创建', '修复', '修改', '重构', '更新', '删除'])

/** The artifact patterns of each target; they look at the title and the prepared assignment only. */
const ARTIFACTS = {
  review: [/\.diff(?=$|[^\w])/i, /^read\s+(?:the\s+)?diff\b/i],
  test: [/(^|[\/\\\s])(?:tests?|__tests__|specs?)[\/\\]/i, /\.(?:spec|test)\.[a-z0-9]+/i],
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
const artifactText = (input: PersonaRouteInput): string => `${input.title}\n${input.assignment}`.trim()

/** Split independent instructions while keeping file paths, version numbers and shell flags together. */
const CLAUSE_BREAK = /[.!?](?=\s|$)|[。！？；;\r\n]+|,?\s+(?:and|then|but)\s+(?=(?:then\s+)?(?:add|write|run|test|verify|check|fix|review|do not|don['’]t|never|avoid)\b)|,\s*(?=(?:do not|don['’]t|never|avoid)\b)|\s+(?=without\b)|[，,]?\s*(?=(?:不要|不必|无需|禁止|并(?:补充|添加|运行|验证)))/i
const RESTRICTION = /^(?:(?:then|please|请|并)[,\s]*)*(?:do not\b|don['’]t\b|never\b|avoid\b|without\b|no\s+changes?\b|不要|不必|无需|禁止)/i
const SUPPORTING_CLAUSE = /^(?:(?:then|please|并)[,\s]*)*(?:run\b|verify\b|ensure\b|finish\b|include\b|运行|验证|验收)/i

function actionableClauses(text: string): string[] {
  const clauses = text.split(CLAUSE_BREAK).map(clause => clause.trim().replace(/^[-*]\s+/, ''))
    .filter(clause => clause && !RESTRICTION.test(clause))
  const goals = clauses.filter(clause => !SUPPORTING_CLAUSE.test(clause))
  // Running tests can be the whole request. Try it after substantive goals in the same field.
  const testChecks = clauses.filter(clause => SUPPORTING_CLAUSE.test(clause) && testRequest(clause))
  return [...goals, ...testChecks]
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

const CAPABILITY_RULE: PersonaRule = {
  id: 'capability-read-only',
  description: 'A Worker without the write and edit tools never implements: review work goes to review, everything else to research.',
  evaluate: (input) => {
    if (hasWriteCapability(input.worker)) return undefined
    const signals: Record<string, string | number | boolean> = { write: false, edit: false }
    const intent = evaluateIntent(input)
    if (intent?.personaId === 'review') {
      signals.evidence = intent.signals.artifact ?? intent.signals.keyword ?? intent.rule
      return { personaId: 'review', reasonText: 'The Worker Session has no write or edit tool and the primary request is review; routing to the review Persona.', signals }
    }
    return { personaId: 'research', reasonText: 'The Worker Session has no write or edit tool, so implementation is not possible; routing to the research Persona.', signals }
  },
}

/** Within a clause, the first matching rule supplies the decision and its evidence. */
const INTENT_RULES: readonly PersonaRule[] = [
  {
    id: 'review-artifact',
    description: 'The title or assignment names a diff file or asks to read a diff: review.',
    evaluate: (input) => {
      const artifact = firstArtifact(artifactText(input), ARTIFACTS.review)
      return artifact
        ? { personaId: 'review', reasonText: `The title or assignment names a review artifact ("${artifact}"); routing to the review Persona.`, signals: { artifact } }
        : undefined
    },
  },
  {
    id: 'review-request',
    description: 'The request wording asks for a review, critique, feedback or audit: review.',
    evaluate: (input) => {
      const request = requestText(input.triggerText)
      const word = firstKeyword(request, REVIEW_WORDS) ?? REVIEW_OUTPUT.exec(request)?.[0]
      return word
        ? { personaId: 'review', reasonText: `The request wording asks for a review ("${word}"); routing to the review Persona.`, signals: { keyword: word } }
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
    description: 'The clause leads with a request for tests, reproduction, coverage or a regression check: test.',
    evaluate: (input) => {
      const word = testRequest(input.triggerText)
      return word
        ? { personaId: 'test', reasonText: `The request wording asks for test work ("${word}"); routing to the test Persona.`, signals: { keyword: word } }
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
      const request = requestText(input.triggerText)
      const word = firstKeyword(request, PLAN_WORDS) ?? PLAN_OUTPUT.exec(request)?.[0]
      return word
        ? { personaId: 'plan', reasonText: `The Trigger wording asks for planning ("${word}"); routing to the plan Persona.`, signals: { keyword: word } }
        : undefined
    },
  },
  {
    id: 'research-request',
    description: 'The Trigger wording asks to research, investigate, explain, compare or understand: research.',
    evaluate: (input) => {
      const word = firstKeyword(requestText(input.triggerText), RESEARCH_WORDS)
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
      if (!artifact) return undefined
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
      const word = firstKeyword(requestText(input.triggerText), IMPLEMENT_WORDS)
      return word
        ? { personaId: 'implement', reasonText: `The Trigger wording asks for a change ("${word}"); routing to the implement Persona.`, signals: { keyword: word } }
        : undefined
    },
  },
]

const COMPLEXITY_RULE: PersonaRule = {
  id: 'complex-inferred-work',
  description: 'Inferred (proactive) work that is long or matched several admission rules: plan.',
  evaluate: (input) => {
    const chars = input.triggerText.length + input.title.length + input.assignment.length
    if (input.acceptance !== 'inferred') return undefined
    if (chars < 1200 && input.rules.length < 2) return undefined
    return { personaId: 'plan', reasonText: `Inferred work is large (${chars} characters, ${input.rules.length} admission rules); routing to the plan Persona.`, signals: { chars, admissionRules: input.rules.length, acceptance: input.acceptance } }
  },
}

// An explicit action outranks incidental artifact names in the same instruction.
const REQUEST_RULES = INTENT_RULES.filter(rule => rule.id.endsWith('-request'))
const ARTIFACT_RULES = INTENT_RULES.filter(rule => rule.id.endsWith('-artifact'))
const CLAUSE_RULES = [...REQUEST_RULES, ...ARTIFACT_RULES]

export const RULES: readonly PersonaRule[] = Object.freeze([CAPABILITY_RULE, ...CLAUSE_RULES, COMPLEXITY_RULE])

function matchRule(rule: PersonaRule, input: PersonaRouteInput): RuleDecision | undefined {
  const match = rule.evaluate(input)
  if (match) return { ...match, rule: rule.id, signals: Object.freeze({ rule: rule.id, ...match.signals }) }
  return undefined
}

function evaluateIntent(input: PersonaRouteInput): RuleDecision | undefined {
  for (const field of ['triggerText', 'title', 'assignment'] as const) {
    for (const clause of actionableClauses(input[field])) {
      const scoped = {
        ...input,
        triggerText: clause,
        title: field === 'title' ? clause : '',
        assignment: field === 'assignment' ? clause : '',
      }
      for (const rule of CLAUSE_RULES) {
        const decision = matchRule(rule, scoped)
        if (decision) return { ...decision, signals: Object.freeze({ ...decision.signals, field }) }
      }
    }
  }
  return undefined
}

export function evaluateRules(input: PersonaRouteInput): RuleDecision | undefined {
  return matchRule(CAPABILITY_RULE, input) ?? evaluateIntent(input) ?? matchRule(COMPLEXITY_RULE, input)
}
