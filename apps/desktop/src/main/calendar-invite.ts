// Fork-only: lets the app page read a message's iCalendar attachment to offer adding its event.
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { Attachment } from '@inlark/core'
import type { MailService } from './service'

/** An invite is a few kilobytes; anything larger is not one. */
const maxBytes = 256 * 1024

const input = z.tuple([
  z.string().min(1).max(200),
  z.object({
    blobId: z.string().min(1).max(2000),
    name: z.string().max(1000),
    type: z.string().max(200),
    size: z.number().int().min(0).max(maxBytes),
  }),
])

/** Only the app's own page may read attachments, like the mail IPC in index.ts. */
function trusted(event: IpcMainInvokeEvent) {
  const frame = event.senderFrame
  const devURL = process.env.ELECTRON_RENDERER_URL
  try {
    return (
      !!frame &&
      frame === event.sender.mainFrame &&
      frame.origin === (devURL ? new URL(devURL).origin : 'inlark://mail')
    )
  } catch {
    return false
  }
}

export function startCalendarInvites(service: Pick<MailService, 'attachmentBytes'>) {
  ipcMain.handle('calendar:invite', async (event, ...args: unknown[]) => {
    if (!trusted(event)) throw new Error('Untrusted application frame.')
    const parsed = input.safeParse(args)
    if (!parsed.success) throw new Error('Invalid input.')
    const [accountId, attachment] = parsed.data
    if (!/^text\/calendar/i.test(attachment.type) && !/\.ics$/i.test(attachment.name))
      throw new Error('Not a calendar invite.')
    const bytes = await service.attachmentBytes(accountId, attachment as Attachment)
    if (bytes.byteLength > maxBytes) throw new Error('Not a calendar invite.')
    return new TextDecoder().decode(bytes)
  })
}
