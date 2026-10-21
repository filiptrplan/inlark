import { simpleParser, type ParsedMail, type SimpleParserOptions } from 'mailparser'

// mailparser decodes a text part as UTF-8 when its Content-Type has no charset, and never looks
// at the HTML's own <meta charset>. Legacy mail (windows-1250 and friends) then shows U+FFFD.
const replacement = '�'
const fallbackCharset = 'windows-1252'
const utf8Aliases = /^(utf-?8|us-?ascii|ascii)?$/i

const supported = (charset: string) => {
  try {
    new TextDecoder(charset)
    return true
  } catch {
    return false
  }
}

/** The charset an HTML document declares for itself, if the runtime can decode it. */
const declaredInMarkup = (text: string) => {
  const charset = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(text)?.[1]
  return charset && !utf8Aliases.test(charset) && supported(charset) ? charset : undefined
}

/** For parts fetched on their own: honor the declared charset, then recover from mislabeled bytes. */
export function decodeText(bytes: Uint8Array, charset?: string): string {
  const label = charset?.trim()
  if (label && !utf8Aliases.test(label) && supported(label))
    return new TextDecoder(label).decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    const raw = new TextDecoder('latin1').decode(bytes)
    return new TextDecoder(declaredInMarkup(raw) ?? fallbackCharset).decode(bytes)
  }
}

const count = (value: string) => value.split(replacement).length - 1
const damage = (mail: ParsedMail) =>
  count(mail.text ?? '') + count(typeof mail.html === 'string' ? mail.html : '')

/** Gives every text part that claims UTF-8 or nothing the charset its bytes most likely use. */
function relabel(source: Buffer): Buffer {
  const raw = source.toString('latin1')
  const charset = declaredInMarkup(raw) ?? fallbackCharset
  return Buffer.from(
    raw.replace(
      /^(content-type:[ \t]*text\/(?:html|plain))((?:[^\r\n]|\r?\n[ \t])*)/gim,
      (_, head: string, params: string) =>
        /charset\s*=\s*["']?(?!(?:utf-?8|us-?ascii|ascii)\b)/i.test(params)
          ? head + params
          : head +
            params.replace(/;\s*charset\s*=\s*("[^"]*"|[^;\s]*)/gi, '') +
            '; charset=' +
            charset,
    ),
    'latin1',
  )
}

/** simpleParser, retried with repaired charset labels only when the first pass lost characters. */
export async function parseTolerant(
  source: Buffer,
  options: SimpleParserOptions,
): Promise<ParsedMail> {
  const mail = await simpleParser(source, options)
  if (!damage(mail)) return mail
  const retry = await simpleParser(relabel(source), options)
  return damage(retry) < damage(mail) ? retry : mail
}
