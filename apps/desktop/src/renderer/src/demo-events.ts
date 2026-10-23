// Fork-only: demo mail that describes upcoming events, so the "Add to calendar" card has something to show.
const inDays = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

export const demoEventMail = [
  [
    'Lufthansa',
    'booking@lufthansa.com',
    'Your booking is confirmed: Ljubljana to Frankfurt',
    `Your flight departs on ${inDays(21)} at 07:40 from Ljubljana Airport. Boarding closes at 07:10.`,
    'notifications',
  ],
  [
    'Cankarjev dom',
    'tickets@cd-cc.si',
    'Your tickets for Sunday Night Jazz',
    `Doors open at 19:30 on ${inDays(9)}. Please bring your tickets in the app or printed.`,
    'notifications',
  ],
  [
    'Maya Chen',
    'maya@example.com',
    'Team offsite webinar',
    `Our offsite planning webinar starts on ${inDays(4)} at 3pm. The link is in your calendar invite.`,
    'personal',
  ],
]
