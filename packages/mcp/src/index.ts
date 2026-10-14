import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { socketPath } from '../bin/socket-path.mjs'
import { createMcpServer, type MailApi, type McpSession } from './server'

export { createMcpServer, type MailApi, type McpOptions, type McpSession } from './server'
export { defaultDataDirectory, socketPath } from '../bin/socket-path.mjs'

/** `on` offers every tool, `readonly` only the tools that read mail. */
export type McpMode = 'off' | 'readonly' | 'on'
export const mcpModes: readonly McpMode[] = ['off', 'readonly', 'on']

export interface McpStatus {
  mode: McpMode
  /** True when `INLARK_MCP` chose the mode, which the settings then can't change. */
  locked: boolean
  listening: boolean
  /** Why the server couldn't start, when it couldn't. */
  error?: string
  /** MCP clients connected right now. */
  clients: number
  socket: string
}

export interface McpController {
  status(): McpStatus
  /** Saves the mode for future launches and applies it right away. */
  setMode(mode: McpMode): Promise<McpStatus>
  close(): void
}

/** The few Electron `app` methods the server needs, so this package doesn't depend on Electron. */
export interface McpHost {
  getPath(name: 'userData'): string
  getVersion(): string
  on(event: 'before-quit', listener: () => void): unknown
}

function environmentMode(value: string | undefined): McpMode | undefined {
  const v = value?.trim().toLowerCase()
  if (v === 'off' || v === '0' || v === 'false') return 'off'
  if (v === 'readonly' || v === 'read-only') return 'readonly'
  if (v === 'on' || v === '1' || v === 'true') return 'on'
}
function savedMode(file: string): McpMode | undefined {
  try {
    const { mode } = JSON.parse(readFileSync(file, 'utf8'))
    return mcpModes.includes(mode) ? mode : undefined
  } catch {
    return undefined
  }
}

/**
 * Serves MCP over a local socket that only this user can open, one session per connection.
 * The `inlark-mcp` shim bridges an MCP client's stdio to it. Runs inside the main process
 * because only it can decrypt the saved credentials and it owns the live connections.
 *
 * The mode is saved in `mcp.json` in the data directory and defaults to `on`. The
 * `INLARK_MCP` environment variable (`off`, `readonly`, or `on`) overrides it.
 */
export function startMcpServer(
  mail: MailApi,
  host: McpHost,
  options: { env?: Record<string, string | undefined>; path?: string } = {},
): McpController {
  const env = options.env ?? process.env
  const directory = host.getPath('userData')
  const file = join(directory, 'mcp.json')
  const path = options.path || env.INLARK_MCP_SOCKET || socketPath(directory)
  const forced = environmentMode(env.INLARK_MCP)
  let mode: McpMode = forced ?? savedMode(file) ?? 'on'
  let server: Server | undefined
  let error: string | undefined
  const sessions = new Map<Socket, McpSession>()

  const unavailable = (cause: unknown) => {
    error = cause instanceof Error ? cause.message : String(cause)
    console.error('inlark MCP server unavailable:', error)
  }
  const start = () => {
    error = undefined
    const listener = createServer((socket) => {
      const session = createMcpServer(mail, {
        readOnly: mode === 'readonly',
        version: host.getVersion(),
      })
      sessions.set(socket, session)
      const transport = new StdioServerTransport(socket, socket)
      session.server.server.onclose = () => socket.destroy()
      socket.on('error', () => socket.destroy())
      socket.on('close', () => {
        sessions.delete(socket)
        void session.server.close().catch(() => {})
      })
      session.server.connect(transport).catch(() => socket.destroy())
    })
    listener.on('error', (cause) => {
      unavailable(cause)
      if (server === listener) server = undefined
      listener.close()
    })
    // Mail must keep working whatever happens here, so setup problems are only reported.
    try {
      // The single-instance lock is held, so a leftover socket can only be from a crash.
      if (process.platform !== 'win32') rmSync(path, { force: true })
      listener.listen(path)
      // The data directory is already private; this also keeps the socket itself owner-only.
      if (process.platform !== 'win32') chmodSync(path, 0o600)
      server = listener
    } catch (cause) {
      unavailable(cause)
      listener.close()
    }
  }
  const stop = () => {
    server?.close()
    server = undefined
    for (const socket of sessions.keys()) socket.destroy()
    sessions.clear()
  }

  const status = (): McpStatus => ({
    mode,
    locked: !!forced,
    listening: !!server?.listening,
    ...(error ? { error } : {}),
    clients: sessions.size,
    socket: path,
  })
  if (mode !== 'off') start()
  host.on('before-quit', stop)

  return {
    status,
    async setMode(next) {
      if (forced) throw new Error('INLARK_MCP sets the MCP server mode for this session.')
      writeFileSync(file, JSON.stringify({ mode: next }), { mode: 0o600 })
      const previous = mode
      mode = next
      if (next === 'off') stop()
      else if (previous === 'off' || !server) start()
      else for (const session of sessions.values()) session.setReadOnly(next === 'readonly')
      // A failed listen reports its error on the next turn of the event loop.
      await new Promise((resolve) => setImmediate(resolve))
      return status()
    },
    close: stop,
  }
}
