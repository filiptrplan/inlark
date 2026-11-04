// Fork-only: moving a server-saved draft to another account.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({
  app: { getVersion: () => 'test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => 'basic_text',
    encryptString: (value: string) => Buffer.from('encrypted:' + value),
    decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, ''),
  },
  dialog: {},
  shell: {},
  ipcMain: { handle: () => {} },
  Notification: { isSupported: () => false },
}))
import { MailService } from '../apps/desktop/src/main/service'
import { JsonStore } from '../apps/desktop/src/main/storage'
import { JmapProvider } from '../packages/jmap/src'
import type { Account, Draft, Mailbox, Message } from '../packages/core/src'

const base = { connectionId: 'connection', color: '#aaa', status: 'connected' as const }
const personal: Account = {
  ...base,
  id: 'personal',
  remoteId: 'p',
  name: 'Personal',
  email: 'me@example.com',
}
const work: Account = { ...base, id: 'work', remoteId: 'w', name: 'Work', email: 'me@work.example' }
const draft: Draft = {
  id: 'fb4c0a00-254f-4fb1-965e-96d56ca9ef17',
  accountId: personal.id,
  identityId: 'personal-identity',
  to: [{ name: 'Recipient', email: 'recipient@example.com' }],
  cc: [],
  bcc: [],
  subject: 'Leave of absence',
  html: '<p>Hello</p>',
  text: 'Hello',
  attachments: [],
  updatedAt: '2026-11-03T10:00:00.000Z',
  status: 'local',
}
const boxes = (accountId: string) =>
  ['inbox', 'drafts', 'sent', 'trash'].map((id) => ({
    id,
    accountId,
    name: id,
    role: id,
    parentId: null,
    totalEmails: 0,
    unreadEmails: 0,
    rights: {
      mayReadItems: true,
      mayAddItems: true,
      mayRemoveItems: true,
      maySetSeen: true,
      maySetKeywords: true,
      mayCreateChild: true,
      mayRename: true,
      mayDelete: true,
    },
  })) satisfies Mailbox[]

/** Server drafts by id, with the account each one was created in. */
let remote: Map<string, { accountId: string; message: Message }>
let directory: string, service: MailService

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'inlark-move-'))
  service = new MailService(new JsonStore(directory), () => {})
  await service.init()
  remote = new Map()
  let revision = 0
  vi.spyOn(JmapProvider.prototype, 'connect').mockResolvedValue([personal, work])
  vi.spyOn(JmapProvider.prototype, 'identities').mockImplementation(async (account) => [
    { id: account.id + '-identity', accountId: account.id, name: 'Me', email: account.email },
  ])
  vi.spyOn(JmapProvider.prototype, 'subscribe').mockReturnValue(() => {})
  vi.spyOn(JmapProvider.prototype, 'mailboxes').mockImplementation(async (a) => boxes(a.id))
  vi.spyOn(JmapProvider.prototype, 'query').mockResolvedValue({ items: [], total: 0 })
  vi.spyOn(JmapProvider.prototype, 'createDraft').mockImplementation(async (account, input) => {
    const id = account.id + '-revision-' + ++revision
    remote.set(id, {
      accountId: account.id,
      message: {
        id,
        threadId: id,
        accountId: account.id,
        subject: input.subject,
        from: [],
        to: input.to,
        cc: [],
        bcc: [],
        replyTo: [],
        receivedAt: input.updatedAt,
        preview: '',
        html: input.html,
        text: input.text,
        keywords: { $draft: true, $seen: true },
        mailboxIds: { drafts: true },
        size: 1,
        hasAttachment: false,
      },
    })
    return id
  })
  vi.spyOn(JmapProvider.prototype, 'messages').mockImplementation(async (account, ids) =>
    ids.flatMap((id) => {
      const entry = remote.get(id)
      return entry && entry.accountId === account.id ? [entry.message] : []
    }),
  )
  vi.spyOn(JmapProvider.prototype, 'update').mockImplementation(async (account, _c, ids) => {
    for (const id of ids || []) if (remote.get(id)?.accountId === account.id) remote.delete(id)
    return { updated: ids || [], failures: [] }
  })
  await service.connect({
    config: { protocol: 'jmap', serverUrl: 'https://mail.example', username: 'test' },
    password: 'disposable',
    name: 'Test',
    remember: false,
    connectionId: 'connection',
  })
})
afterEach(async () => {
  service.dispose()
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

describe('moving a draft to another account', () => {
  it('saves to the new account, then removes the old server copy', async () => {
    const saved = await service.syncDraft(draft)
    expect(saved.status).toBe('synced')
    const edited = { ...saved, text: 'Edited', updatedAt: '2026-11-03T10:05:00.000Z' }
    const { draft: moved, warning } = await service.moveDraft(edited, work.id, 'work-identity')
    expect(warning).toBeUndefined()
    expect(moved).toMatchObject({
      accountId: work.id,
      identityId: 'work-identity',
      status: 'synced',
      text: 'Edited',
    })
    expect([...remote.entries()].map(([id, e]) => [id, e.accountId])).toEqual([
      [moved.serverId, work.id],
    ])
    expect(await service.drafts()).toEqual([expect.objectContaining({ accountId: work.id })])
  })

  it('keeps the draft in its account when the new account cannot save it', async () => {
    const saved = await service.syncDraft(draft)
    vi.mocked(JmapProvider.prototype.createDraft).mockRejectedValueOnce(new Error('Quota full'))
    await expect(service.moveDraft(saved, work.id, 'work-identity')).rejects.toThrow(
      /could not be saved to Work.*stays in Personal/,
    )
    expect(remote.has(saved.serverId!)).toBe(true)
    expect(await service.drafts()).toEqual([
      expect.objectContaining({ accountId: personal.id, serverId: saved.serverId }),
    ])
  })

  it('refuses to move a draft that changed in another client', async () => {
    const saved = await service.syncDraft(draft)
    remote.get(saved.serverId!)!.message.text = 'Changed elsewhere'
    await expect(service.moveDraft(saved, work.id, 'work-identity')).rejects.toThrow(
      /changed in another client/,
    )
    expect(JmapProvider.prototype.createDraft).toHaveBeenCalledTimes(1)
    expect((await service.drafts())[0]).toMatchObject({ accountId: personal.id })
  })

  it('reports an old copy it could not remove without undoing the move', async () => {
    const saved = await service.syncDraft(draft)
    vi.mocked(JmapProvider.prototype.update).mockResolvedValueOnce({
      updated: [],
      failures: [saved.serverId!],
    } as never)
    const result = await service.moveDraft(saved, work.id, 'work-identity')
    expect(result.draft).toMatchObject({ accountId: work.id, status: 'synced' })
    expect(result.warning).toMatch(/old copy could not be removed from Personal/)
  })

  it('rejects an address the new account cannot send from', async () => {
    const saved = await service.syncDraft(draft)
    await expect(service.moveDraft(saved, work.id, 'someone-else')).rejects.toThrow(
      /no longer available/,
    )
    expect(remote.has(saved.serverId!)).toBe(true)
  })
})
