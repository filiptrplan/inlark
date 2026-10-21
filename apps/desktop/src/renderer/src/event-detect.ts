import { isDraft, type Message } from '@inlark/core'
import { isUpcoming, type DetectedEvent } from './calendar-event'
import { findMarkupEvents } from './event-markup'
import { findTextEvent } from './event-text'
import { messageText } from './message-text'

/** Events a message describes: booking markup when present, otherwise dates in its prose. */
export function findEvents(
  html: string | undefined,
  text: () => string,
  subject: string,
  receivedAt: string,
): DetectedEvent[] {
  const marked = findMarkupEvents(html)
  if (marked.length) return marked
  const prose = findTextEvent(text(), subject, receivedAt)
  return prose ? [prose] : []
}

const cache = new WeakMap<Message, DetectedEvent[]>()

/** Upcoming events in a received message (invite attachments are read separately). */
export function messageEvents(message: Message, now = Date.now()): DetectedEvent[] {
  if (isDraft(message)) return []
  if (!cache.has(message))
    cache.set(
      message,
      findEvents(message.html, () => messageText(message), message.subject, message.receivedAt),
    )
  return cache.get(message)!.filter((event) => isUpcoming(event, now))
}

/** The first event of the newest message that has one. */
export function latestEvent(
  messages: Message[],
): { event: DetectedEvent; message: Message } | null {
  for (const message of [...messages].reverse()) {
    const [event] = messageEvents(message)
    if (event) return { event, message }
  }
  return null
}

/** Whether a message carries an iCalendar attachment worth reading. */
export const inviteAttachment = (message: Message) =>
  message.attachments?.find(
    (attachment) =>
      attachment.size <= 256 * 1024 &&
      (/^text\/calendar/i.test(attachment.type) || /\.ics$/i.test(attachment.name)),
  )
