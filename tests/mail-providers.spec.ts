import { beforeEach, expect, it, vi } from 'vitest'
import { pollGmail } from '../src/mail-gmail.ts'
import { pollICloud } from '../src/mail-icloud.ts'
import type { Trigger } from '../src/host.ts'

const providers = vi.hoisted(() => ({
  gmail: vi.fn(),
  imap: { on: vi.fn(), connect: vi.fn(), mailboxOpen: vi.fn(), search: vi.fn(), fetchOne: vi.fn(), close: vi.fn() },
}))
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    setCredentials() {}
    request = providers.gmail
  },
}))
vi.mock('imapflow', () => ({
  ImapFlow: class {
    constructor() { return providers.imap }
  },
}))

function mailbox() {
  const saved = new Map<string, unknown>()
  const received = new Map<string, Trigger>()
  const ctx = {
    state: { get: <T>(name: string) => saved.get(name) as T | undefined, set: <T>(name: string, value: T) => { saved.set(name, value) } },
    receive: vi.fn(async (trigger: Trigger) => { received.set(trigger.id, trigger) }),
  }
  return { ctx, saved, received, signal: new AbortController().signal }
}

const raw = Buffer.from('From: example@example.test\r\nSubject: Action\r\n\r\nPlease update the heading.')
const gmail = { clientId: 'test', clientSecret: 'test', refreshToken: 'test' }
const icloud = { email: 'recipient@example.test', appPassword: 'test' }
const active = () => true

beforeEach(() => vi.resetAllMocks())

it('starts Gmail from a fresh history ID, filters promotions and retries with stable IDs', async () => {
  const { ctx, saved, received, signal } = mailbox()
  const profile = { emailAddress: 'recipient@example.test', historyId: '10' }
  providers.gmail.mockResolvedValueOnce({ data: profile })
  await pollGmail(gmail, ctx, signal, active)
  expect(providers.gmail).toHaveBeenCalledTimes(1)
  expect(ctx.receive).not.toHaveBeenCalled()

  providers.gmail.mockImplementation(async ({ url }) => {
    if (url.endsWith('/profile')) return { data: profile }
    if (url.endsWith('/history')) return { data: { historyId: '11', history: [{ messagesAdded:
      ['one', 'ad'].map(id => ({ message: { id } })) }] } }
    const id = url.split('/').at(-1)
    return { data: { id, threadId: 'thread', internalDate: '1760000000000', sizeEstimate: raw.length,
      labelIds: id === 'ad' ? ['INBOX', 'CATEGORY_PROMOTIONS'] : ['INBOX'], raw: raw.toString('base64url') } }
  })
  await pollGmail(gmail, ctx, signal, active)
  expect(received.size).toBe(1)
  expect([...saved.values()]).toEqual(['11'])
  // A crash after intake but before advancing the cursor replays the same trigger ID.
  saved.set('mail:gmail:history:recipient@example.test', '10')
  await pollGmail(gmail, ctx, signal, active)
  expect(received.size).toBe(1)
  expect(ctx.receive).toHaveBeenCalledTimes(2)
})

it('opens iCloud read-only and reads only UIDs after the first successful connection', async () => {
  const { ctx, saved, received, signal } = mailbox()
  providers.imap.mailboxOpen.mockResolvedValueOnce({ uidNext: 9, uidValidity: 1n })
  await pollICloud(icloud, ctx, signal, active)
  expect(providers.imap.mailboxOpen).toHaveBeenCalledWith('INBOX', { readOnly: true })
  expect(providers.imap.search).not.toHaveBeenCalled()

  providers.imap.mailboxOpen.mockResolvedValue({ uidNext: 10, uidValidity: 1n })
  providers.imap.search.mockResolvedValue([9])
  providers.imap.fetchOne.mockResolvedValueOnce({ size: raw.length, internalDate: new Date() })
    .mockResolvedValueOnce({ source: raw })
  await pollICloud(icloud, ctx, signal, active)
  expect(providers.imap.search).toHaveBeenCalledWith({ uid: '9:9' }, { uid: true })
  expect(received.size).toBe(1)
  expect([...saved.values()]).toEqual([{ uidValidity: '1', uid: 9, connectedAt: expect.any(String) }])
})
