# inlark fork: MCP server

This fork of [inlark/inlark](https://github.com/inlark/inlark) adds an MCP server so AI
assistants can read, organize, and draft email through the accounts already connected in inlark.
The `upstream` remote is inlark/inlark and `origin` is filiptrplan/inlark. Fork work is
developed on the `mcp` branch, which is rebased onto `upstream/main`. The fork's `main` always
points at the same commit as `mcp`, so installs that follow `main` get the fork.

## How it works

The server runs inside the Electron main process. Credentials are encrypted with Electron
`safeStorage` in `JsonStore`, and `MailService` owns the live JMAP and IMAP connections and the
IMAP index, so a separate process could neither decrypt the credentials nor avoid opening
duplicate connections. The server calls `MailService` methods directly.

- `packages/mcp/src/index.ts`: `startMcpServer` listens on a local socket and runs one MCP
  session per connection. On Linux and macOS the socket is `<userData>/mcp.sock` with mode 0600,
  inside the private data directory. On Windows it is a named pipe derived from the data
  directory.
- `packages/mcp/src/server.ts`: the tools.
- `apps/desktop/src/main/mcp.ts`: the Electron side. It starts the server and answers the
  settings panel over IPC, with the same frame check as the mail IPC.
- `apps/desktop/src/preload/mcp.ts` and `apps/desktop/src/renderer/src/McpSettings.tsx`: the
  **Settings → MCP server** panel.
- `packages/mcp/bin/inlark-mcp.mjs`: a dependency-free shim that bridges an MCP client's stdio
  to the socket. inlark must be running.

### Tools

| Tool                                               | Does                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `list_accounts`, `list_folders`, `list_identities` | Describe accounts, folders, and sending identities                                         |
| `search_mail`                                      | Lists conversations in a view or folder, with search filters and paging                    |
| `read_conversation`                                | Returns a conversation's messages as plain text; doesn't mark them read                    |
| `update_conversations`                             | Archive, trash, restore, spam, read/unread, star, move. No permanent deletion              |
| `undo`                                             | Reverts an `update_conversations` call                                                     |
| `list_drafts`, `save_draft`, `delete_draft`        | Create, reply, reply all, forward, and edit drafts. Saved drafts sync to the Drafts folder |
| `send_draft`                                       | Sends a saved draft                                                                        |

### Settings

**Settings → MCP server** chooses Off, Read only, or Full access, shows whether assistants are
connected, and gives the command to connect one. Changes apply right away: switching between Read
only and Full access updates connected assistants' tool lists, and Off disconnects them. The
choice is saved in `<userData>/mcp.json` and defaults to Full access.

Environment variables read by inlark:

- `INLARK_MCP` (`off`, `readonly`, or `on`) overrides the saved choice for that launch, and the
  panel shows it as locked. Read only offers the five reading tools.
- `INLARK_MCP_SOCKET=<path>` overrides the socket path. The shim reads it too.

The shim finds the socket the same way inlark does, including `INLARK_DATA_DIR`.

### Connecting a client

With the Nix package, `inlark-mcp` is installed next to `inlark` and runs the shim with
Electron's bundled Node:

```sh
claude mcp add inlark -- inlark-mcp
```

From a checkout, any Node 18 or later works:

```sh
claude mcp add inlark -- node /path/to/inlark/packages/mcp/bin/inlark-mcp.mjs
```

The packaged AppImage, deb, rpm, and Flatpak builds don't include the shim. Use the checkout
command for those. Flatpak keeps its data under `~/.var/app/<app id>/config/Inlark`, so set
`INLARK_DATA_DIR` or `INLARK_MCP_SOCKET` for the shim.

## Upstream touch points

Every other fork change is in a new file: `FORK.md`, `packages/mcp/`, `tests/mcp.test.ts`,
`apps/desktop/src/main/mcp.ts`, `apps/desktop/src/preload/mcp.ts`, and
`apps/desktop/src/renderer/src/McpSettings.tsx`. Apart from the carried fixes below, these are
the only upstream files the fork changes:

1. `apps/desktop/src/main/index.ts`: one import, and one call right after
   `await service.init()`:
   ```ts
   import { startMcp } from './mcp'
   // …
   await service.init()
   startMcp(service)
   ```
2. `apps/desktop/src/preload/index.ts`: one import, after the existing imports:
   ```ts
   import './mcp'
   ```
3. `apps/desktop/src/renderer/src/Settings.tsx`: one import, one entry in the settings
   navigation list before `about`, and one line before the `about` panel:
   ```tsx
   import { McpIcon, McpSettings } from './McpSettings'
   // …
   ['mcp', 'MCP server', McpIcon],
   // …
   {tab === 'mcp' && <McpSettings notify={notify} />}
   ```
4. `apps/desktop/package.json`: the dependency `"@inlark/mcp": "workspace:*"`.
5. `pnpm-lock.yaml`: regenerated by `pnpm install`. Never edit it by hand.
6. `nix/package.nix`: the `pnpmDeps` hash, and installing the shim in `installPhase`:
   ```nix
   mkdir -p $out/share/inlark/mcp
   cp packages/mcp/bin/*.mjs $out/share/inlark/mcp/
   makeWrapper ${electron_44}/bin/electron $out/bin/inlark-mcp \
     --set ELECTRON_RUN_AS_NODE 1 \
     --add-flags "$out/share/inlark/mcp/inlark-mcp.mjs"
   ```
   If upstream renames `electron_44`, use the new attribute in both wrappers.

## Carried fixes

These are general fixes, kept as separate commits below the MCP commit so each one can go
upstream as a pull request. Once upstream merges an equivalent change, the rebase drops the
commit or it conflicts. Either way, keep upstream's version and drop the fork's commit.

- `fix: remember passwords on Linux desktops Electron doesn't recognize`
  (branch `fix/secret-service-desktops`). It changes `apps/desktop/src/main/app-identity.ts`
  and `tests/app-identity.test.ts`. On niri, Hyprland, Sway, and other desktops Electron doesn't
  recognize, it chooses the Secret Service for saved passwords instead of a plain-text store
  that inlark refuses.

## Syncing with upstream

```sh
git fetch upstream
git checkout mcp
git rebase upstream/main
```

On conflicts:

- `index.ts`, `preload/index.ts`, `Settings.tsx`, or `apps/desktop/package.json`: take
  upstream's version and re-apply the lines from the list above.
- `pnpm-lock.yaml`: take upstream's version, then regenerate it. During a rebase `--ours` is
  upstream and `--theirs` is the fork commit being replayed:
  ```sh
  git checkout --ours pnpm-lock.yaml
  pnpm install
  git add pnpm-lock.yaml
  ```
- `nix/package.nix`: take upstream's version, re-apply the shim lines, then refresh the hash.

Refresh the Nix hash whenever the lockfile changed: set `hash = "";` in `nix/package.nix`, run
`nix build .#inlark.pnpmDeps`, and copy the `got:` hash into the file.

Then check that everything still works and push:

```sh
pnpm install
pnpm check
nix build .#inlark
git branch -f main mcp
git push --force-with-lease origin mcp main
```

If upstream changes a `MailService` method the server uses, `pnpm typecheck` fails in
`apps/desktop/src/main/index.ts`, because `MailService` must match the `MailApi` interface in
`packages/mcp/src/server.ts`. Update `MailApi` and the tool that uses it.
