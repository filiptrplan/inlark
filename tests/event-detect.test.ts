import { describe, expect, it } from 'vitest'
import type { Message } from '../packages/core/src'
import {
  googleCalendarUrl,
  isUpcoming,
  normalizeWhen,
  type DetectedEvent,
} from '../apps/desktop/src/renderer/src/calendar-event'
import {
  findEvents,
  latestEvent,
  messageEvents,
} from '../apps/desktop/src/renderer/src/event-detect'
import { findMarkupEvents } from '../apps/desktop/src/renderer/src/event-markup'
import { findTextEvent } from '../apps/desktop/src/renderer/src/event-text'

const received = '2026-10-21T08:00:00Z'
const ld = (data: unknown, wrapper = (s: string) => s) =>
  `<html><body><script type="application/ld+json">${wrapper(JSON.stringify(data))}</script></body></html>`

describe('findMarkupEvents', () => {
  const flight = (departure: string, arrival: string, from = 'LJU', to = 'FRA') => ({
    '@type': 'FlightReservation',
    reservationNumber: 'ABC123',
    reservationFor: {
      '@type': 'Flight',
      flightNumber: '1234',
      airline: { '@type': 'Airline', name: 'Lufthansa', iataCode: 'LH' },
      departureAirport: { '@type': 'Airport', iataCode: from, name: 'Ljubljana Airport' },
      arrivalAirport: { '@type': 'Airport', iataCode: to, name: 'Frankfurt Airport' },
      departureTime: departure,
      arrivalTime: arrival,
    },
  })

  it('maps a round trip to one event per leg', () => {
    const events = findMarkupEvents(
      ld({
        '@context': 'http://schema.org',
        '@graph': [
          flight('2026-11-12T07:40:00+01:00', '2026-11-12T09:05:00+01:00'),
          flight('2026-11-15T18:00:00+01:00', '2026-11-15T19:20:00+01:00', 'FRA', 'LJU'),
        ],
      }),
    )
    expect(events.map((e) => e.title)).toEqual([
      'Flight LH 1234 LJU → FRA',
      'Flight LH 1234 FRA → LJU',
    ])
    expect(events[0]).toMatchObject({
      start: '2026-11-12T07:40:00+01:00',
      end: '2026-11-12T09:05:00+01:00',
      allDay: false,
      location: 'Ljubljana Airport',
      source: 'markup',
    })
    expect(events[0].details).toContain('Booking reference: ABC123')
  })

  it('drops the end of a flight whose times carry no offset', () => {
    const [event] = findMarkupEvents(ld(flight('2026-11-12T07:40:00', '2026-11-12T09:05:00')))
    expect(event.start).toBe('2026-11-12T07:40:00')
    expect(event.end).toBeUndefined()
  })

  it('treats a hotel stay as all-day', () => {
    const [event] = findMarkupEvents(
      ld({
        '@type': 'http://schema.org/LodgingReservation',
        checkinDate: '2026-12-03',
        checkoutDate: '2026-12-05',
        reservationFor: {
          '@type': 'LodgingBusiness',
          name: 'Hotel Union',
          address: { streetAddress: 'Miklošičeva 1', addressLocality: 'Ljubljana' },
        },
      }),
    )
    expect(event).toMatchObject({
      title: 'Stay at Hotel Union',
      start: '2026-12-03',
      end: '2026-12-05',
      allDay: true,
      location: 'Hotel Union, Miklošičeva 1, Ljubljana',
    })
  })

  it('reads an event reservation and a bare Event', () => {
    const events = findMarkupEvents(
      ld([
        {
          '@type': ['EventReservation'],
          reservationFor: {
            '@type': 'MusicEvent',
            name: 'Concert',
            startDate: '2026-11-14T20:00:00+0100',
            location: { name: 'Cankarjev dom' },
          },
        },
        { '@type': 'schema:Event', name: 'Meetup', startDate: '2026-11-20' },
      ]),
    )
    expect(events[0]).toMatchObject({ title: 'Concert', start: '2026-11-14T20:00:00+01:00' })
    expect(events[0].location).toBe('Cankarjev dom')
    expect(events[1]).toMatchObject({ title: 'Meetup', allDay: true })
  })

  it('tolerates comment wrappers, broken blocks and dates that do not parse', () => {
    const data = flight('2026-11-12T07:40:00+01:00', '2026-11-12T09:05:00+01:00')
    expect(findMarkupEvents(ld(data, (s) => `<!--\n${s}\n-->`))).toHaveLength(1)
    expect(findMarkupEvents(ld(data, (s) => `<![CDATA[${s}]]>`))).toHaveLength(1)
    expect(findMarkupEvents('<script type="application/ld+json">{nope</script>')).toEqual([])
    expect(findMarkupEvents(ld(flight('soon', 'later')))).toEqual([])
    expect(findMarkupEvents(undefined)).toEqual([])
  })

  it('ignores blocks that are too large', () => {
    const big = { '@type': 'Event', name: 'x'.repeat(300_000), startDate: '2026-11-20' }
    expect(findMarkupEvents(ld(big))).toEqual([])
  })
})

