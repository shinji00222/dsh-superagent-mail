import { ImapFlow } from 'imapflow'
import { z } from 'zod'
import { mailTrigger, MAX_MESSAGE_BYTES } from './mail-message.ts'
import type { MailPoll } from './index.ts'

const Credentials = z.object({
  email: z.email(),
  appPassword: z.string().min(1),
})
type Cursor = { uidValidity: string; uid: number; connectedAt?: string }

export const pollICloud: MailPoll = async (credentials, ctx, signal, active) => {
  const { email, appPassword } = Credentials.parse(credentials)
  const account = email.toLowerCase()
  const startedAt = new Date(Math.floor(Date.now() / 1000) * 1000)
  const client = new ImapFlow({
    host: 'imap.mail.me.com', port: 993, secure: true,
    auth: { user: email, pass: appPassword },
    logger: false, disableAutoIdle: true, connectionTimeout: 15_000,
    greetingTimeout: 15_000, socketTimeout: 30_000,
  })
  const stop = () => client.close()
  signal.addEventListener('abort', stop, { once: true })
  client.on('error', stop)
  try {
    if (!active()) return
    await client.connect()
    const mailbox = await client.mailboxOpen('INBOX', { readOnly: true })
    const cursorKey = `mail:icloud:uid:${account}`
    const cursor = ctx.state.get<Cursor>(cursorKey)
    const uidValidity = mailbox.uidValidity.toString()
    if (!cursor) {
      if (active()) ctx.state.set(cursorKey, { uidValidity, uid: mailbox.uidNext - 1, connectedAt: startedAt.toISOString() })
      return
    }
    if (cursor.uidValidity !== uidValidity) throw new Error('Mailbox UIDVALIDITY changed')
    const last = mailbox.uidNext - 1
    if (!active() || cursor.uid >= last) return

    const uids = await client.search({ uid: `${cursor.uid + 1}:${last}` }, { uid: true })
    if (!uids) throw new Error('Inbox search failed')
    for (const uid of uids.sort((a, b) => a - b)) {
      if (!active()) return
      const metadata = await client.fetchOne(String(uid), { size: true, internalDate: true }, { uid: true })
      if (!metadata || !metadata.size || metadata.size > MAX_MESSAGE_BYTES || !metadata.internalDate) continue
      const received = new Date(metadata.internalDate)
      if (cursor.connectedAt && received < new Date(cursor.connectedAt)) continue
      const message = await client.fetchOne(String(uid), { source: true }, { uid: true })
      if (!message || !message.source) continue
      const trigger = await mailTrigger({
        source: 'icloud', account, id: `${uidValidity}:${uid}`, received, raw: message.source,
      })
      if (trigger && active()) await ctx.receive(trigger)
    }
    if (active()) ctx.state.set(cursorKey, { ...cursor, uid: last })
  } finally {
    signal.removeEventListener('abort', stop)
    client.close()
  }
}
