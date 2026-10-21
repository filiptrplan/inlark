import { describe, it, expect } from 'vitest'
import { decodeText, parseMime } from '../packages/imap/src/mime'

// "<p>Spoštovani, čim prej</p>" in windows-1250.
const body = Buffer.from('<p>Spo\x9Atovani, \xE8im prej</p>', 'latin1')
const message = (contentType: string, prefix = '') =>
  Buffer.concat([
    Buffer.from(
      'From: a@example.test\r\nTo: b@example.test\r\nSubject: x\r\nMIME-Version: 1.0\r\n' +
        `Content-Type: ${contentType}\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${prefix}`,
    ),
    body,
  ])
const meta = '<meta http-equiv="Content-Type" content="text/html; charset=windows-1250">'

describe('legacy charsets', () => {
  it('keeps a declared charset', async () => {
    const parsed = await parseMime(message('text/html; charset=windows-1250'))
    expect(parsed.html).toContain('Spoštovani, čim')
  })
  it.each(['text/html', 'text/html; charset=us-ascii', 'text/html; charset=utf-8'])(
    'uses the HTML meta charset when the header is %s',
    async (type) => {
      const parsed = await parseMime(message(type, meta))
      expect(parsed.html).toContain('Spoštovani, čim')
      expect(parsed.html).not.toContain('�')
    },
  )
  it('never shows replacement characters for unlabeled 8-bit text', async () => {
    const parsed = await parseMime(message('text/html'))
    expect(parsed.html).not.toContain('�')
  })
  it('decodes standalone parts by declared charset, meta, then a lossless fallback', () => {
    expect(decodeText(body, 'windows-1250')).toContain('Spoštovani, čim')
    expect(decodeText(Buffer.concat([Buffer.from(meta), body]))).toContain('Spoštovani, čim')
    expect(decodeText(body, 'utf-8')).not.toContain('�')
    expect(decodeText(Buffer.from('Grüße', 'utf8'))).toBe('Grüße')
  })
})
