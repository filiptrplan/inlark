// Fork-only: exposes moving a draft to another account to the app page as `window.inlarkDrafts`.
import { contextBridge, ipcRenderer } from 'electron'
import type { Draft } from '@inlark/core'
import type { DraftMoveResult } from '../main/draft-move'

export interface DraftsBridge {
  move(draft: Draft, accountId: string, identityId: string): Promise<DraftMoveResult>
}

contextBridge.exposeInMainWorld('inlarkDrafts', {
  move: (draft: Draft, accountId: string, identityId: string) =>
    ipcRenderer.invoke('drafts:move', draft, accountId, identityId),
} satisfies DraftsBridge)
