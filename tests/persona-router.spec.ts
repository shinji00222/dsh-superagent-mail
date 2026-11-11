/** The standalone persona-routing Bundle: catalog, rule table, operator overrides, modes, reproducibility and plugin wiring. */
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { PERSONAS, PERSONA_IDS } from '../packages/persona-router/src/catalog.ts'
import { RULES, evaluateRules, hasWriteCapability } from '../packages/persona-router/src/rules.ts'
import { NO_OVERRIDES, OverrideFile, parseOverrides } from '../packages/persona-router/src/overrides.ts'
import { createRouter, normalizeConfig, randomBucket, randomPersonaFor } from '../packages/persona-router/src/router.ts'
import { apply, inject, name } from '../packages/persona-router/src/index.ts'
import type { PersonaId, PersonaRouteInput, PersonaRouter } from '../packages/persona-router/src/types.ts'

const packageDirectory = join(import.meta.dirname, '..', 'packages', 'persona-router')

const worker = (tools: readonly string[] = ['read', 'write', 'edit']): PersonaRouteInput['worker'] =>
  ({ tools, maxWorkers: 4, permissions: 'danger-full-access' })

const input = (overrides: Partial<PersonaRouteInput> = {}): PersonaRouteInput => ({
  ticketId: 'ticket-1', triggerId: 'trigger-1', triggerText: '', title: '', assignment: '', acceptance: 'explicit', rules: [],
  worker: worker(), ...overrides,
})

const directories: string[] = []
const temporary = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'persona-router-'))
  directories.push(directory)
  return directory
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

interface Log { readonly level: string; readonly message: string }
interface FakeHost {
  readonly registered: PersonaRouter[]
  readonly disposers: (() => void)[]
  readonly logs: Log[]
}
const host = (): FakeHost => ({ registered: [], disposers: [], logs: [] })
/** A Context stub holding just what the plugin uses: the logger, `effect` and the `orchestrator` service. */
function contextOf(fake: FakeHost, registry: boolean | undefined): Context {
  const persona = registry === false ? undefined : {
    register: (router: PersonaRouter): (() => void) => {
      fake.registered.push(router)
      return () => {
        const index = fake.registered.indexOf(router)
        if (index >= 0) fake.registered.splice(index, 1)
      }
    },
  }
  return {
    logger: {
      info: (message: string) => fake.logs.push({ level: 'info', message }),
      warn: (message: string) => fake.logs.push({ level: 'warn', message }),
      error: (message: string) => fake.logs.push({ level: 'error', message }),
    },
    effect: (execute: () => (() => void) | undefined) => {
      const dispose = execute()
      if (dispose) fake.disposers.push(dispose)
    },
    orchestrator: persona === undefined ? {} : { persona },
  } as unknown as Context
}
const messages = (fake: FakeHost, level: string): string[] => fake.logs.filter(log => log.level === level).map(log => log.message)

describe('catalog', () => {
  it('holds the five contract Personas, each versioned and headed by the documented marker', () => {
    expect(PERSONA_IDS).toEqual(['research', 'plan', 'implement', 'test', 'review'])
    expect(PERSONAS).toHaveLength(5)
    for (const persona of PERSONAS) {
      expect(persona.version).toBe('1')
      expect(persona.sectionText.startsWith(`[dsh-superagent persona ${persona.id}@${persona.version}]`)).toBe(true)
      // Exactly the marker, the work strategy and the output requirements: a Persona is not the agent's identity.
      const [header, strategy, output] = persona.sectionText.split('\n')
      expect(persona.sectionText.split('\n')).toHaveLength(3)
      expect(header).toBe(`[dsh-superagent persona ${persona.id}@${persona.version}]`)
      expect(strategy?.startsWith('Work strategy: ')).toBe(true)
      expect(output?.startsWith('Output requirements: ')).toBe(true)
      expect(persona.sectionText).not.toMatch(/^You are/m)
      // A Persona is strategy and output only: it may name no tool, permission, Mandate, workspace or Session.
      expect(persona.sectionText).not.toMatch(/mandate|permission|workspace\b|tool permission/i)
    }
  })

  it('reaches every Persona through the rule table', () => {
    const reached = new Set<PersonaId>()
    for (const route of [input({ triggerText: 'explain how the retry works' }), input({ triggerText: 'plan the migration steps' }),
      input({ triggerText: 'fix the failing parser' }), input({ triggerText: 'add tests for the parser' }), input({ triggerText: 'review the change' })]) {
      const match = evaluateRules(route)
      expect(match).toBeDefined()
      reached.add(match!.personaId)
    }
    expect([...reached].sort()).toEqual([...PERSONA_IDS].sort())
  })
})

