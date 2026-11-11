/** Stable content-derived identifiers; equal inputs always produce the same id. */
import { createHash } from 'node:crypto'
export function key(...values: string[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)
}
/** The one Session a Ticket's Assignments run in; derived here so core can record it without importing the Executor. */
export const workerSessionId = (ticketId: string): string => `worker-${ticketId}`
/** The Ticket a worker Session belongs to (`worker-<ticketId>`), or undefined for any other Session. */
export const ticketOfSession = (sessionId: string): string | undefined =>
  sessionId.startsWith('worker-') ? sessionId.slice('worker-'.length) : undefined
