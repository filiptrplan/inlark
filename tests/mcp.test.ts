import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultSettings,
  type Account,
  type Draft,
  type Identity,
  type Message,
} from '@inlark/core'
import { startMcpServer, socketPath, defaultDataDirectory, type MailApi } from '../packages/mcp/src'
import { composeDraft } from '../packages/mcp/src/drafts'
import { htmlText } from '../packages/mcp/src/text'

const shim = fileURLToPath(new URL('../packages/mcp/bin/inlark-mcp.mjs', import.meta.url))

const account = {
  id: 'a1',
  connectionId: 'c1',
  remoteId: 'r1',
  name: 'Work',
  email: 'me@example.com',
  color: '#a69aef',
  status: 'connected',
  protocol: 'jmap',
} satisfies Account
const identities: Identity[] = [
  { id: 'i1', accountId: 'a1', name: 'Me', email: 'me@example.com', textSignature: '-- \nMe' },
]
const message: Message = {
  id: 'm1',
  accountId: 'a1',
  threadId: 't1',
  subject: 'Lunch?',
  from: [{ name: 'Ada', email: 'ada@example.com' }],
  to: [{ name: 'Me', email: 'me@example.com' }],
  cc: [{ name: '', email: 'bob@example.com' }],
  bcc: [],
  replyTo: [],
  receivedAt: '2026-10-01T12:00:00Z',
  preview: 'Are you free',
  keywords: {},
  mailboxIds: { inbox: true },
  size: 100,
  hasAttachment: false,
  html: '<p>Are you <b>free</b> on Friday?</p><p>Ada &amp; co</p>',
  messageId: ['<m1@example.com>'],
  references: ['<m0@example.com>'],
}

function fakeMail() {
  const synced: Draft[] = []
  const sent: Draft[] = []
  const mutations: unknown[] = []
  const mail: MailApi = {
    bootstrap: async () => ({ accounts: [account], settings: defaultSettings }),
    mailboxes: async () => [],
    identities: async () => identities,
    query: async (query) => ({
      items: query.view === 'inbox' ? [{ ...conversation, accountId: 'a1' }] : [],
      total: 1,
      failedAccounts: [],
      next: { a1: 50 },
    }),
    conversation: async () => [message],
    mutate: async (input) => {
      mutations.push(input)
      return { changed: input.targets.length, failures: [], undoId: 'u1' }
    },
    undo: async () => ({ changed: 1, failures: [] }),
    drafts: async () => synced,
    stageRemoteAttachments: async () => [],
    syncDraft: async (draft) => {
      const saved = { ...draft, status: 'synced' as const, serverId: 's1' }
      synced.push(saved)
      return saved
    },
    deleteDraft: async () => {},
    send: async (draft) => {
      sent.push(draft)
      return { status: 'sent', message: 'Sent.' }
    },
  }
  return { mail, synced, sent, mutations }
}
const conversation = {
  id: 't1',
  accountId: 'a1',
  key: '["a1","t1"]',
  subject: 'Lunch?',
  from: message.from,
  preview: 'Are you free',
  receivedAt: message.receivedAt,
  unread: true,
  starred: false,
  hasAttachment: false,
  count: 1,
  messages: [],
}