describe('rules', () => {
  it('never routes a Worker without write or edit tools to implement', () => {
    expect(hasWriteCapability(worker(['read', 'glob']))).toBe(false)
    const plain = evaluateRules(input({ triggerText: 'implement the cache', worker: worker(['read', 'glob']) }))
    expect(plain?.personaId).toBe('research')
    expect(plain?.signals).toMatchObject({ rule: 'capability-read-only', write: false, edit: false })
    expect(plain?.reasonText).toContain('no write or edit tool')
    const reviewed = evaluateRules(input({ triggerText: 'review the incoming diff', worker: worker(['read']) }))
    expect(reviewed?.personaId).toBe('review')
    expect(reviewed?.signals.evidence).toContain('review')
  })

  it('reads the target artifact from the accepted title and the prepared assignment', () => {
    expect(evaluateRules(input({ title: 'tidy tests/core-engine.spec.ts' }))?.personaId).toBe('test')
    expect(evaluateRules(input({ assignment: 'Change src/core/tickets.ts so the retry holds' }))?.personaId).toBe('implement')
    expect(evaluateRules(input({ assignment: 'Read the diff of the worker session change' }))?.personaId).toBe('review')
    expect(evaluateRules(input({ triggerText: 'summarize it', assignment: 'docs/009-persona-routing.md' }))?.personaId).toBe('research')
    expect(evaluateRules(input({ title: 'design/retry.md plan' }))?.personaId).toBe('plan')
  })

  it.each([
    ['Write docs/plan.md. Include Steps, Risks and Test plan. Do not modify tests.', 'plan'],
    ['Survey how fetchJson handles errors. Do not modify source or test files.', 'research'],
    ['Add bounded retries to fetchJson. Add unit tests and run node --test.', 'implement'],
    ['Fix timeout handling and add tests in tests/retry.spec.ts.', 'implement'],
    ['Fix timeout handling with unit tests.', 'implement'],
    ['Do not edit tests/retry.spec.ts. Fix timeout handling.', 'implement'],
    ['Do not review the PR. Add unit tests for retry.', 'test'],
    ['Add tests for parseKeyValue; fix any bug they expose.', 'test'],
    ['Run unit tests for the parser.', 'test'],
    ['Run unit tests first, then fix timeout handling.', 'implement'],
    ['先写方案，暂时不要改测试。', 'plan'],
    ['修复超时处理并补充测试。', 'implement'],
    ['Fix the review modal crash.', 'implement'],
    ['Please fix the regression test page.', 'implement'],
    ['修复回归测试页面无法打开的问题。', 'implement'],
    ['帮我修复代码审查弹窗。', 'implement'],
    ['Explain the architecture of the retry flow.', 'research'],
    ['Write a test plan for the retry feature.', 'plan'],
    ['请先写一份测试方案。', 'plan'],
    ['Write a code review of the retry PR.', 'review'],
    ['Fix the failing regression tests.', 'test'],
    ['修复回归测试用例。', 'test'],
    ['Update tests/retry.spec.ts.', 'test'],
    ['Run node --test.', 'test'],
  ] as const)('routes the primary instruction in "%s" to %s', (triggerText, personaId) => {
    expect(evaluateRules(input({ triggerText, assignment: 'tests/retry.spec.ts' }))?.personaId).toBe(personaId)
  })

  it('skips a test path mentioned in an assignment restriction', () => {
    const assignment = 'Do not touch tests/retry.spec.ts. Update src/client.mjs. Run the regression suite.'
    expect(evaluateRules(input({ assignment }))).toMatchObject({ rule: 'implement-request', personaId: 'implement' })
  })

  it('checks the primary instruction before using review as the read-only fallback', () => {
    const route = input({ triggerText: 'Fix the parser. Do not review the diff.', assignment: 'review-target.diff', worker: worker(['read']) })
    expect(evaluateRules(route)).toMatchObject({ rule: 'capability-read-only', personaId: 'research' })
  })

  it('checks the requested action before artifact names in the same title or assignment', () => {
    expect(evaluateRules(input({ title: 'Fix the review modal in src/review.ts' }))?.personaId).toBe('implement')
    expect(evaluateRules(input({ assignment: 'Explain src/retry.ts and its architecture' }))?.personaId).toBe('research')
    expect(evaluateRules(input({ assignment: 'Apply the diff from retry.diff to worker.ts' }))?.personaId).toBe('implement')
  })

  /** One representative input per rule row, in table order; each must be decided by its own row. */
  const cases: readonly { rule: string; persona: PersonaId; route: PersonaRouteInput }[] = [
    { rule: 'capability-read-only', persona: 'research', route: input({ triggerText: 'implement it', worker: worker(['read']) }) },
    { rule: 'review-request', persona: 'review', route: input({ triggerText: 'review the change' }) },
    { rule: 'test-request', persona: 'test', route: input({ triggerText: 'add tests for the parser' }) },
    { rule: 'plan-request', persona: 'plan', route: input({ triggerText: 'plan the migration' }) },
    { rule: 'research-request', persona: 'research', route: input({ triggerText: 'explain how the effect queue retries' }) },
    { rule: 'implement-request', persona: 'implement', route: input({ triggerText: 'add a bounded retry' }) },
    { rule: 'review-artifact', persona: 'review', route: input({ assignment: 'review-target.diff' }) },
    { rule: 'test-artifact', persona: 'test', route: input({ assignment: 'tests/persona-router.spec.ts' }) },
    { rule: 'plan-artifact', persona: 'plan', route: input({ title: 'docs/plan.md' }) },
    { rule: 'docs-artifact', persona: 'research', route: input({ title: 'docs/009-persona-routing.md' }) },
    { rule: 'implement-artifact', persona: 'implement', route: input({ assignment: 'files: src/executor/dsh.ts' }) },
    { rule: 'complex-inferred-work', persona: 'plan', route: input({ triggerText: 'do the thing', acceptance: 'inferred', rules: ['observeIssues', 'observePulls'] }) },
  ]

  it('matches every rule row in table order and records its id, persona and reason', () => {
    expect(cases.map(entry => entry.rule)).toEqual(RULES.map(rule => rule.id))
    for (const entry of cases) {
      const match = evaluateRules(entry.route)
      expect(match, entry.rule).toBeDefined()
      expect(match!.rule, entry.rule).toBe(entry.rule)
      expect(match!.personaId, entry.rule).toBe(entry.persona)
      expect(match!.signals.rule, entry.rule).toBe(entry.rule)
      expect(match!.reasonText.length, entry.rule).toBeGreaterThan(0)
    }
  })

  it('is deterministic: the same input yields the same match and reason text', () => {
    const route = input({ triggerText: 'plan the migration', assignment: 'src/core/tickets.ts' })
    expect(evaluateRules(route)).toEqual(evaluateRules(route))
  })

  it('falls back to implement with reasonCode default when nothing matches', () => {
    const router = createRouter(normalizeConfig(undefined))!
    const decision = router.route(input({ triggerText: 'do the thing' }))
    expect(decision.personaId).toBe('implement')
    expect(decision.reasonCode).toBe('default')
    expect(decision.signals?.rule).toBe('default')
  })
})

