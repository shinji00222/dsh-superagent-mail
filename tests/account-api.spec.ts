import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

vi.mock('../src/mail-icloud.ts', () => ({ openICloudInbox: vi.fn(async () => {}) }))

it('keeps multiple accounts and never returns credentials to the account list', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-mail-'))
  vi.stubEnv('DSH_HOME', directory)
  const server = createServer()
  let dispose: (() => void) | undefined
  try {
    const { registerAccounts } = await import('../src/account-api.ts')
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test port')
    dispose = registerAccounts({
      host: '127.0.0.1', port: address.port,
      register: ({ handler }) => {
        server.on('request', handler)
        return () => server.off('request', handler)
      },
    })
    const base = `http://127.0.0.1:${address.port}/superagent-mail/api`
    const headers = { 'x-superagent-mail': '1' }
    const unauthorized = await fetch(base + '/accounts', { headers: { ...headers, origin: 'https://example.test' } })
    expect(unauthorized.status).toBe(403)
    for (const email of ['first@example.test', 'second@example.test', 'first@example.test']) {
      const added = await fetch(base + '/icloud', {
        method: 'POST', headers, body: JSON.stringify({ email, appPassword: 'test-only' }),
      })
      expect(added.ok).toBe(true)
    }
    const list = await (await fetch(base + '/accounts', { headers })).json()
    expect(list.accounts.map((account: { email: string }) => account.email).sort())
      .toEqual(['first@example.test', 'second@example.test'])
    expect(JSON.stringify(list)).not.toContain('test-only')
    const removed = await fetch(base + '/accounts/' + list.accounts[0].id, { method: 'DELETE', headers })
    expect(removed.ok).toBe(true)
    const remaining = await (await fetch(base + '/accounts', { headers })).json()
    expect(remaining.accounts).toHaveLength(1)
  } finally {
    dispose?.()
    await new Promise<void>(resolve => server.close(() => resolve()))
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true, force: true })
  }
})
