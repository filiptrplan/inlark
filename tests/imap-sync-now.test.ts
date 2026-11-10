import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Account, ImapConnectionConfig } from '../packages/core/src'
import { ImapProvider } from '../packages/imap/src'
import { openInProcessIndex } from '../apps/desktop/src/main/imap-index/sqlite-index'
import { FakeImapServer } from './support/fake-imap'

const config: ImapConnectionConfig = {
  protocol: 'imap',
  email: 'me@example.com',
  incoming: { host: 'imap.example.com', port: 993, security: 'tls', username: 'me' },
  outgoing: { host: 'smtp.example.com', port: 465, security: 'tls', username: 'me' },
  outgoingSameCredentials: true,
}
const at = (minute: number) => new Date(Date.UTC(2026, 8, 20, 10, minute)).toISOString()
let directory: string
let server: FakeImapServer
let providers: ImapProvider[] = []

async function connected(background: boolean): Promise<[ImapProvider, Account]> {
  const p = new ImapProvider({
    connectionId: 'c1',
    name: 'Work',
    config,
    password: 'disposable',
    index: openInProcessIndex(join(directory, 'index-' + providers.length + '.sqlite')),
    readAttachment: async () => new Uint8Array(),
    background,
    ports: server.port,
    // A reconcile far in the future: only an explicit sync can find the new mail.
    timing: { reconcileMs: 3_600_000, sentCopyGraceMs: 0, previews: 0 },
  })
  providers.push(p)
  const [account] = await p.connect()
  return [p, account]
}
const subjects = async (p: ImapProvider, account: Account, view: 'inbox' | 'archive') =>
  (await p.query(account, { view })).items.map((c) => c.subject)

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'inlark-sync-now-'))
  server = new FakeImapServer()
  providers = []
})
afterEach(async () => {
  for (const p of providers) await p.close()
  await rm(directory, { recursive: true, force: true })
})

describe('IMAP sync on demand', () => {
  it('finds mail the IDLE connection never announced, and resolves only once it is indexed', async () => {
    const [p, account] = await connected(true)
    // Wait for the first background pass to finish so the loop is idle until the next reconcile.
    await p.syncNow!(account)
    server.deliver('Archive', { messageId: 'quiet@x', subject: 'Quiet', date: at(3) })
    expect(await subjects(p, account, 'archive')).toEqual([])
    await p.syncNow!(account)
    expect(await subjects(p, account, 'archive')).toEqual(['Quiet'])
  })
  it('syncs directly when the background loop is not running', async () => {
    const [p, account] = await connected(false)
    server.deliver('INBOX', { messageId: 'a@x', subject: 'A', date: at(1) })
    await p.syncNow!(account)
    expect(await subjects(p, account, 'inbox')).toEqual(['A'])
  })
  it('rejects a waiting sync when the account is disconnected', async () => {
    const [p, account] = await connected(true)
    await p.syncNow!(account)
    const pending = p.syncNow!(account)
    p.dispose()
    await expect(pending).rejects.toThrow()
  })
})