describe('operator overrides', () => {
  it('keeps valid entries and reports every unknown key or Persona', () => {
    const parsed = parseOverrides({ version: 1, byTicket: { 'ticket-a': 'review', 'ticket-b': 'invent' }, byTrigger: { 'trigger-a': 'test' }, extra: true })
    expect(parsed.overrides.byTicket).toEqual({ 'ticket-a': 'review' })
    expect(parsed.overrides.byTrigger).toEqual({ 'trigger-a': 'test' })
    expect(parsed.overrides.version).toBe('1')
    expect(parsed.problems.join('\n')).toMatch(/ticket-b.*invent/)
    expect(parsed.problems.join('\n')).toContain('unknown key "extra"')
    expect(parseOverrides([]).problems).toEqual(['the override file must contain one JSON object'])
  })

  it('treats a missing file as no overrides and never throws on a bad one', () => {
    const directory = temporary()
    expect(new OverrideFile(join(directory, 'absent.json')).current()).toEqual(NO_OVERRIDES)
    const path = join(directory, 'bad.json')
    writeFileSync(path, '{ not json')
    const warnings: string[] = []
    const file = new OverrideFile(path, { warn: message => warnings.push(message) })
    expect(file.current()).toEqual(NO_OVERRIDES)
    expect(warnings.join('\n')).toContain('not valid JSON')
    expect(file.current()).toEqual(NO_OVERRIDES)
    expect(warnings).toHaveLength(1)
  })

  it('caches by modification time and reloads once it changes', () => {
    const path = join(temporary(), 'overrides.json')
    const first = new Date('2026-01-01T00:00:00Z')
    const second = new Date('2026-01-02T00:00:00Z')
    writeFileSync(path, JSON.stringify({ version: 1, byTicket: { 'ticket-a': 'review' } }))
    utimesSync(path, first, first)
    const file = new OverrideFile(path)
    expect(file.current().byTicket['ticket-a']).toBe('review')
    writeFileSync(path, JSON.stringify({ version: 1, byTicket: { 'ticket-a': 'test' } }))
    utimesSync(path, first, first)
    expect(file.current().byTicket['ticket-a']).toBe('review')
    utimesSync(path, second, second)
    expect(file.current().byTicket['ticket-a']).toBe('test')
  })

  it('applies exact Ticket > Trigger > rule priority and ignores unknown ids', () => {
    const path = join(temporary(), 'overrides.json')
    writeFileSync(path, JSON.stringify({ version: 1, byTicket: { 'ticket-a': 'review' }, byTrigger: { 'trigger-a': 'test' } }))
    const router = createRouter(normalizeConfig({ mode: 'rules', overridesPath: path }))!
    const both = router.route(input({ ticketId: 'ticket-a', triggerId: 'trigger-a', triggerText: 'fix the bug' }))
    expect(both).toMatchObject({ personaId: 'review', reasonCode: 'operator-ticket-override' })
    const triggerOnly = router.route(input({ ticketId: 'ticket-b', triggerId: 'trigger-a', triggerText: 'fix the bug' }))
    expect(triggerOnly).toMatchObject({ personaId: 'test', reasonCode: 'operator-trigger-override' })
    const ruleOnly = router.route(input({ ticketId: 'ticket-b', triggerId: 'trigger-b', triggerText: 'fix the bug' }))
    expect(ruleOnly).toMatchObject({ personaId: 'implement', reasonCode: 'rule' })
    expect(ruleOnly.signals?.rule).toBe('implement-request')
    const unknown = router.route(input({ ticketId: 'ticket-zzz', triggerId: 'trigger-zzz', triggerText: 'do the thing' }))
    expect(unknown.reasonCode).toBe('default')
  })
})

