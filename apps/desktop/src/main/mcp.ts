// Fork-only: connects the MCP server in @inlark/mcp to Electron and the settings panel.
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { mcpModes, startMcpServer, type MailApi, type McpMode, type McpStatus } from '@inlark/mcp'

/** What the settings panel shows: the server's state and how to connect a client to it. */
export type McpPanelStatus = McpStatus & {
  /** The stdio command an MCP client runs, when this installation includes the shim. */
  command?: string
}

const executable = (path: string) => {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
const quote = (value: string) => (/^[\w./:-]+$/.test(value) ? value : JSON.stringify(value))

/** The shim on PATH, next to a Nix install, or in a source checkout, in that order. */
function shimCommand(): string | undefined {
  const name = process.platform === 'win32' ? 'inlark-mcp.cmd' : 'inlark-mcp'
  for (const dir of (process.env.PATH || '').split(delimiter))
    if (dir && executable(join(dir, name))) return 'inlark-mcp'
  const installed = join(app.getAppPath(), '..', '..', 'bin', 'inlark-mcp')
  if (executable(installed)) return quote(installed)
  const checkout = join(app.getAppPath(), '..', '..', 'packages', 'mcp', 'bin', 'inlark-mcp.mjs')
  try {
    accessSync(checkout)
    return 'node ' + quote(checkout)
  } catch {
    return undefined
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
  const command = shimCommand()
  const panel = (status: McpStatus): McpPanelStatus => ({ ...status, command })
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
