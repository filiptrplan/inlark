import { isDraft, type Message } from '@inlark/core'
import { messageText } from './message-text'

/** Codes expire quickly, so older mail never offers one. */
const maxAge = 24 * 60 * 60 * 1000
/** Only the start of a message is searched; the code is never buried deep in the body. */
const maxChars = 4000

const keyword =
  /code|verif|one[- ]time|\botp\b|passcode|\bpin\b|2fa|authenticat|confirmation|\bkoda\b|\bkod\b|código|codice/i
/** Lines about something other than signing in, where a number is not a code. */
const unrelated = /promo|discount|coupon|order|invoice|tracking|reference|account number/i

const start = String.raw`(?<![\w.@/#$€£+:-])`
const digits = new RegExp(
  start + String.raw`(\d{3,4}[ -]\d{3,4}|\d{4,8})(?![\w@/:%]|[.,]\d|\s?(?:EUR|USD|GBP|€|\$|£))`,
  'g',
)
const alphanumeric = new RegExp(
  start + String.raw`(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])((?:[A-Z]-)?[A-Z0-9]{5,10})(?![\w@/])`,
  'g',
)

const isYear = (value: string) => /^(?:19|20)\d{2}$/.test(value)

/** The one-time code a message asks the reader to enter, or null when none stands out. */
export function findVerificationCode(text: string, subject = ''): string | null {
  const lines = [subject, ...text.slice(0, maxChars).split(/\r?\n/)].map((line) => line.trim())
  let best: { code: string; score: number } | null = null
  for (const [index, line] of lines.entries()) {
    if (!line || unrelated.test(line)) continue
    const candidates = [...line.matchAll(digits), ...line.matchAll(alphanumeric)]
    for (const match of candidates) {
      const raw = match[1]
      if (isYear(raw)) continue
      const before = line.slice(0, match.index)
      if (/\+[\d ()-]*$/.test(before)) continue
      const nearby = lines.slice(Math.max(0, index - 2), index).some((prior) => keyword.test(prior))
      const proximity = /code|otp|pin|passcode|koda|kod\b/i.test(before.slice(-60))
        ? 3
        : keyword.test(line)
          ? 2
          : nearby
            ? 2
            : 0
      if (!proximity) continue
      const score =
        proximity +
        (line === raw ? 1 : 0) +
        (index === 0 ? 1 : 0) +
        (raw.replace(/\D/g, '').length === 6 ? 1 : 0)
      if (score >= 2 && (!best || score > best.score))
        best = { code: /^\d/.test(raw) ? raw.replace(/[ -]/g, '') : raw, score }
    }
  }
  return best?.code ?? null
}

const cache = new WeakMap<Message, string | null>()

/** The code in a recent, received message. */
export function verificationCode(message: Message, now = Date.now()): string | null {
  if (isDraft(message)) return null
  const received = Date.parse(message.receivedAt)
  if (!(now - received <= maxAge)) return null
  if (!cache.has(message))
    cache.set(message, findVerificationCode(messageText(message), message.subject))
  return cache.get(message) ?? null
}

/** The newest message of a conversation that carries a code. */
export function latestVerificationCode(
  messages: Message[],
): { code: string; message: Message } | null {
  for (const message of [...messages].reverse()) {
    const code = verificationCode(message)
    if (code) return { code, message }
  }
  return null
}

export const copyVerificationCode = (code: string) => navigator.clipboard.writeText(code)