describe('modes', () => {
  it('off registers no router; fixed sets one Persona for every Ticket', () => {
    expect(createRouter(normalizeConfig({ mode: 'off' }))).toBeUndefined()
    const fixed = createRouter(normalizeConfig({ mode: 'fixed', persona: 'plan' }))!
    for (const ticketId of ['ticket-1', 'ticket-2']) {
      const decision = fixed.route(input({ ticketId }))
      expect(decision.personaId).toBe('plan')
      expect(decision.reasonCode).toBe('rule')
      expect(decision.signals?.mode).toBe('fixed')
    }
  })

  it('random is reproducible from seed and Ticket id, across instances and restarts', () => {
    const settings = normalizeConfig({ mode: 'random', seed: 'experiment-c' })
    const first = createRouter(settings)!
    const second = createRouter(settings)! // a "restart": a fresh router from the same config
    for (const ticketId of ['ticket-1', 'ticket-2', 'ticket-3']) {
      const decision = first.route(input({ ticketId }))
      expect(decision.personaId).toBe(randomPersonaFor(settings.seed, ticketId))
      expect(second.route(input({ ticketId })).personaId).toBe(decision.personaId)
      expect(decision.reasonCode).toBe('rule')
      expect(decision.signals).toMatchObject({ mode: 'random', seed: 'experiment-c', bucket: randomBucket(settings.seed, ticketId) })
    }
    const otherSeed = createRouter(normalizeConfig({ mode: 'random', seed: 'experiment-d' }))!
    const picks = (seedRouter: PersonaRouter) => Array.from({ length: 20 }, (_, index) => seedRouter.route(input({ ticketId: `ticket-${index}` })).personaId)
    expect(picks(otherSeed)).not.toEqual(picks(first))
  })

  it('validates config and defaults an absent one to rules', () => {
    expect(normalizeConfig(undefined)).toEqual({ mode: 'rules', seed: 'dsh-superagent' })
    expect(normalizeConfig({})).toEqual({ mode: 'rules', seed: 'dsh-superagent' })
    expect(() => normalizeConfig({ mode: 'bogus' })).toThrow(/"mode"/)
    expect(() => normalizeConfig({ mode: 'fixed' })).toThrow(/"persona" is required/)
    expect(() => normalizeConfig({ mode: 'fixed', persona: 'invent' })).toThrow(/"persona"/)
    expect(() => normalizeConfig({ mode: 'rules', extra: true })).toThrow(/unknown config key/)
    expect(() => normalizeConfig({ mode: 'rules', overridesPath: 'relative.json' })).toThrow(/absolute path/)
    expect(() => normalizeConfig({ mode: 'random', seed: '' })).toThrow(/"seed"/)
  })
})

