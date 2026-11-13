import { OAuth2Client } from 'google-auth-library'
import { z } from 'zod'
import { mailTrigger, MAX_MESSAGE_BYTES } from './mail-message.ts'
import type { MailPoll } from './index.ts'

export const GmailCredentials = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().min(1),
})
const Profile = z.object({ emailAddress: z.string(), historyId: z.string() })
const History = z.object({
  historyId: z.string(),
  nextPageToken: z.string().optional(),
  history: z.array(z.object({
    messagesAdded: z.array(z.object({ message: z.object({ id: z.string() }) })).optional(),
  })).optional(),
})
const Message = z.object({
  id: z.string(), threadId: z.string(), internalDate: z.coerce.number(),
  sizeEstimate: z.number(), labelIds: z.array(z.string()).default([]), raw: z.string().optional(),
})

export const pollGmail: MailPoll = async (credentials, ctx, signal, active) => {
  const { clientId, clientSecret, refreshToken } = GmailCredentials.parse(credentials)
  const client = new OAuth2Client({ clientId, clientSecret })
  client.setCredentials({ refresh_token: refreshToken })
  const request = async (path: string, params?: Record<string, string>): Promise<unknown> =>
    (await client.request({ url: `https://gmail.googleapis.com/gmail/v1/users/me/${path}`, params, signal, timeout: 20_000 })).data
  const profile = Profile.parse(await request('profile'))
  const cursorKey = `mail:gmail:history:${profile.emailAddress.toLowerCase()}`
  const cursor = ctx.state.get<string>(cursorKey)
  if (!cursor) {
    if (active()) ctx.state.set(cursorKey, profile.historyId)
    return
  }

  const ids = new Set<string>()
  let pageToken: string | undefined
  let latest = cursor
  do {
    const page = History.parse(await request('history', {
      startHistoryId: cursor, historyTypes: 'messageAdded', ...(pageToken ? { pageToken } : {}),
    }))
    for (const event of page.history ?? []) {
      for (const added of event.messagesAdded ?? []) ids.add(added.message.id)
    }
    latest = page.historyId
    pageToken = page.nextPageToken
  } while (pageToken && active())

  for (const id of ids) {
    if (!active()) return
    const path = `messages/${encodeURIComponent(id)}`
    try {
      const metadata = Message.parse(await request(path, { format: 'metadata' }))
      if (!metadata.labelIds.includes('INBOX') || metadata.labelIds.includes('CATEGORY_PROMOTIONS')
        || metadata.sizeEstimate > MAX_MESSAGE_BYTES) continue
      const message = Message.parse(await request(path, { format: 'raw' }))
      if (!message.raw || !message.labelIds.includes('INBOX')) continue
      const trigger = await mailTrigger({
        source: 'gmail', account: profile.emailAddress, id: message.id, thread: message.threadId,
        received: new Date(message.internalDate), raw: Buffer.from(message.raw, 'base64url'), labels: message.labelIds,
      })
      if (trigger && active()) await ctx.receive(trigger)
    } catch (error) {
      if ((error as { response?: { status?: number } }).response?.status !== 404) throw error
    }
  }
  if (active()) ctx.state.set(cursorKey, latest)
}
