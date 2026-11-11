#!/usr/bin/env node
/** Aggregate fake campaign evidence and create blind scoring material. */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined }
const mode = process.argv[2]
const campaign = resolve(root, arg('--campaign') ?? process.argv[3] ?? '')
if (!campaign || !existsSync(join(campaign, 'campaign.json'))) { console.error('usage: node experiments/aggregate.mjs --summary|--anonymize|--scores --campaign <dir>'); process.exit(2) }
const data = JSON.parse(readFileSync(join(campaign, 'campaign.json'), 'utf8'))
const taskDefinitions = Object.fromEntries(JSON.parse(readFileSync(join(root, 'experiments', 'tasks', 'tasks.json'), 'utf8')).tasks.map(task => [task.id, task]))
const runs = []
for (const arm of data.arms) for (const run of arm.runs) {
  const result = JSON.parse(readFileSync(join(campaign, arm.arm, run.taskId, 'result.json'), 'utf8'))
  runs.push({ arm: arm.arm, taskId: run.taskId, runId: run.runId, pass: result.acceptance.pass === true, persona: result.decision?.personaId ?? null, reproducible: result.reproducible, durationMs: result.durationMs, totalTokens: result.usage.totalTokens })
}
function write(path, value) { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, value) }
function summary() {
  const rows = data.arms.map(arm => {
    const group = runs.filter(run => run.arm === arm.arm)
    return { arm: arm.arm, mode: arm.mode, taskCount: group.length, passed: group.filter(run => run.pass).length, acceptancePassRate: group.length ? group.filter(run => run.pass).length / group.length : null, personas: Object.fromEntries([...new Set(group.map(run => run.persona ?? 'native'))].map(persona => [persona, group.filter(run => (run.persona ?? 'native') === persona).length])), placeholderTokens: group.reduce((sum, run) => sum + run.totalTokens, 0), durationMs: group.reduce((sum, run) => sum + run.durationMs, 0), randomReproducible: arm.arm === 'C' ? group.every(run => run.reproducible) : null }
  })
  const result = { schema: 1, kind: data.kind, snapshot: data.snapshot, model: data.model, placeholderMetrics: true, rows, runs }
  write(join(campaign, 'summary.json'), JSON.stringify(result, null, 2) + '\n')
  const csv = ['arm,mode,task_count,passed,acceptance_pass_rate,placeholder_tokens,duration_ms,random_reproducible', ...rows.map(row => [row.arm, row.mode, row.taskCount, row.passed, row.acceptancePassRate, row.placeholderTokens, row.durationMs, row.randomReproducible ?? ''].join(','))].join('\n') + '\n'
  write(join(campaign, 'summary.csv'), csv)
  return result
}
function anonymize() {
  const shuffleId = createHash('sha256').update(`${data.snapshot}:${data.model}`).digest('hex').slice(0, 12)
  const blind = join(campaign, 'blind', shuffleId)
  const key = []
  const ordered = [...runs].sort((a, b) => createHash('sha256').update(`${shuffleId}:${a.runId}`).digest('hex').localeCompare(createHash('sha256').update(`${shuffleId}:${b.runId}`).digest('hex')))
  for (let index = 0; index < ordered.length; index++) {
    const run = ordered[index]
    const anonId = `run-${String(index + 1).padStart(2, '0')}`
    const source = join(campaign, run.arm, run.taskId, 'workspace')
    const target = join(blind, anonId, 'workspace')
    const artifacts = taskDefinitions[run.taskId]?.artifacts ?? []
    for (const artifact of artifacts) {
      const from = join(source, artifact)
      const to = join(target, artifact)
      if (existsSync(from)) { mkdirSync(resolve(to, '..'), { recursive: true }); cpSync(from, to) }
    }
    write(join(blind, anonId, 'manifest.json'), JSON.stringify({ anonId, taskId: run.taskId, artifactsOnly: true, artifacts }, null, 2) + '\n')
    key.push({ anonId, arm: run.arm, taskId: run.taskId, runId: run.runId })
  }
  write(join(campaign, 'blind', 'key.json'), JSON.stringify({ schema: 1, shuffleId, key }, null, 2) + '\n')
  write(join(campaign, 'blind', shuffleId, 'README.md'), `# Blind artifact bundle ${shuffleId}\n\nThe arm labels and run metrics are intentionally excluded. Score artifacts using experiments/blind/rubric.md, then save CSV as blind/sheets/${shuffleId}.csv.\n`)
  return { shuffleId, count: ordered.length, directory: blind, key: join(campaign, 'blind', 'key.json') }
}
function scores() {
  const keyDoc = JSON.parse(readFileSync(join(campaign, 'blind', 'key.json'), 'utf8'))
  const sheet = join(campaign, 'blind', 'sheets', `${keyDoc.shuffleId}.csv`)
  if (!existsSync(sheet)) throw new Error(`score sheet missing: ${sheet}`)
  const lines = readFileSync(sheet, 'utf8').trim().split(/\r?\n/)
  const header = lines.shift().split(',')
  const scores = lines.map(line => Object.fromEntries(line.split(',').map((value, i) => [header[i], value])))
  const joined = scores.map(score => ({ ...score, ...keyDoc.key.find(item => item.anonId === score.shuffle_id) })).filter(item => item.arm)
  write(join(campaign, 'blind', 'scores.json'), JSON.stringify({ schema: 1, shuffleId: keyDoc.shuffleId, scores: joined }, null, 2) + '\n')
  return { shuffleId: keyDoc.shuffleId, scores: joined.length, output: join(campaign, 'blind', 'scores.json') }
}
const result = mode === '--summary' ? summary() : mode === '--anonymize' ? anonymize() : mode === '--scores' ? scores() : null
if (!result) { console.error('usage: node experiments/aggregate.mjs --summary|--anonymize|--scores --campaign <dir>'); process.exit(2) }
console.log(JSON.stringify(result, null, 2))