describe('plugin', () => {
  it('registers the router on orchestrator.persona and disposes it with the plugin', () => {
    expect(name).toBe('dsh-superagent-persona-router')
    expect(inject).toEqual(['orchestrator'])
    const fake = host()
    apply(contextOf(fake, true), { mode: 'rules' })
    expect(fake.registered).toHaveLength(1)
    expect(fake.registered[0]?.id).toBe('dsh-superagent-persona-router')
    expect(fake.disposers).toHaveLength(1)
    fake.disposers[0]!()
    expect(fake.registered).toHaveLength(0)
    expect(messages(fake, 'info').join('\n')).toContain('registered persona router')
  })

  it('logs mode off and registers nothing', () => {
    const fake = host()
    apply(contextOf(fake, true), { mode: 'off' })
    expect(fake.registered).toHaveLength(0)
    expect(messages(fake, 'info').join('\n')).toContain('mode "off"')
  })

  it('stays inert when the Super-agent has no persona registry', () => {
    const fake = host()
    expect(() => apply(contextOf(fake, false), { mode: 'rules' })).not.toThrow()
    expect(fake.registered).toHaveLength(0)
    expect(messages(fake, 'warn').join('\n')).toContain('ctx.orchestrator.persona is absent')
  })

  it('refuses an invalid config and registers nothing', () => {
    const fake = host()
    expect(() => apply(contextOf(fake, true), { mode: 'bogus' } as never)).toThrow(/"mode"/)
    expect(() => apply(contextOf(fake, true), { mode: 'fixed' })).toThrow(/"persona"/)
    expect(fake.registered).toHaveLength(0)
  })

  it('routes with the configured override file and reports a bad entry once', () => {
    const path = join(temporary(), 'overrides.json')
    writeFileSync(path, JSON.stringify({ version: 1, byTicket: { 'ticket-a': 'review', 'ticket-b': 'invent' } }))
    const fake = host()
    apply(contextOf(fake, true), { mode: 'rules', overridesPath: path })
    const router = fake.registered[0]!
    expect(router.route(input({ ticketId: 'ticket-a' })).personaId).toBe('review')
    expect(router.route(input({ ticketId: 'ticket-b', triggerText: 'fix it' })).personaId).toBe('implement')
    expect(messages(fake, 'warn').join('\n')).toContain('ticket-b')
  })
})

