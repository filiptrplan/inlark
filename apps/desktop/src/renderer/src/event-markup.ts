import { normalizeWhen, type DetectedEvent } from './calendar-event'

/** Booking markup is small; a larger block is not worth parsing. */
const maxBlock = 256 * 1024

type Node = Record<string, unknown>

const isNode = (value: unknown): value is Node =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** The text of a plain value, or of a node's `name`. */
function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  if (isNode(value)) return text(value.name)
  return ''
}

function address(value: unknown): string {
  if (!isNode(value)) return text(value)
  const parts = [
    value.streetAddress,
    value.postalCode,
    value.addressLocality,
    value.addressRegion,
    value.addressCountry,
  ]
    .map(text)
    .filter(Boolean)
  return parts.join(', ')
}

/** A place's name and address, without repeating one when the other contains it. */
function place(value: unknown): string {
  if (!isNode(value)) return text(value)
  const name = text(value.name)
  const where = address(value.address)
  return !where || name.includes(where) ? name || where : name ? name + ', ' + where : where
}

function typesOf(node: Node): string[] {
  const raw = node['@type']
  return (Array.isArray(raw) ? raw : [raw])
    .filter((type): type is string => typeof type === 'string')
    .map((type) => type.replace(/^(?:https?:\/\/schema\.org\/|schema:)/i, ''))
}

/** Every top-level node of a JSON-LD document, flattening arrays and `@graph`. */
function nodesOf(value: unknown, into: Node[] = []): Node[] {
  if (Array.isArray(value)) for (const item of value) nodesOf(item, into)
  else if (isNode(value)) {
    if (value['@graph']) nodesOf(value['@graph'], into)
    into.push(value)
  }
  return into
}

