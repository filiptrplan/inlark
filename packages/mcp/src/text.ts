import type { Address, Message } from '@inlark/core'

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  bull: '•',
  middot: '·',
  zwnj: '',
  zwj: '',
}
const decode = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] !== '#') return entities[name.toLowerCase()] ?? match
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : +name.slice(1)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  })

/**
 * The readable text of an email's HTML, keeping line and block breaks. The main process has no
 * DOM, so this is a careful approximation of the renderer's `htmlText`, not a sanitizer.
 */
export function htmlText(html: string): string {
  return decode(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(head|style|script|title|template)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<(ul|ol)\b[^>]*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '• ')
      .replace(/<\/(p|div|li|h[1-6]|tr|table|blockquote|ul|ol|section|article)\s*>/gi, '\n')
      .replace(/<\/t[dh]\s*>/gi, '\t')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[ \t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Prefers the sender's own plain text, as the reader and the composer's quotes do. */
export function messageText(message: Pick<Message, 'text' | 'html' | 'preview'>): string {
  if (message.text?.trim()) return message.text
  if (!message.html) return message.preview
  return htmlText(message.html) || message.preview
}

export const formatAddress = (a: Address) => (a.name ? a.name + ' <' + a.email + '>' : a.email)
export const formatAddresses = (list: Address[]) => list.map(formatAddress)

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Paragraph HTML with the same shape the composer produces for typed text. */
export const paragraphHtml = (text: string) =>
  '<p>' + escapeHtml(text).replace(/\n/g, '<br/>') + '</p>'

export function truncate(text: string, limit: number): { text: string; truncated?: number } {
  if (text.length <= limit) return { text }
  return { text: text.slice(0, limit), truncated: text.length - limit }
}