describe('bundle', () => {
  it('is installable: the package metadata names the built entry and the bundle patch', () => {
    const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')) as {
      name?: string; version?: string; private?: boolean; type?: string; main?: string; files?: string[]
      dsh?: { bundle?: { patch?: string }; manifestVersion?: number }; peerDependencies?: Record<string, string>
    }
    expect(manifest.name).toBe('dsh-superagent-persona-router')
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.private).toBe(false)
    expect(manifest.type).toBe('module')
    expect(manifest.main).toBe('lib/index.js')
    expect(manifest.files).toEqual(['lib', 'cordis.patch.yml', 'README.md'])
    expect(manifest.dsh).toEqual({ bundle: { patch: './cordis.patch.yml' }, manifestVersion: 1 })
    // Minimal peers: the bundle imports only the Cordis Context type, never dsh-superagent.
    expect(manifest.peerDependencies).toEqual({ '@deepseek-ai/cordis': '4.0.5-alpha.1' })
  })

  it('imports nothing from the Super-agent or from the DSH identity persona row', () => {
    const sources = readdirSync(join(packageDirectory, 'src')).filter(name => name.endsWith('.ts'))
    expect(sources.length).toBeGreaterThan(0)
    const specifiers = sources.flatMap(name =>
      [...readFileSync(join(packageDirectory, 'src', name), 'utf8').matchAll(/from '([^']+)'/g)].map(match => match[1]!))
    for (const specifier of specifiers)
      expect(specifier === '@deepseek-ai/cordis' || specifier.startsWith('node:') || specifier.startsWith('./'), specifier).toBe(true)
    expect(specifiers.join('\n')).not.toContain('dsh-superagent')
    expect(specifiers.join('\n')).not.toContain('dsh-persona')
  })

  it('inserts the plugin after the Super-agent when its patch is applied to the profile layer', async () => {
    const cordis = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/cordis/package.json'))
    const include = cordis.resolve('@deepseek-ai/cordis-plugin-include')
    const { entryListSchema, applyEntryPatches } = await import(include) as {
      entryListSchema: unknown
      applyEntryPatches(data: Row[], patches: unknown[], warn: (message: string) => void): Row[]
    }
    const yaml = await import(createRequire(include).resolve('js-yaml')) as { load(text: string, options: { schema: unknown }): unknown }
    const patches = (path: string) => yaml.load(readFileSync(path, 'utf8'), { schema: entryListSchema }) as unknown[]
    const warnings: string[] = []
    const rows = applyEntryPatches([], [...patches(join(packageDirectory, '..', '..', 'cordis.patch.yml')), ...patches(join(packageDirectory, 'cordis.patch.yml'))],
      message => warnings.push(message))
    expect(warnings).toEqual([])
    const ids = rows.map(row => row.id)
    const superagent = ids.indexOf('dsh-superagent')
    expect(superagent).toBeGreaterThanOrEqual(0)
    expect(ids.at(-1)).toBe('dsh-superagent-persona-router')
    expect(rows.at(-1)?.name).toBe('dsh-superagent-persona-router')
    expect(ids.indexOf('dsh-superagent-persona-router')).toBeGreaterThan(superagent)
  })
})

/** A bundle patch row, as the entry-list dialect reads it. */
interface Row { id?: string; name: string }
