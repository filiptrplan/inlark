import * as chrono from 'chrono-node'
import type { ParsedComponents, ParsedResult } from 'chrono-node'
import type { DetectedEvent } from './calendar-event'

/** Only the start of a message is searched; bookings state their dates up front. */
const maxChars = 6000
/** Dates further away than this are almost never an upcoming booking. */
const horizon = 18 * 30 * 24 * 60 * 60 * 1000

const keyword = new RegExp(
  [
    'flight|depart|arriv|boarding|check[- ]?in|check[- ]?out|booking|reservation|itinerary|ticket',
    'event|concert|doors|venue|appointment|meeting|webinar|conference|starts?\\b|takes place|invit',
    'termin|einladung|flug|abflug|buchung|reservierung|veranstaltung',
    'rezervacij|vstopnic|let\\b|prihod|odhod|dogodek|sestanek',
    'vol\\b|départ|réservation|billet|vuelo|reserva|entrada|vlucht|boeking|voo|bilhete',
  ].join('|'),
  'i',
)
/** Lines where a date is a deadline or a record of the past, not something to attend. */
const unrelated =
  /\b(?:due|deadline|expires?|expiry|valid until|payment|invoice|delivered|delivery|shipped|statement|unsubscribe|order placed|sent|posted|received)\b|^\s*(?:date|sent|from|to|cc|subject)\s*:/i
const checkIn = /check[- ]?in|prihod|anreise|arrivée|llegada|aankomst/i
const checkOut = /check[- ]?out|odhod|abreise|départ|salida|vertrek/i
/** Where quoted history starts; nothing below it describes this message. */
const history = /^\s*On .{5,100} wrote:?\s*$|^-{2,}\s*(?:Original Message|Forwarded message)/i

const parsers = [chrono, chrono.de, chrono.fr, chrono.es, chrono.nl, chrono.pt]

const pad = (value: number | null, width = 2) => String(value ?? 0).padStart(width, '0')

function when(component: ParsedComponents | null | undefined) {
  if (!component || !component.isCertain('day') || !component.isCertain('month')) return null
  const date = `${pad(component.get('year'), 4)}-${pad(component.get('month'))}-${pad(component.get('day'))}`
  if (!component.isCertain('hour')) return { value: date, allDay: true, timed: false }
  const time = `${date}T${pad(component.get('hour'))}:${pad(component.get('minute'))}:00`
  if (!component.isCertain('timezoneOffset')) return { value: time, allDay: false, timed: true }
  const offset = component.get('timezoneOffset') ?? 0
  const sign = offset < 0 ? '-' : '+'
  const stamp = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  return { value: time + stamp, allDay: false, timed: true }
}

function parseLine(line: string, reference: Date): ParsedResult[] {
  for (const parser of parsers) {
    const found = parser.parse(line, reference, { forwardDate: true })
    // A partial match such as "November 2026" must not stop a better parser from reading the day.
    if (found.some((result) => when(result.start))) return found
  }
  return []
}

const addDay = (date: string) => new Date(Date.parse(date) + 86_400_000).toISOString().slice(0, 10)

/** The upcoming event a message describes in prose, or null when no date reads like one. */
export function findTextEvent(
  text: string,
  subject: string,
  receivedAt: string | number | Date,
): DetectedEvent | null {
  const reference = new Date(receivedAt)
  if (Number.isNaN(reference.getTime())) return null
  const lines: string[] = []
  for (const line of text.slice(0, maxChars).split(/\r?\n/)) {
    if (history.test(line)) break
    lines.push(/^\s*>/.test(line) ? '' : line.trim())
  }
  const title = subject.replace(/^\s*(?:(?:re|fwd?|aw|wg)\s*:\s*)+/i, '').trim()
  const subjectHit = keyword.test(title)

  let best: { score: number; event: DetectedEvent; index: number } | null = null
  const stays: { index: number; value: string; kind: 'in' | 'out' }[] = []
  for (const [index, line] of lines.entries()) {
    if (!line || unrelated.test(line)) continue
    const near = lines.slice(Math.max(0, index - 2), index + 1).filter(Boolean)
    for (const result of parseLine(line, reference)) {
      const start = when(result.start)
      if (!start) continue
      const ms = Date.parse(start.value.slice(0, 10))
      if (ms < reference.getTime() - 86_400_000 || ms - reference.getTime() > horizon) continue
      const own = keyword.test(line)
      if (!own && !near.some((prior) => keyword.test(prior))) continue
      if (checkIn.test(line) && !checkOut.test(line))
        stays.push({ index, value: start.value, kind: 'in' })
      if (checkOut.test(line) && !checkIn.test(line))
        stays.push({ index, value: start.value, kind: 'out' })
      const end = when(result.end)
      // "3 – 5 December" names the last day, which an all-day event excludes.
      const last = end && end.allDay ? addDay(end.value) : end?.value
      const score = (own ? 2 : 1) + (start.timed ? 1 : 0) + (subjectHit ? 1 : 0) + (last ? 1 : 0)
      if (score < 2 || (best && score <= best.score)) continue
      best = {
        score,
        index,
        event: {
          title: title || line.slice(0, 80),
          start: start.value,
          end: last,
          allDay: start.allDay,
          details: line.slice(0, 300),
          source: 'text',
        },
      }
    }
  }
  if (!best) return null
  // A stay lists its check-in and check-out on separate lines.
  const arrival = stays.find((stay) => stay.kind === 'in')
  const departure = stays.find((stay) => stay.kind === 'out')
  if (
    arrival &&
    departure &&
    departure.value >= arrival.value &&
    departure.value.length === arrival.value.length &&
    !best.event.end
  )
    return {
      ...best.event,
      start: arrival.value,
      end: departure.value,
      allDay: arrival.value.length === 10,
    }
  return best.event
}
