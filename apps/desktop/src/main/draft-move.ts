// Fork-only: moves a draft already saved on one account's server to another account.
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { draftSchema, type Draft, type Identity } from '@inlark/core'
import type { MailService } from './service'

/** The state of a draft's copy in its account's Drafts folder. */
export type ServerCopy = 'missing' | 'unchanged' | 'changed'

/** The parts of `MailService` a move needs; private ones are lent by `MailService.moveDraft`. */
export interface DraftMovePort {
  save(draft: Draft): Promise<Draft>
  sync(draft: Draft): Promise<Draft>
  identities(accountId: string): Promise<Identity[]>
  accountName(accountId: string): string
  busy: Set<string>
  /** Reads the linked server copy through the draft's own account. */
  serverCopy(draft: Draft): Promise<ServerCopy>
  /** Removes the linked server copy if it is still unchanged. */
  removeServerCopy(draft: Draft): Promise<void>
  /** Stores a draft record as is, bypassing the edit merge in `saveDraft`. */
  replace(draft: Draft): Promise<void>
  changed(accountId: string): void
}

export interface DraftMoveResult {
  draft: Draft
  /** Set when the draft moved but its old server copy is still in the other account. */
  warning?: string
}

/**
 * Saves the draft to the target account first and removes the old server copy only after
 * that succeeded, so a failure leaves at worst a duplicate and never loses the draft.
 */
export async function moveDraft(
  port: DraftMovePort,
  input: Draft,
  accountId: string,
  identityId: string,
): Promise<DraftMoveResult> {
  if (port.busy.has(input.id)) throw new Error('Wait for this draft to finish saving.')
  if (input.accountId === accountId) throw new Error('This draft already belongs to that account.')
  if (!(await port.identities(accountId)).some((i) => i.id === identityId))
    throw new Error('That address is no longer available to send from.')
  const original = await port.save(input)
  if (['uncertain', 'sent', 'sending'].includes(original.status))
    throw new Error('This message is already being sent.')
  const from = port.accountName(original.accountId),
    to = port.accountName(accountId)
  port.busy.add(original.id)
  let moved: Draft
  try {
    if (original.serverId && (await port.serverCopy(original)) === 'changed')
      throw new Error(
        `This draft changed in another client. Close and reopen it before moving it to ${to}.`,
      )
    moved = {
      ...original,
      accountId,
      identityId,
      serverId: undefined,
      serverFingerprint: undefined,
      status: 'local',
      error: undefined,
      errorKind: undefined,
      updatedAt: new Date(Math.max(Date.now(), Date.parse(original.updatedAt) + 1)).toISOString(),
    }
    await port.replace(moved)
  } finally {
    port.busy.delete(original.id)
  }
  const synced = await port.sync(moved)
  if (synced.status !== 'synced') {
    await port.replace(original)
    throw new Error(
      `The draft could not be saved to ${to}${synced.error ? ': ' + synced.error : '.'} It stays in ${from}.`,
    )
  }
  port.changed(accountId)
  if (!original.serverId) return { draft: synced }
  try {
    await port.removeServerCopy(original)
    port.changed(original.accountId)
    return { draft: synced }
  } catch {
    return {
      draft: synced,
      warning: `Moved to ${to}. The old copy could not be removed from ${from}’s Drafts folder.`,
    }
  }
}

const input = z.tuple([draftSchema, z.string().min(1).max(2048), z.string().min(1).max(2048)])

/** Only the app's own page may move drafts, like the mail IPC in index.ts. */
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

export function startDraftMoves(service: Pick<MailService, 'moveDraft'>) {
  ipcMain.handle('drafts:move', async (event, ...args: unknown[]) => {
    if (!trusted(event)) throw new Error('Untrusted application frame.')
    const parsed = input.safeParse(args)
    if (!parsed.success) throw new Error('Invalid input.')
    return service.moveDraft(...(parsed.data as [Draft, string, string]))
  })
}
