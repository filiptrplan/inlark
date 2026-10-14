// Fork-only: exposes the MCP server settings to the app page as `window.inlarkMcp`.
import { contextBridge, ipcRenderer } from 'electron'
import type { McpMode } from '@inlark/mcp'
import type { McpPanelStatus } from '../main/mcp'

export interface McpBridge {
  status(): Promise<McpPanelStatus>
  setMode(mode: McpMode): Promise<McpPanelStatus>
}

contextBridge.exposeInMainWorld('inlarkMcp', {
  status: () => ipcRenderer.invoke('mcp:status'),
  setMode: (mode: McpMode) => ipcRenderer.invoke('mcp:setMode', mode),
} satisfies McpBridge)