/** Talks newline-delimited JSON-RPC through the real shim, as an MCP client would. */
function client(socket: string) {
  const child = spawn(process.execPath, [shim], {
    env: { ...process.env, INLARK_MCP_SOCKET: socket },
  }) as ChildProcessWithoutNullStreams
  const pending = new Map<number, (value: any) => void>()
  const notifications: string[] = []
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve))
  createInterface({ input: child.stdout }).on('line', (line) => {
    const reply = JSON.parse(line)
    if (reply.id === undefined) notifications.push(reply.method)
    else pending.get(reply.id)?.(reply)
  })
  let next = 0
  const request = (method: string, params: unknown = {}) =>
    new Promise<any>((resolve) => {
      const id = ++next
      pending.set(id, resolve)
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  const call = async (name: string, args: unknown = {}) => {
    const reply = await request('tools/call', { name, arguments: args })
    const text = reply.result.content[0].text
    return { error: reply.result.isError as boolean | undefined, text, data: safeJson(text) }
  }
  const initialize = async () => {
    const reply = await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    })
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
    )
    return reply
  }
  const tools = async () =>
    (await request('tools/list')).result.tools.map((t: { name: string }) => t.name).sort()
  return { child, request, call, initialize, tools, notifications, exited }
}
const safeJson = (text: string) => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})
function serve(mail: MailApi, env: Record<string, string> = {}, directory?: string) {
  directory ??= mkdtempSync(join(tmpdir(), 'inlark-mcp-'))
  const path = socketPath(directory)
  const quit: (() => void)[] = []
  const controller = startMcpServer(
    mail,
    { getPath: () => directory, getVersion: () => '9.9.9', on: (_e, fn) => quit.push(fn) },
    { env, path },
  )
  cleanups.push(() => {
    quit.forEach((fn) => fn())
    rmSync(directory, { recursive: true, force: true })
  })
  return { controller, path, directory }
}
const readTools = [
  'list_accounts',
  'list_folders',
  'list_identities',
  'read_conversation',
  'search_mail',
]
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('MCP socket', () => {
  it('finds the same socket as the desktop app', () => {
    expect(defaultDataDirectory({ XDG_CONFIG_HOME: '/x' }, 'linux')).toBe('/x/Inlark')
    expect(defaultDataDirectory({ INLARK_DATA_DIR: '/d', XDG_CONFIG_HOME: '/x' }, 'linux')).toBe(
      '/d',
    )
    expect(socketPath('/x/Inlark', 'linux')).toBe('/x/Inlark/mcp.sock')
    expect(socketPath('C:\\Users\\A\\AppData\\Roaming\\Inlark', 'win32')).toBe(
      socketPath('c:\\users\\a\\appdata\\roaming\\inlark', 'win32'),
    )
  })

  it('stays off when INLARK_MCP turns it off, and the settings cannot change that', async () => {
    const { controller, path } = serve(fakeMail().mail, { INLARK_MCP: 'off' })
    expect(controller.status()).toMatchObject({ mode: 'off', locked: true, listening: false })
    expect(existsSync(path)).toBe(false)
    await expect(controller.setMode('on')).rejects.toThrow(/INLARK_MCP/)
  })

  it('switches modes live and remembers the choice', async () => {
    const { controller, path, directory } = serve(fakeMail().mail)
    expect(controller.status()).toMatchObject({ mode: 'on', locked: false, listening: true })
    const mcp = client(path)
    cleanups.push(() => mcp.child.kill())
    await mcp.initialize()
    expect(await mcp.tools()).toContain('send_draft')
    expect(controller.status().clients).toBe(1)

    await controller.setMode('readonly')
    await settle()
    expect(mcp.notifications).toContain('notifications/tools/list_changed')
    expect(await mcp.tools()).toEqual(readTools)
    expect((await mcp.call('send_draft', { draftId: crypto.randomUUID() })).error).toBe(true)

    expect(await controller.setMode('off')).toMatchObject({ listening: false, clients: 0 })
    expect(await mcp.exited).toBe(0)
    expect(existsSync(path)).toBe(false)
    expect(JSON.parse(readFileSync(join(directory, 'mcp.json'), 'utf8'))).toEqual({ mode: 'off' })

    // A new launch starts from the saved choice.
    controller.close()
    const again = serve(fakeMail().mail, {}, directory)
    expect(again.controller.status()).toMatchObject({ mode: 'off', listening: false })
    expect(await again.controller.setMode('readonly')).toMatchObject({ listening: true })
    const reader = client(path)
    cleanups.push(() => reader.child.kill())
    await reader.initialize()
    expect(await reader.tools()).toEqual(readTools)
  })

  it('serves tools through the shim to an owner-only socket', async () => {
    const { mail, synced, sent, mutations } = fakeMail()
    const { path } = serve(mail)
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    const mcp = client(path)
    cleanups.push(() => mcp.child.kill())

    const init = await mcp.initialize()
    expect(init.result.serverInfo).toMatchObject({ name: 'inlark', version: '9.9.9' })
    const tools = (await mcp.request('tools/list')).result.tools.map((t: any) => t.name)
    expect(tools).toEqual(expect.arrayContaining(['search_mail', 'save_draft', 'send_draft']))

    const accounts = await mcp.call('list_accounts')
    expect(accounts.data).toEqual([
      expect.objectContaining({ accountId: 'a1', email: 'me@example.com', status: 'connected' }),
    ])

    const search = await mcp.call('search_mail', { unread: true })
    expect(search.data.conversations[0]).toMatchObject({ threadId: 't1', unread: true })
    const page2 = await mcp.call('search_mail', { cursor: search.data.nextCursor })
    expect(page2.error).toBeFalsy()
    expect((await mcp.call('search_mail', { cursor: 'nope' })).error).toBe(true)

    const thread = await mcp.call('read_conversation', { accountId: 'a1', threadId: 't1' })
    expect(thread.data.messages[0].body).toBe('Are you free on Friday?\nAda & co')

    const archived = await mcp.call('update_conversations', {
      conversations: [{ accountId: 'a1', threadId: 't1' }],
      action: 'archive',
    })
    expect(archived.data).toMatchObject({ changed: 1, undoId: 'u1' })
    expect(mutations).toHaveLength(1)
    const destroy = await mcp.call('update_conversations', {
      conversations: [{ accountId: 'a1', threadId: 't1' }],
      action: 'destroy',
    })
    expect(destroy.error).toBe(true)

    const draft = await mcp.call('save_draft', {
      kind: 'replyAll',
      accountId: 'a1',
      threadId: 't1',
      body: 'Yes, see you there.',
    })
    expect(draft.data).toMatchObject({
      to: ['Ada <ada@example.com>'],
      cc: ['bob@example.com'],
      subject: 'Re: Lunch?',
      status: 'synced',
    })
    expect(synced[0]).toMatchObject({
      identityId: 'i1',
      inReplyTo: ['<m1@example.com>'],
      references: ['<m0@example.com>', '<m1@example.com>'],
      replyThreadId: 't1',
    })
    expect(synced[0].text).toMatch(/^Yes, see you there\.\n\n-- \nMe\n\nOn .* wrote:\n> Are you/)

    const bad = await mcp.call('save_draft', { accountId: 'a1', to: ['not an address'] })
    expect(bad.error).toBe(true)
    expect(bad.text).toMatch(/not valid/)

    const result = await mcp.call('send_draft', { draftId: draft.data.draftId })
    expect(result.data).toMatchObject({ status: 'sent' })
    expect(sent[0].id).toBe(draft.data.draftId)
  })

  it('offers only reading tools when INLARK_MCP is readonly', async () => {
    const { controller, path } = serve(fakeMail().mail, { INLARK_MCP: 'readonly' })
    expect(controller.status()).toMatchObject({ mode: 'readonly', locked: true })
    const mcp = client(path)
    cleanups.push(() => mcp.child.kill())
    await mcp.initialize()
    expect(await mcp.tools()).toEqual(readTools)
  })

  it('explains when inlark is not running', async () => {
    const child = spawn(process.execPath, [shim], {
      env: { ...process.env, INLARK_MCP_SOCKET: join(tmpdir(), 'inlark-missing.sock') },
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const code = await new Promise((resolve) => child.on('exit', resolve))
    expect(code).toBe(1)
    expect(stderr).toMatch(/inlark is not running/)
  })
})

describe('MCP drafts', () => {
  it('forwards without threading and keeps the original', () => {
    const draft = composeDraft({
      kind: 'forward',
      accountId: 'a1',
      identities,
      settings: defaultSettings,
      message,
      body: 'FYI',
      quote: false,
    })
    expect(draft).toMatchObject({ to: [], subject: 'Fwd: Lunch?' })
    expect(draft.inReplyTo).toBeUndefined()
    expect(draft.text).toContain('---------- Forwarded message ----------')
    expect(draft.html).toContain('Ada &amp; co')
  })

  it('rejects an identity from another account', () => {
    expect(() =>
      composeDraft({
        kind: 'new',
        accountId: 'a1',
        identities,
        identityId: 'other',
        settings: defaultSettings,
        body: '',
        quote: true,
      }),
    ).toThrow(/identity/)
  })

  it('reads HTML as text', () => {
    expect(
      htmlText(
        '<html><head><style>p{}</style></head><body><ul><li>One</li><li>Two&nbsp;&#x2713;</li></ul></body></html>',
      ),
    ).toBe('• One\n• Two ✓')
  })
})
