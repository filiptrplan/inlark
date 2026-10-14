import { randomUUID } from 'node:crypto'
import {
  identitySignature,
  isDraft,
  replyRecipients,
  type Address,
  type Draft,
  type Identity,
  type Message,
  type Settings,
} from '@inlark/core'
import { escapeHtml, formatAddress, htmlText, messageText, paragraphHtml } from './text'

export type ComposeKind = 'new' | 'reply' | 'replyAll' | 'forward'

/** “Thu, Sep 25, 2026 at 10:16 AM”, matching the renderer's reply attribution. */
const longDate = (date: string) => {
  const d = new Date(date)
  return (
    d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }) +
    ' at ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  )
}

/** The message a reply or forward answers: the one named, else the newest real message. */
export function pickMessage(messages: Message[], messageId?: string): Message {
  const message = messageId
    ? messages.find((m) => m.id === messageId)
    : messages.filter((m) => !isDraft(m)).at(-1)
  if (!message)
    throw new Error(
      messageId
        ? 'That message is not part of this conversation.'
        : 'This conversation has no message to answer.',
    )
  return message
}

/**
 * The same starting draft the composer builds: recipients, subject, threading headers, the
 * identity's signature, and the quoted or forwarded original. HTML signatures are written as
 * plain text, because the main process cannot sanitize them the way the composer does.
 */
export function composeDraft(input: {
  kind: ComposeKind
  accountId: string
  identities: Identity[]
  identityId?: string
  settings: Pick<Settings, 'signatures' | 'htmlSignatures'>
  message?: Message
  body: string
  subject?: string
  to?: Address[]
  cc?: Address[]
  bcc?: Address[]
  quote: boolean
}): Draft {
  const { kind, message, body } = input
  if (!input.identities.length) throw new Error('This account has no permitted sending identities.')
  const recipients =
    message && kind !== 'forward' && kind !== 'new'
      ? replyRecipients(message, input.identities, kind === 'replyAll')
      : undefined
  const identity = input.identityId
    ? input.identities.find((i) => i.id === input.identityId)
    : recipients?.identity || input.identities[0]
  if (!identity) throw new Error('That sending identity does not belong to this account.')
  const signature = identitySignature(input.settings, identity)
  const signatureValue =
    signature.format === 'html' ? htmlText(signature.value) : signature.value.trim()

  let quoteHtml = '',
    quoteText = ''
  if (message && kind !== 'new' && (input.quote || kind === 'forward')) {
    const original = messageText(message)
    if (kind === 'forward') {
      const header = [
        '---------- Forwarded message ----------',
        'From: ' + message.from.map(formatAddress).join(', '),
        'Date: ' + longDate(message.receivedAt),
        'Subject: ' + (message.subject || '(No subject)'),
        'To: ' + message.to.map(formatAddress).join(', '),
        ...(message.cc.length ? ['Cc: ' + message.cc.map(formatAddress).join(', ')] : []),
      ]
      quoteHtml = '<p>' + header.map(escapeHtml).join('<br/>') + '</p>' + paragraphHtml(original)
      quoteText = header.join('\n') + '\n' + original
    } else {
      const header =
        'On ' +
        longDate(message.receivedAt) +
        ', ' +
        message.from.map(formatAddress).join(', ') +
        ' wrote:'
      quoteHtml =
        '<p>' + escapeHtml(header) + '</p><blockquote>' + paragraphHtml(original) + '</blockquote>'
      quoteText = header + '\n' + original.replace(/^/gm, '> ')
    }
  }

  const html =
    paragraphHtml(body) +
    (signatureValue
      ? '<p data-inlark-signature-text=""><br/>' +
        escapeHtml(signatureValue).replace(/\n/g, '<br/>') +
        '</p>'
      : '') +
    quoteHtml
  const text = [body, signatureValue, quoteText].filter(Boolean).join('\n\n')
  const subject =
    input.subject ??
    (message && kind !== 'new'
      ? (kind === 'forward' ? 'Fwd: ' : /^re:/i.test(message.subject) ? '' : 'Re: ') +
        message.subject
      : '')

  return {
    id: randomUUID(),
    accountId: input.accountId,
    identityId: identity.id,
    to: input.to ?? (kind === 'forward' ? [] : recipients?.to || []),
    cc: input.cc ?? recipients?.cc ?? [],
    bcc: input.bcc ?? [],
    subject,
    html,
    text,
    attachments: [],
    updatedAt: new Date().toISOString(),
    status: 'local',
    ...(message?.security?.encrypted
      ? { encryption: 'encrypt' as const, encryptionRequired: true }
      : {}),
    ...(message && (kind === 'reply' || kind === 'replyAll')
      ? {
          inReplyTo: message.messageId,
          references: [...(message.references || []), ...(message.messageId || [])],
          replyThreadId: message.threadId,
        }
      : {}),
  }
}

/** Replaces the whole body of an existing draft; the composer's own structure isn't kept. */
export function rewriteBody(draft: Draft, body: string): Pick<Draft, 'html' | 'text'> {
  if (draft.encryption === 'encrypt' && !draft.text && !draft.html)
    throw new Error('Unlock the encryption vault in inlark before editing this draft.')
  return { html: paragraphHtml(body), text: body }
}
