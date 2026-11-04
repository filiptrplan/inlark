# inlark fork

This is a fork of [inlark/inlark](https://github.com/inlark/inlark). The `upstream` remote is
inlark/inlark and `origin` is filiptrplan/inlark.

## Moving a draft to another account

Upstream locks a draft to its account once it is saved to the server's Drafts folder. The fork
lets the From menu move it: `moveDraft` in `apps/desktop/src/main/draft-move.ts` saves the draft
to the new account first and removes the old server copy only after that worked. It refuses
when the old copy changed in another client, and restores the draft to its old account when the
new one cannot save it. The renderer reaches it through `window.inlarkDrafts`
(`apps/desktop/src/preload/drafts.ts`, `apps/desktop/src/renderer/src/draft-move.ts`); tests
are in `tests/draft-move.test.ts`. Upstream touch points:

- `apps/desktop/src/main/service.ts`: one import and the `moveDraft` method before
  `completeDraft`, which lends the move the service's private draft state.
- `apps/desktop/src/main/index.ts`: `startDraftMoves(service)` after `startCalendarInvites`.
- `apps/desktop/src/preload/index.ts`: `import './drafts'`.
- `apps/desktop/src/renderer/src/Composer.tsx`: the From options stay enabled when the bridge
  exists, and `selectAccount` calls `bridge.move` for a server-saved draft.

## Carried fixes

These are general fixes, each kept as its own commit with a matching branch off upstream's `main`,
so each one can go upstream as a pull request. Once upstream merges an equivalent change, the rebase drops the
commit or it conflicts. Either way, keep upstream's version and drop the fork's commit.

- `fix: remember passwords on Linux desktops Electron doesn't recognize`
  (branch `fix/secret-service-desktops`). It changes `apps/desktop/src/main/app-identity.ts`
  and `tests/app-identity.test.ts`. On niri, Hyprland, Sway, and other desktops Electron doesn't
  recognize, it chooses the Secret Service for saved passwords instead of a plain-text store
  that inlark refuses.
- `fix: allow copy buttons to write to the clipboard` (branch `fix/clipboard-write`). It
  changes the permission handlers in `apps/desktop/src/main/index.ts`. The app session denied every permission, so `navigator.clipboard.writeText` failed and
  no copy button worked. It allows clipboard writes for inlark's own page only.

## Syncing with upstream

```sh
git fetch upstream
git rebase upstream/main
```

On conflicts in `pnpm-lock.yaml`, take upstream's version and regenerate it. During a rebase
`--ours` is upstream and `--theirs` is the fork commit being replayed:

```sh
git checkout --ours pnpm-lock.yaml
pnpm install
git add pnpm-lock.yaml
```

Refresh the Nix hash whenever the lockfile changed: set `hash = "";` in `nix/package.nix`, run
`nix build .#inlark.pnpmDeps`, and copy the `got:` hash into the file. Then check that
everything still works:

```sh
pnpm install
pnpm check
nix build .#inlark
```