describe('findTextEvent', () => {
  it.each([
    [
      'Your flight departs on 12 November 2026 at 07:40.',
      'Booking confirmed',
      '2026-11-12T07:40:00',
    ],
    ['Doors open 19:30, Saturday 14 November', 'Concert tickets', '2026-11-14T19:30:00'],
    ['Webinar starts on December 2, 2026 at 3pm', 'Join us', '2026-12-02T15:00:00'],
    ['Ihr Flug startet am 12. November 2026 um 07:40 Uhr.', 'Buchung', '2026-11-12T07:40:00'],
  ])('finds the event in %j', (text, subject, start) => {
    expect(findTextEvent(text, subject, received)).toMatchObject({ start, source: 'text' })
  })

  it('pairs check-in and check-out into one stay', () => {
    const event = findTextEvent(
      'Your reservation is confirmed.\nCheck-in: 3 December 2026\nCheck-out: 5 December 2026',
      'Booking at Hotel Union',
      received,
    )
    expect(event).toMatchObject({ start: '2026-12-03', end: '2026-12-05', allDay: true })
  })

  it.each([
    'Payment due by 1 December 2026',
    'Your order shipped on October 20, 2026',
    'Invoice dated 5 November 2026',
    'Meeting notes: nothing to see here',
    'Reminder: your ticket was valid until 3 January 2020',
    'On Mon, Oct 19, 2026 at 9:00 AM Anna wrote:\n> Flight departs 12 November 2026',
    'Date: Mon, 12 Nov 2026 07:40\nFrom: someone',
    'Our summer sale starts 1 June 2030!',
  ])('ignores %j', (text) => {
    expect(findTextEvent(text, 'Hello', received)).toBeNull()
  })

  it('ignores events more than a year and a half away', () => {
    expect(findTextEvent('Concert on 14 November 2030', 'Tickets', received)).toBeNull()
  })
})

describe('googleCalendarUrl', () => {
  const base: DetectedEvent = { title: 'Flight', start: '', allDay: false, source: 'markup' }
  const params = (event: DetectedEvent) => new URL(googleCalendarUrl(event)).searchParams

  it('converts offset times to UTC and defaults to one hour', () => {
    expect(params({ ...base, start: '2026-11-12T07:40:00+01:00' }).get('dates')).toBe(
      '20261112T064000Z/20261112T074000Z',
    )
  })
  it('keeps floating times floating and passes the zone', () => {
    const p = params({
      ...base,
      start: '2026-11-12T07:40:00',
      end: '2026-11-12T09:00:00',
      timeZone: 'Europe/Ljubljana',
    })
    expect(p.get('dates')).toBe('20261112T074000/20261112T090000')
    expect(p.get('ctz')).toBe('Europe/Ljubljana')
  })
  it('writes all-day dates and a one-day default', () => {
    expect(
      params({ ...base, start: '2026-12-03', end: '2026-12-05', allDay: true }).get('dates'),
    ).toBe('20261203/20261205')
    expect(params({ ...base, start: '2026-12-03', allDay: true }).get('dates')).toBe(
      '20261203/20261204',
    )
  })
  it('encodes text, location and details', () => {
    const url = googleCalendarUrl({
      ...base,
      title: 'A & B',
      start: '2026-12-03',
      allDay: true,
      location: 'Café #1',
      details: 'x\ny',
    })
    expect(url.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE')).toBe(true)
    const p = new URL(url).searchParams
    expect([p.get('text'), p.get('location'), p.get('details')]).toEqual([
      'A & B',
      'Café #1',
      'x\ny',
    ])
  })
})

describe('normalizeWhen and isUpcoming', () => {
  it('accepts ISO dates and rejects the rest', () => {
    expect(normalizeWhen('2026-11-12T07:40+0100')).toBe('2026-11-12T07:40:00+01:00')
    expect(normalizeWhen('2026-13-45')).toBeNull()
    expect(normalizeWhen('tomorrow')).toBeNull()
    expect(normalizeWhen(42)).toBeNull()
  })
  it('keeps events until they end', () => {
    const event: DetectedEvent = {
      title: 'x',
      start: '2026-11-12T07:40:00Z',
      end: '2026-11-12T09:00:00Z',
      allDay: false,
      source: 'markup',
    }
    expect(isUpcoming(event, Date.parse('2026-11-12T08:00:00Z'))).toBe(true)
    expect(isUpcoming(event, Date.parse('2026-11-12T09:30:00Z'))).toBe(false)
  })
})

const message = (patch: Partial<Message>): Message =>
  ({
    id: 'm',
    subject: 'Your booking',
    text: 'Hello',
    html: '',
    preview: '',
    keywords: {},
    receivedAt: new Date().toISOString(),
    ...patch,
  }) as unknown as Message

describe('messageEvents', () => {
  const future = new Date(Date.now() + 10 * 86_400_000).toISOString()
  const html = ld({ '@type': 'Event', name: 'Meetup', startDate: future })

  it('prefers markup over prose', () => {
    expect(findEvents(html, () => 'Flight departs 12 November 2026', 'x', received)[0].title).toBe(
      'Meetup',
    )
  })
  it('reads a received message and caches the result', () => {
    const m = message({ html })
    expect(messageEvents(m)).toHaveLength(1)
    m.html = ''
    expect(messageEvents(m)).toHaveLength(1)
  })
  it('ignores drafts and finished events', () => {
    expect(messageEvents(message({ html, keywords: { $draft: true } }))).toEqual([])
    const past = ld({ '@type': 'Event', name: 'Old', startDate: '2020-01-01T10:00:00Z' })
    expect(messageEvents(message({ html: past }))).toEqual([])
  })
  it('picks the newest message with an event', () => {
    const found = latestEvent([message({ id: 'a', html }), message({ id: 'b' })])
    expect(found?.message.id).toBe('a')
  })
})
