/**
 * Host-boundary adaptation for the isolated-profile e2e.
 *
 * Two Windows-only baseline gaps are adapted here, both outside the Persona feature under test:
 *
 * 1. `dsh-superagent`'s `Config.stateDir` is validated as an absolute POSIX-style path (`/^\//`), so
 *    a Windows profile passes e.g. `/Users/me/state` (Node maps it to `C:\Users\me\state`). DSH's
 *    `workspaceRegistry.create` instead requires a *fully qualified* Windows path (a drive or UNC
 *    root, not `\`), and the Runtime passes its `stateDir` and ticket directories through it for the
 *    main and worker Sessions. Only that call boundary is adapted: a drive-less rooted path is
 *    prefixed with the current drive.
 *
 * 2. `Sessions.decorate` restricts the main Session's tools to
 *    `['skill','bash','read','read_image','job_output','job_list','job_kill']`. That allow-list is
 *    hardcoded in the baseline (`src/app/sessions.ts`) and includes `bash`, but the shipped profile
 *    disables `tool-bash` on win32, so DSH's `tools.restrict` throws “unknown global tool bash”.
 *    The e2e profile therefore registers a *placeholder* global `bash` tool: it makes the name known
 *    to the allow-list, and the scripted model never calls it. This is a documented profile-level
 *    compatibility shim, not a change to the Super-agent.
 */
export const name = 'e2e-host'
export const inject = ['workspaceRegistry', 'tools']

/**
 * Prefix a drive-less rooted path with the current drive; leave fully qualified paths untouched.
 * The Runtime can hand over the stateDir spelling (`/Users/...`) or a path it already joined with
 * `path.join` (`\Users\...`), so both single-separator roots are qualified. UNC/extended paths
 * (`//server`, `\\?\`, `\\.\`) and drive paths (`C:\`) pass through.
 */
function qualify(path) {
  if (typeof path !== 'string') return path
  if (/^[A-Za-z]:/.test(path)) return path
  if (/^[\\/]{2}/.test(path)) return path
  if (!/^[\\/]/.test(path)) return path
  const drive = String(process.env.SystemDrive ?? process.cwd().slice(0, 2))
  return `${drive}${path}`
}

/** A never-executed stand-in so the baseline main-Session allow-list's `bash` name resolves on Windows. */
const bashPlaceholder = {
  name: 'bash',
  description: 'Placeholder registered by the isolated e2e profile so the baseline main-Session tool allow-list resolves on Windows. It is never executed.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command; ignored by this placeholder.' },
      timeoutMs: { type: 'number' },
      run_in_background: { type: 'boolean' },
    },
    required: ['command'],
    additionalProperties: true,
  },
  output: {
    schema: { type: 'object', properties: { text: { type: 'string' } }, additionalProperties: true },
    render: () => [{ type: 'text', text: 'bash is a placeholder in the isolated e2e profile and is never executed.' }],
  },
  execute: async () => ({ text: 'bash is a placeholder in the isolated e2e profile and is never executed.' }),
}

export function apply(ctx, config = {}) {
  const registry = ctx.workspaceRegistry
  const original = registry.create.bind(registry)
  const create = (path, title) => original(qualify(path), title)
  try { registry.create = create } catch {
    Object.defineProperty(registry, 'create', { configurable: true, value: create })
  }
  ctx.tools.register(bashPlaceholder)
  ctx.logger.info('e2e-host: workspaceRegistry.create qualifies drive-less rooted paths and a placeholder bash tool is registered (SystemDrive=%s)',
    process.env.SystemDrive ?? process.cwd().slice(0, 2))
}
