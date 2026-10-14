// Shared by the server inside inlark and the standalone shim, so both find the same socket.
// Plain JavaScript keeps the shim runnable by any Node, including Electron in Node mode.
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Electron's default `userData` for inlark, as configured in apps/desktop/src/main/app-identity.ts. */
export function defaultDataDirectory(env = process.env, platform = process.platform) {
  if (env.INLARK_DATA_DIR) return env.INLARK_DATA_DIR
  const appData =
    platform === 'win32'
      ? env.APPDATA || join(homedir(), 'AppData', 'Roaming')
      : platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support')
        : env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(appData, 'Inlark')
}

/** A socket inside the private data directory, or a per-directory named pipe on Windows. */
export function socketPath(dataDirectory, platform = process.platform) {
  if (platform === 'win32')
    return (
      '\\\\.\\pipe\\inlark-mcp-' +
      createHash('sha256').update(dataDirectory.toLowerCase()).digest('hex').slice(0, 16)
    )
  return join(dataDirectory, 'mcp.sock')
}
