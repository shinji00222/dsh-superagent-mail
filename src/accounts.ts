import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { GmailCredentials } from './mail-gmail.ts'
import type { MailSource } from './mail-message.ts'

export const DesktopClient = z.object({ installed: z.object({
  client_id: z.string().endsWith('.apps.googleusercontent.com'),
  client_secret: z.string().min(1).max(500),
}) })
export const ICloudCredentials = z.object({
  email: z.email().max(254).transform(value => value.toLowerCase()),
  appPassword: z.string().min(1).max(64),
})
const Account = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('gmail'), email: z.email(), credentials: GmailCredentials }),
  z.object({ provider: z.literal('icloud'), email: z.email(), credentials: ICloudCredentials }),
])
type Account = z.infer<typeof Account>

const root = join(process.env.DSH_HOME || (process.platform === 'win32'
  ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  : join(homedir(), '.config')), 'DSH-Superagent-Mail')
const clientPath = join(root, 'google-client.json')
const accountId = (provider: MailSource, email: string) =>
  createHash('sha256').update(JSON.stringify([provider, email.toLowerCase()])).digest('hex')

async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function save(path: string, value: unknown): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const temporary = join(root, randomUUID() + '.tmp')
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

export async function googleClient() {
  if (process.env.DSH_MAIL_GOOGLE_CLIENT_ID && process.env.DSH_MAIL_GOOGLE_CLIENT_SECRET) {
    return DesktopClient.parse({ installed: {
      client_id: process.env.DSH_MAIL_GOOGLE_CLIENT_ID, client_secret: process.env.DSH_MAIL_GOOGLE_CLIENT_SECRET,
    } }).installed
  }
  const value = await readJson(clientPath)
  return value === undefined ? undefined : DesktopClient.parse(value).installed
}

export async function saveGoogleClient(value: unknown) {
  await save(clientPath, DesktopClient.parse(value))
}

export async function accounts() {
  const files = await readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const records = await Promise.all(files.filter(file => /^[a-f0-9]{64}\.json$/.test(file)).map(async file => {
    const record = Account.safeParse(await readJson(join(root, file)))
    if (!record.success) return undefined
    const { provider, email, credentials } = record.data
    return { id: accountId(provider, email), provider, email, credentials }
  }))
  return records.filter(record => record !== undefined)
}

export async function saveAccount(account: Account) {
  await save(join(root, accountId(account.provider, account.email) + '.json'), Account.parse(account))
}

export async function removeAccount(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid account ID')
  await unlink(join(root, id + '.json')).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}
