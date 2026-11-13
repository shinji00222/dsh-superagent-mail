import { expect, it } from 'vitest'
import { mailTrigger } from '../src/mail-message.ts'

const mail = (id: string, extras = '', thread = id) => mailTrigger({
  source: 'gmail', account: 'receiver@example.test', id, thread, received: new Date('2026-11-13T01:00:00Z'),
  raw: Buffer.from(`From: Sender <sender@example.test>\r\nSubject: Copy fix\r\n${extras}\r\nPlease correct the typo in the heading.`),
})

it('filters bulk and automatic mail, and keys retries and replies consistently', async () => {
  expect(await mail('bulk', 'List-Id: <announcements.example.test>\r\n')).toBeUndefined()
  expect(await mail('auto', 'Auto-Submitted: auto-generated\r\n')).toBeUndefined()
  const first = await mail('first', '', 'thread')
  const reply = await mail('second', '', 'thread')
  expect(first?.id).toBe((await mail('first', '', 'thread'))?.id)
  expect(first?.threads).toEqual(reply?.threads)
  expect(first?.id).not.toBe(reply?.id)
  expect(first?.addressed).toBeUndefined()
})
