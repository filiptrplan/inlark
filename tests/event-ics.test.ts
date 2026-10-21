import { describe, expect, it } from 'vitest'
import { parseInvite } from '../apps/desktop/src/renderer/src/event-ics'

const wrap = (body: string, method = 'REQUEST') =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//t//EN',
    `METHOD:${method}`,
    body,
    'END:VCALENDAR',
  ].join('\r\n')

const now = Date.parse('2026-10-21T08:00:00Z')

describe('parseInvite', () => {
  it('converts a time zone from its VTIMEZONE', () => {
    const [event] = parseInvite(
      wrap(
        [
          'BEGIN:VTIMEZONE',
          'TZID:Custom/Zone',
          'BEGIN:STANDARD',
          'DTSTART:19700101T000000',
          'TZOFFSETFROM:+0200',
          'TZOFFSETTO:+0200',
          'END:STANDARD',
          'END:VTIMEZONE',
          'BEGIN:VEVENT',
          'UID:1',
          'DTSTAMP:20261001T000000Z',
          'DTSTART;TZID=Custom/Zone:20261112T094000',
          'DTEND;TZID=Custom/Zone:20261112T104000',
          'SUMMARY:Planning\\, part one',
          'LOCATION:Room 4',
          'DESCRIPTION:Bring notes',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      now,
    )
    expect(event).toMatchObject({
      title: 'Planning, part one',
      start: '2026-11-12T07:40:00.000Z',
      end: '2026-11-12T08:40:00.000Z',
      allDay: false,
      location: 'Room 4',
      source: 'invite',
    })
  })

  it('reads UTC, all-day and floating times', () => {
    const events = parseInvite(
      wrap(
        [
          'BEGIN:VEVENT\r\nUID:a\r\nDTSTAMP:20261001T000000Z\r\nDTSTART:20261112T070000Z\r\nDTEND:20261112T080000Z\r\nSUMMARY:Utc\r\nEND:VEVENT',
          'BEGIN:VEVENT\r\nUID:b\r\nDTSTAMP:20261001T000000Z\r\nDTSTART;VALUE=DATE:20261203\r\nDTEND;VALUE=DATE:20261205\r\nSUMMARY:Stay\r\nEND:VEVENT',
          'BEGIN:VEVENT\r\nUID:c\r\nDTSTAMP:20261001T000000Z\r\nDTSTART:20261120T180000\r\nSUMMARY:Floating\r\nEND:VEVENT',
        ].join('\r\n'),
      ),
      now,
    )
    expect(events[0]).toMatchObject({
      start: '2026-11-12T07:00:00.000Z',
      end: '2026-11-12T08:00:00.000Z',
    })
    expect(events[1]).toMatchObject({ start: '2026-12-03', end: '2026-12-05', allDay: true })
    expect(events[2]).toMatchObject({ start: '2026-11-20T18:00:00', allDay: false })
  })

  it('gives the next occurrence of a recurring event', () => {
    const [event] = parseInvite(
      wrap(
        'BEGIN:VEVENT\r\nUID:r\r\nDTSTAMP:20260101T000000Z\r\nDTSTART:20260105T090000Z\r\nDTEND:20260105T100000Z\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:Standup\r\nEND:VEVENT',
      ),
      now,
    )
    expect(event.title).toBe('Standup')
    expect(Date.parse(event.start)).toBeGreaterThanOrEqual(now - 3600_000)
    expect(new Date(event.start).getUTCDay()).toBe(1)
  })

  it('skips cancelled events and cancellations', () => {
    const cancelled =
      'BEGIN:VEVENT\r\nUID:x\r\nDTSTAMP:20261001T000000Z\r\nDTSTART:20261112T070000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:Gone\r\nEND:VEVENT'
    expect(parseInvite(wrap(cancelled), now)).toEqual([])
    expect(parseInvite(wrap(cancelled.replace('STATUS:CANCELLED\r\n', ''), 'CANCEL'), now)).toEqual(
      [],
    )
  })

  it('returns nothing for garbage', () => {
    expect(parseInvite('not a calendar', now)).toEqual([])
    expect(parseInvite('', now)).toEqual([])
  })
})
