// Fork-only: exposes calendar invite reading to the app page as `window.inlarkCalendar`.
import { contextBridge, ipcRenderer } from 'electron'
import type { Attachment } from '@inlark/core'

export interface CalendarBridge {
  invite(accountId: string, attachment: Attachment): Promise<string>
}

contextBridge.exposeInMainWorld('inlarkCalendar', {
  invite: (accountId: string, attachment: Attachment) =>
    ipcRenderer.invoke('calendar:invite', accountId, attachment),
} satisfies CalendarBridge)
