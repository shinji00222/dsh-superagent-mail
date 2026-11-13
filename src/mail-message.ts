import { simpleParser } from 'mailparser'
import { createHash } from 'node:crypto'
import type { Trigger } from './host.ts'

const key = (...values: string[]) => createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)

export type MailSource = 'gmail' | 'icloud'
export const isMailSource = (source: string): source is MailSource => source === 'gmail' || source === 'icloud'
export const MAX_MESSAGE_BYTES = 512 * 1024

export async function mailTrigger(input: {
  source: MailSource
  account: string
  id: string
  thread?: string
  received: Date
  raw: Buffer
  labels?: string[]
}): Promise<Trigger | undefined> {
  if (input.raw.length > MAX_MESSAGE_BYTES || input.labels?.some(label =>
    ['SPAM', 'TRASH', 'SENT', 'DRAFT', 'CATEGORY_PROMOTIONS'].includes(label))) return

  const mail = await simpleParser(input.raw, { skipImageLinks: true, skipTextToHtml: true })
  const sender = mail.from?.value[0]?.address?.trim().toLowerCase()
  if (!sender || sender === input.account.toLowerCase() || !Number.isFinite(input.received.getTime())) return
  const auto = String(mail.headers.get('auto-submitted') ?? '').toLowerCase()
  const precedence = String(mail.headers.get('precedence') ?? '').toLowerCase()
  const list = mail.headers.get('list')
  if ((auto && auto !== 'no') || ['bulk', 'junk', 'list'].includes(precedence)
    || list || mail.headers.has('list-unsubscribe') || mail.headers.has('list-id')) return

  const references = Array.isArray(mail.references) ? mail.references : [mail.references]
  const thread = input.thread || references[0] || mail.inReplyTo || mail.messageId || input.id
  const subject = mail.subject?.slice(0, 240) || '(no subject)'
  const body = (mail.text ?? '').replace(/\u0000/g, '').slice(0, 8000)
  return {
    id: key(input.source, input.account, input.id),
    source: input.source,
    threads: [{ source: input.source, id: key(input.source, input.account, thread) }],
    actor: { source: input.source, id: sender },
    human: true,
    at: input.received.toISOString(),
    text: `Subject: ${subject}\nFrom: ${sender}\n\n${body}`,
    meta: { subject },
  }
}
