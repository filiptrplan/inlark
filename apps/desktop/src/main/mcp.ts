// Fork-only: connects the MCP server in @inlark/mcp to Electron and the settings panel.
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { mcpModes, startMcpServer, type MailApi, type McpMode, type McpStatus } from '@inlark/mcp'

/** What the settings panel shows: the server's state and how to connect a client to it. */
export type McpPanelStatus = McpStatus & {
  /** The stdio command an MCP client runs, when this installation includes the shim. */
  command?: string
  /** The same server as a Claude Desktop config entry, and the file it goes in. */
  claudeDesktop?: { config: string; entry: string }
}

/** How to run the shim: `command` for a terminal, `argv` with absolute paths for GUI clients. */
type Shim = { command: string; argv: string[] }

const executable = (path: string) => {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
const quote = (value: string) => (/^[\w./:-]+$/.test(value) ? value : JSON.stringify(value))

const onPath = (name: string) => {
  for (const dir of (process.env.PATH || '').split(delimiter))
    if (dir && executable(join(dir, name))) return join(dir, name)
  return undefined
}

/** The shim on PATH, next to a Nix install, or in a source checkout, in that order. */
function shim(): Shim | undefined {
  const found = onPath(process.platform === 'win32' ? 'inlark-mcp.cmd' : 'inlark-mcp')
  if (found) return { command: 'inlark-mcp', argv: [found] }
  const installed = join(app.getAppPath(), '..', '..', 'bin', 'inlark-mcp')
  if (executable(installed)) return { command: quote(installed), argv: [installed] }
  const checkout = join(app.getAppPath(), '..', '..', 'packages', 'mcp', 'bin', 'inlark-mcp.mjs')
  try {
    accessSync(checkout)
  } catch {
    return undefined
  }
  const node = onPath(process.platform === 'win32' ? 'node.exe' : 'node') ?? 'node'
  return { command: 'node ' + quote(checkout), argv: [node, checkout] }
}

/**
 * Claude Desktop starts servers without a shell or the user's PATH, so the entry uses absolute
 * paths, and passes on a socket that only this launch's environment would otherwise find.
 */
function claudeDesktop({ argv }: Shim, socket: string) {
  const [command, ...args] = argv
  const env =
    process.env.INLARK_MCP_SOCKET || process.env.INLARK_DATA_DIR
      ? { INLARK_MCP_SOCKET: socket }
      : undefined
  const server = { command, ...(args.length ? { args } : {}), ...(env ? { env } : {}) }
  return {
    config: join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json'),
    entry: JSON.stringify({ mcpServers: { inlark: server } }, null, 2),
  }
}

/** Only the app's own page may read or change the server, like the mail IPC in index.ts. */
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

export function startMcp(service: MailApi) {
  const mcp = startMcpServer(service, app)
  const found = shim()
  const panel = (status: McpStatus): McpPanelStatus =>
    found
      ? { ...status, command: found.command, claudeDesktop: claudeDesktop(found, status.socket) }
      : status
  ipcMain.handle('mcp:status', (event) => {
    if (!trusted(event)) throw new Error('Untrusted application frame.')
    return panel(mcp.status())
  })
  ipcMain.handle('mcp:setMode', async (event, mode: unknown) => {
    if (!trusted(event)) throw new Error('Untrusted application frame.')
    if (!mcpModes.includes(mode as McpMode)) throw new Error('Invalid input.')
    return panel(await mcp.setMode(mode as McpMode))
  })
}
