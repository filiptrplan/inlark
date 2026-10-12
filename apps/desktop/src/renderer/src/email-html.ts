import type { Config } from 'dompurify'
import { plainTextHtml, type Message } from '@inlark/core'

// Cached JMAP bodies can match for either MIME type. Look for a document, paired
// elements, or image markup; a literal <br> or <sender@example.test> is still text.
const htmlMarkup =
  /<(?:!doctype\s+html|html|head|body)(?:\s|>)|<([a-z][a-z\d:-]*)\b[^>]*>[\s\S]*?<\/\1\s*>|<(?:img|hr)\b[^>]*>/i

/** Repair duplicated plain-text bodies without escaping duplicated HTML bodies. */
export function emailBodyHtml(message: Pick<Message, 'html' | 'text' | 'preview'>): string {
  const html = message.html?.trim()
  if (html && (html !== message.text?.trim() || htmlMarkup.test(html))) return message.html!
  return plainTextHtml(
    (message.text?.trim() ? message.text : message.preview) ||
      'No readable message body is available.',
  )
}

/** HTML from mail or a signature keeps its layout, but nothing that runs, submits or restyles the app. */
export const emailSanitizeOptions: Config = {
  FORBID_TAGS: [
    'script',
    'style',
    'iframe',
    'frame',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'textarea',
    'select',
    'meta',
    'base',
    'link',
    'svg',
    'math',
    'video',
    'audio',
    'source',
  ],
  FORBID_ATTR: ['srcset', 'action', 'formaction', 'ping', 'autofocus', 'contenteditable'],
}