function jsonBlocks(html: string): unknown[] {
  const blocks: unknown[] = []
  for (const match of html.matchAll(
    /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const body = match[1]
      .replace(/^\s*(?:<!--|<!\[CDATA\[)/, '')
      .replace(/(?:-->|\]\]>)\s*$/, '')
      .trim()
    if (!body || body.length > maxBlock) continue
    try {
      blocks.push(JSON.parse(body))
    } catch {
      // Senders often ship broken markup; skip the block.
    }
  }
  return blocks
}

const compactJoin = (parts: string[], separator = ' · ') => parts.filter(Boolean).join(separator)
const booking = (node: Node) => {
  const number = text(node.reservationNumber)
  return number ? 'Booking reference: ' + number : ''
}

type Mapper = (node: Node, subject: Node) => DetectedEvent | null

const when = (...values: unknown[]) => {
  for (const value of values) {
    const found = normalizeWhen(value)
    if (found) return found
  }
  return undefined
}
const isDay = (value: string) => value.length === 10

/** A trip leg; the end is kept only when both ends carry an offset, as zones differ per place. */
function trip(
  title: string,
  from: string,
  to: string,
  start: string | undefined,
  end: string | undefined,
  node: Node,
  extra: string[] = [],
): DetectedEvent | null {
  if (!start) return null
  const absolute = /(?:Z|[+-]\d{2}:\d{2})$/i
  return {
    title,
    start,
    end: end && absolute.test(start) && absolute.test(end) ? end : undefined,
    allDay: isDay(start),
    location: from || undefined,
    details: compactJoin([to ? 'To: ' + to : '', ...extra, booking(node)], '\n') || undefined,
    source: 'markup',
  }
}

const flight: Mapper = (node, subject) => {
  const airline = isNode(subject.airline) ? subject.airline : {}
  const code = compactJoin(
    [text(airline.iataCode) || text(airline.name), text(subject.flightNumber)],
    ' ',
  )
  const airport = (value: unknown) =>
    isNode(value) ? text(value.iataCode) || text(value.name) : text(value)
  const from = airport(subject.departureAirport)
  const to = airport(subject.arrivalAirport)
  const route = from && to ? from + ' → ' + to : ''
  const fromName = isNode(subject.departureAirport) ? text(subject.departureAirport.name) : ''
  return trip(
    compactJoin(['Flight', code, route], ' '),
    fromName || from,
    isNode(subject.arrivalAirport) ? text(subject.arrivalAirport.name) || to : to,
    when(subject.departureTime),
    when(subject.arrivalTime),
    node,
  )
}

const transit =
  (kind: string, fromKey: string, toKey: string, idKey: string): Mapper =>
  (node, subject) => {
    const from = text(subject[fromKey])
    const to = text(subject[toKey])
    const route = from && to ? from + ' → ' + to : ''
    return trip(
      compactJoin([kind, text(subject[idKey]), route], ' '),
      from,
      to,
      when(subject.departureTime),
      when(subject.arrivalTime),
      node,
    )
  }

const lodging: Mapper = (node, subject) => {
  const start = when(node.checkinTime, node.checkinDate, subject.checkinTime)
  if (!start) return null
  const end = when(node.checkoutTime, node.checkoutDate, subject.checkoutTime)
  const name = text(subject)
  return {
    title: name ? 'Stay at ' + name : 'Hotel stay',
    start,
    end,
    allDay: isDay(start),
    location: place(subject) || undefined,
    details: booking(node) || undefined,
    source: 'markup',
  }
}

const happening: Mapper = (node, subject) => {
  const start = when(subject.startDate, node.startDate, node.startTime, subject.startTime)
  if (!start) return null
  const name = text(subject) || text(node.name)
  if (!name) return null
  return {
    title: name,
    start,
    end: when(subject.endDate, node.endDate, node.endTime, subject.endTime),
    allDay: isDay(start),
    location: place(subject.location) || undefined,
    details:
      compactJoin([text(subject.description).slice(0, 300), booking(node)], '\n') || undefined,
    source: 'markup',
  }
}

const rental: Mapper = (node, subject) => {
  const start = when(node.pickupTime)
  if (!start) return null
  return {
    title:
      'Car rental' +
      (text(subject.provider) || text(node.provider)
        ? ' · ' + (text(subject.provider) || text(node.provider))
        : ''),
    start,
    end: when(node.dropoffTime),
    allDay: isDay(start),
    location: place(node.pickupLocation) || undefined,
    details:
      compactJoin(
        [
          place(node.dropoffLocation) ? 'Drop-off: ' + place(node.dropoffLocation) : '',
          booking(node),
        ],
        '\n',
      ) || undefined,
    source: 'markup',
  }
}

const reservations: Record<string, Mapper> = {
  FlightReservation: flight,
  TrainReservation: transit('Train', 'departureStation', 'arrivalStation', 'trainNumber'),
  BusReservation: transit('Bus', 'departureBusStop', 'arrivalBusStop', 'busNumber'),
  LodgingReservation: lodging,
  EventReservation: happening,
  FoodEstablishmentReservation: happening,
  RentalCarReservation: rental,
}

/** Events described by schema.org JSON-LD in the message HTML, in document order. */
export function findMarkupEvents(html: string | undefined): DetectedEvent[] {
  if (!html || !/ld\+json/i.test(html)) return []
  const events: DetectedEvent[] = []
  const seen = new Set<string>()
  const add = (event: DetectedEvent | null) => {
    if (!event) return
    const key = event.title + '|' + event.start
    if (!seen.has(key)) {
      seen.add(key)
      events.push(event)
    }
  }
  for (const block of jsonBlocks(html))
    for (const node of nodesOf(block)) {
      const types = typesOf(node)
      const type = types.find((name) => name in reservations)
      if (type) {
        add(reservations[type](node, isNode(node.reservationFor) ? node.reservationFor : {}))
      } else if (types.some((name) => name === 'Event' || name.endsWith('Event'))) {
        add(happening(node, node))
      }
    }
  return events
}
