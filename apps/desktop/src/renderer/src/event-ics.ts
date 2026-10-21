import ICAL from 'ical.js'
import type { DetectedEvent } from './calendar-event'

/** Occurrences are searched for this many steps before a recurring invite is given up on. */
const maxOccurrences = 2000

const pad = (value: number, width = 2) => String(value).padStart(width, '0')

/** The value as `YYYY-MM-DD`, an instant in UTC, or a floating local time. */
function format(time: ICAL.Time): { value: string; allDay: boolean; floating: boolean } {
  const date = `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}`
  if (time.isDate) return { value: date, allDay: true, floating: false }
  if (time.zone === ICAL.Timezone.localTimezone)
    return {
      value: `${date}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`,
      allDay: false,
      floating: true,
    }
  return { value: time.toJSDate().toISOString(), allDay: false, floating: false }
}

function toEvent(event: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null): DetectedEvent | null {
  const from = format(start)
  const to = end ? format(end) : undefined
  const title = event.summary?.trim()
  if (!title || Number.isNaN(Date.parse(from.value))) return null
  return {
    title,
    start: from.value,
    end: to && to.allDay === from.allDay ? to.value : undefined,
    allDay: from.allDay,
    location: event.location?.trim() || undefined,
    details: event.description?.trim().slice(0, 1000) || undefined,
    source: 'invite',
  }
}

/** The upcoming events of an iCalendar file; recurring ones give their next occurrence. */
export function parseInvite(source: string, now = Date.now()): DetectedEvent[] {
  try {
    const calendar = new ICAL.Component(ICAL.parse(source))
    if (String(calendar.getFirstPropertyValue('method')).toUpperCase() === 'CANCEL') return []
    for (const zone of calendar.getAllSubcomponents('vtimezone'))
      ICAL.TimezoneService.register(zone)
    const events: DetectedEvent[] = []
    for (const component of calendar.getAllSubcomponents('vevent')) {
      if (String(component.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED') continue
      if (component.hasProperty('recurrence-id')) continue
      const event = new ICAL.Event(component)
      let found: DetectedEvent | null = null
      if (event.isRecurring()) {
        const iterator = event.iterator()
        for (let step = 0; step < maxOccurrences; step++) {
          const next = iterator.next()
          if (!next) break
          const details = event.getOccurrenceDetails(next)
          const candidate = toEvent(event, details.startDate, details.endDate)
          if (candidate && Date.parse(candidate.end ?? candidate.start) >= now) {
            found = candidate
            break
          }
        }
      } else found = toEvent(event, event.startDate, event.endDate)
      if (found) events.push(found)
    }
    return events
  } catch {
    return []
  }
}
