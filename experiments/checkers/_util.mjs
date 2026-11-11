/** Shared helpers for the arm-independent acceptance checkers. Usage: node <checker>.mjs <workspace> */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

export const workspace = () => process.argv[2] ?? process.cwd()
export const read = (relative) => {
  try { return readFileSync(join(workspace(), relative), 'utf8') } catch { return '' }
}
export const hasFile = (relative) => existsSync(join(workspace(), relative))
export const check = (name, ok, detail = '') => ({ name, ok: !!ok, detail: String(detail).slice(0, 600) })
/** True when git reports no change under the given paths (source/test must stay untouched for read-only tasks). */
export function unchanged(paths) {
  const result = spawnSync('git', ['-C', workspace(), 'status', '--porcelain', '--', ...paths], { encoding: 'utf8' })
  return { clean: result.status === 0 && result.stdout.trim() === '', detail: (result.stdout ?? '') + (result.stderr ?? '') }
}
export function nodeTest(timeout = 180_000) {
  const result = spawnSync(process.execPath, ['--test'], { cwd: workspace(), encoding: 'utf8', timeout })
  return { ok: result.status === 0, detail: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(-1200) }
}
/** Import a workspace ES module in this process. */
export const importFromWorkspace = (relative) => import(new URL(`file:///${join(workspace(), relative).replace(/\\/g, '/')}`).href)
export function report(checks) {
  const pass = checks.every(item => item.ok)
  console.log(JSON.stringify({ pass, checks }, null, 2))
  process.exit(pass ? 0 : 1)
}
export const containsAll = (text, needles) => needles.filter(needle => !new RegExp(needle, 'i').test(text))
