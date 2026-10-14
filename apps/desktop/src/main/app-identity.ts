import type { App } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

type IdentityApp = Pick<App, 'setName' | 'getPath' | 'setPath'> & {
  commandLine: Pick<App['commandLine'], 'hasSwitch' | 'appendSwitch'>
  once(event: 'ready', listener: () => void): unknown
}

/**
 * Electron only uses the Secret Service on desktops it recognizes, such as GNOME. Elsewhere,
 * including niri, Hyprland, and Sway, it falls back to a plain-text store that inlark refuses,
 * so passwords can't be remembered even with a keyring running. KDE keeps KWallet, and an
 * explicit `--password-store` always wins. Without a Secret Service, storage stays unavailable,
 * exactly as before.
 */
export function preferSecretService(
  commandLine: IdentityApp['commandLine'],
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== 'linux' || commandLine.hasSwitch('password-store')) return
  const kde =
    (env.XDG_CURRENT_DESKTOP || '').split(':').some((d) => d.trim().toUpperCase() === 'KDE') ||
    /kde|plasma/i.test(env.DESKTOP_SESSION || '') ||
    !!env.KDE_FULL_SESSION
  if (!kde) commandLine.appendSwitch('password-store', 'gnome-libsecret')
}

export function configureAppIdentity(
  app: IdentityApp,
  dataDirectory = process.env.INLARK_DATA_DIR,
) {
  // Electron 44 captures this name for OS credential storage before ready. Preserve it so
  // saved account passwords remain readable, then use the lowercase name for native UI.
  // https://github.com/electron/electron/blob/v44.4.5/shell/browser/electron_browser_main_parts.cc
  app.setName('Inlark')
  preferSecretService(app.commandLine)
  const userData = dataDirectory || join(app.getPath('appData'), 'Inlark')
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  app.setPath('userData', userData)
  app.setPath('sessionData', userData)
  app.once('ready', () => app.setName('inlark'))
}
