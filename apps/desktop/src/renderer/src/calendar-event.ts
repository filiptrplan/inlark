/** An upcoming event found in a message, ready to hand to a calendar. */
export interface DetectedEvent {
  title: string
  /** `YYYY-MM-DD` for all-day, an offset or `Z` timestamp for an instant, otherwise floating local time. */
  start: string
  /** Exclusive for all-day events. */
  end?: string
  allDay: boolean
  /** IANA zone a floating time belongs to. */
  timeZone?: string
  location?: string
  details?: string
  source: 'markup' | 'invite' | 'text'
}

const hour = 60 * 60 * 1000
const day = 24 * hour
const dateOnly = /^\d{4}-\d{2}-\d{2}$/
const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i

/** Milliseconds for a value, reading floating times as if they were UTC. */
export function whenMs(value: string): number {
  return Date.parse(dateOnly.test(value) || hasOffset.test(value) ? value : value + 'Z')
}

/** A date or timestamp as a valid ISO string with a colon-separated offset, or null. */
export function normalizeWhen(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/i.test(text)
  )
    return null
  const full = text.replace(/(T\d{2}:\d{2})(?=Z|[+-]\d{2}:\d{2}$|$)/i, '$1:00')
  return Number.isNaN(whenMs(full)) ? null : full
}

const compact = (ms: number) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, '')

/** The Google Calendar page that creates this event, prefilled. */
export function googleCalendarUrl(event: DetectedEvent): string {
  const start = whenMs(event.start)
  let dates: string
  if (event.allDay) {
    const end = event.end ? Math.max(whenMs(event.end), start + day) : start + day
    dates = compact(start).slice(0, 8) + '/' + compact(end).slice(0, 8)
  } else {
    const end = event.end ? whenMs(event.end) : start + hour
    // A floating time stays floating, so Google applies `ctz` (or the user's own zone).
    const floating = !hasOffset.test(event.start)
    const format = (ms: number) => (floating ? compact(ms).slice(0, -1) : compact(ms))
    dates = format(start) + '/' + format(end)
  }
  const params = new URLSearchParams({ action: 'TEMPLATE', text: event.title, dates })
  if (event.location) params.set('location', event.location)
  if (event.details) params.set('details', event.details)
  if (event.timeZone && !event.allDay && !hasOffset.test(event.start))
    params.set('ctz', event.timeZone)
  return 'https://calendar.google.com/calendar/render?' + params
}

/** Whether the event has not finished yet; floating times get a day of slack for zones. */
export function isUpcoming(event: DetectedEvent, now: number): boolean {
  const floating = !event.allDay && !hasOffset.test(event.start)
  return whenMs(event.end ?? event.start) + (floating ? day : 0) > now
}
