import { describe, expect, it } from 'vitest'
import type { Message } from '../packages/core/src'
import {
  findVerificationCode,
  latestVerificationCode,
  verificationCode,
} from '../apps/desktop/src/renderer/src/verification-code'

describe('findVerificationCode', () => {
  it.each([
    ['Your verification code is 482913', '', '482913'],
    ['123 456 is your Instagram code', '', '123456'],
    ['Welcome', 'Enter this code:\n\n7731 9042', '77319042'],
    ['', 'Use G-482913 to sign in. This code expires soon.', 'G-482913'],
    ['', 'Vaša koda: 5521', '5521'],
    ['Your code: 908172', 'Hello', '908172'],
    ['', 'Enter this code to continue:\n\n604417\n\nIf you did not ask, ignore this.', '604417'],
  ])('finds the code in %j %j', (subject, text, expected) => {
    expect(findVerificationCode(text, subject)).toBe(expected)
  })

  it.each([
    'Your order 482913 has shipped.',
    'Invoice 20481 is due. Verification of payment pending since 2024.',
    'Confirmation: total €1234 charged.',
    'Verify your account at https://example.com/v/482913',
    'Call us on +386 1234 5678. Code of conduct applies.',
    'Use promo code SAVE2024 for 20% off 123456',
    'Meeting at 10:30, confirmation 2025',
  ])('ignores %j', (text) => {
    expect(findVerificationCode(text)).toBeNull()
  })
})

const message = (patch: Partial<Message>): Message =>
  ({
    id: 'm',
    subject: 'Sign in',
    text: 'Your verification code is 482913',
    html: '',
    preview: '',
    from: [],
    to: [],
    cc: [],
    replyTo: [],
    keywords: {},
    receivedAt: new Date().toISOString(),
    ...patch,
  }) as unknown as Message

describe('verificationCode', () => {
  it('reads a recent message', () => {
    expect(verificationCode(message({}))).toBe('482913')
  })
  it('ignores messages older than a day', () => {
    const old = new Date(Date.now() - 25 * 3600_000).toISOString()
    expect(verificationCode(message({ receivedAt: old }))).toBeNull()
  })
  it('ignores drafts', () => {
    expect(verificationCode(message({ keywords: { $draft: true } }))).toBeNull()
  })
  it('picks the newest message with a code', () => {
    const found = latestVerificationCode([
      message({ id: 'a', text: 'Your code is 111111' }),
      message({ id: 'b', text: 'Your code is 222222' }),
    ])
    expect(found?.code).toBe('222222')
  })
})
