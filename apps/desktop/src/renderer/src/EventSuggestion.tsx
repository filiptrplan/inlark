import { cn } from '@inlark/ui'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarAdd, Check } from '@inlark/ui/icons'
import type { Message } from '@inlark/core'
import type { CalendarBridge } from '../../preload/calendar'
import { api } from './api'
import { googleCalendarUrl, isUpcoming, type DetectedEvent } from './calendar-event'
import { parseInvite } from './event-ics'
import { inviteAttachment, messageEvents } from './event-detect'
import { ShortcutHint } from './shortcuts'

declare global {
  interface Window {
    inlarkCalendar?: CalendarBridge
  }
}

const dateOnly = /^\d{4}-\d{2}-\d{2}$/

/** The instant an event starts as the reader's own clock sees it; floating times read as local. */
function local(value: string) {
  if (dateOnly.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day)
  }
  return new Date(value)
}

/** "Thu, 12 Nov, 07:40 – 09:05", or "Thu, 3 Dec – Sat, 5 Dec" for stays. */
export function describeWhen(event: DetectedEvent) {
  const day: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }
  const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }
  const start = local(event.start)
  if (event.allDay) {
    const format = new Intl.DateTimeFormat(undefined, day)
    // An all-day end is exclusive, so a one-day event has no range to show.
    const last = event.end ? new Date(local(event.end).getTime() - 86_400_000) : start
    return last.getTime() > start.getTime()
      ? format.format(start) + ' – ' + format.format(last)
      : format.format(start)
  }
  const head = new Intl.DateTimeFormat(undefined, { ...day, ...time }).format(start)
  if (!event.end) return head
  const end = local(event.end)
  const sameDay = start.toDateString() === end.toDateString()
  return (
    head +
    ' – ' +
    new Intl.DateTimeFormat(undefined, sameDay ? time : { ...day, ...time }).format(end)
  )
}

/** Opens Google Calendar's new-event page for the event in the browser. */
export const addToCalendar = (event: DetectedEvent) => api.openExternal(googleCalendarUrl(event))

/** Upcoming events in a message: booking markup first, then an attached invite, then its prose. */
function useMessageEvents(message: Message) {
  const found = messageEvents(message)
  const attachment = found[0]?.source === 'markup' ? undefined : inviteAttachment(message)
  const bridge = window.inlarkCalendar
  const invite = useQuery({
    queryKey: ['calendar-invite', message.accountId, attachment?.blobId],
    enabled: !!attachment && !!bridge,
    staleTime: Infinity,
    retry: false,
    queryFn: async () =>
      parseInvite(await bridge!.invite(message.accountId, attachment!)).filter((event) =>
        isUpcoming(event, Date.now()),
      ),
  })
  return invite.data?.length ? invite.data : found
}

/** A recent message's booking or event, one click from the reader's calendar. */
export function EventSuggestion({ message }: { message: Message }) {
  const events = useMessageEvents(message)
  const [status, setStatus] = useState<{ index: number; kind: 'opened' | 'failed' } | null>(null)
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  if (!events.length) return null
  const add = (event: DetectedEvent, index: number) => {
    window.clearTimeout(timer.current)
    void addToCalendar(event).then(
      () => setStatus({ index, kind: 'opened' }),
      () => setStatus({ index, kind: 'failed' }),
    )
    timer.current = window.setTimeout(() => setStatus(null), 2500)
  }
  return (
    <div className="event-suggestion mb-4.5 flex flex-col gap-2">
      {events.map((event, index) => {
        const mine = status?.index === index ? status.kind : null
        return (
          <button
            key={event.start + event.title}
            type="button"
            className={cn(
              'event-suggestion-card flex w-full items-center justify-between gap-6 py-3 pr-3 pl-4 rounded-xl border',
              'border-solid border-border-strong bg-surface text-left transition-[background,border-color] duration-120',
              'ease-[ease] hover:bg-hover hover:border-foreground/22',
            )}
            onClick={() => add(event, index)}
            title="Add to Google Calendar"
          >
            <span className="flex flex-col gap-1 min-w-0">
              <span className="text-[11px] text-muted">Event</span>
              <span className="truncate text-[14px] leading-tight font-medium text-foreground">
                {event.title}
              </span>
              <span className="truncate text-[12px] text-secondary">
                {describeWhen(event)}
                {event.location ? ' · ' + event.location : ''}
              </span>
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-hover text-[12px] font-medium shrink-0',
                mine === 'opened'
                  ? 'text-success'
                  : mine === 'failed'
                    ? 'text-danger'
                    : 'text-secondary',
              )}
            >
              {mine === 'opened' ? <Check size={14} /> : <CalendarAdd size={14} />}
              {mine === 'opened'
                ? 'Opened'
                : mine === 'failed'
                  ? 'Couldn’t open'
                  : 'Add to calendar'}
              {!mine && index === 0 && event.source !== 'invite' && (
                <ShortcutHint id="addToCalendar" />
              )}
            </span>
          </button>
        )
      })}
      <span className="sr-only" role="status">
        {status?.kind === 'opened'
          ? 'Opened Google Calendar'
          : status?.kind === 'failed'
            ? 'Could not open Google Calendar'
            : ''}
      </span>
    </div>
  )
}
