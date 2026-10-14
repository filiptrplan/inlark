import { chmodSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { socketPath } from '../bin/socket-path.mjs'
import { createMcpServer, type MailApi } from './server'

export { createMcpServer, type MailApi, type McpOptions } from './server'
export { defaultDataDirectory, socketPath } from '../bin/socket-path.mjs'

/** The few Electron `app` methods the server needs, so this package doesn't depend on Electron. */
export interface McpHost {
  getPath(name: 'userData'): string
  getVersion(): string
  on(event: 'before-quit', listener: () => void): unknown
}

/**
 * Serves MCP over a local socket that only this user can open, one session per connection.
 * The `inlark-mcp` shim bridges an MCP client's stdio to it. Runs inside the main process
 * because only it can decrypt the saved credentials and it owns the live connections.
 *
 * `INLARK_MCP=off` turns the server off; `INLARK_MCP=readonly` offers only reading tools.
 */
export function startMcpServer(
  mail: MailApi,
  host: McpHost,
  mode = process.env.INLARK_MCP,
  path?: string,
): Server | undefined {
  if (mode === 'off' || mode === '0' || mode === 'false') return
  path ||= process.env.INLARK_MCP_SOCKET || socketPath(host.getPath('userData'))
  const readOnly = mode === 'readonly'
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    const mcp = createMcpServer(mail, { readOnly, version: host.getVersion() })
    const transport = new StdioServerTransport(socket, socket)
    mcp.server.onclose = () => socket.destroy()
    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      sockets.delete(socket)
      void mcp.close().catch(() => {})
    })
    mcp.connect(transport).catch(() => socket.destroy())
  })
  const unavailable = (error: unknown) =>
    console.error('inlark MCP server unavailable:', error instanceof Error ? error.message : error)
  server.on('error', unavailable)
  // Mail must keep working whatever happens here, so setup problems are only logged.
  try {
    // The single-instance lock is held, so a leftover socket can only be from a crash.
    if (process.platform !== 'win32') rmSync(path, { force: true })
    server.listen(path)
    // The data directory is already private; this also keeps the socket itself owner-only.
    if (process.platform !== 'win32') chmodSync(path, 0o600)
  } catch (error) {
    unavailable(error)
    server.close()
    return
  }
  host.on('before-quit', () => {
    server.close()
    for (const socket of sockets) socket.destroy()
  })
  return server
}
