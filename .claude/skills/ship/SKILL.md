---
name: ship
description: Commit the current changes, push to origin, and bump the inlark input in the user's nix flake (~/nix). Use when the user says "ship it", "commit, push and update nix", or asks to roll a change out to their NixOS/home-manager setup.
---

# Ship inlark

Commits, pushes, and bumps the `inlark` flake input in `~/nix` so the change reaches the user's machines on the next rebuild.

## Steps

1. **Commit.** Follow the `commit` skill: review `git diff`, split unrelated work, use Conventional Commits (`fix:`, `feat:`, `docs:`). End the message with the attribution line from the session's system reminder.
2. **Push.** `git push` on the current branch. The nix input tracks `github:filiptrplan/inlark` (default branch), so only a push to `main` is picked up. If on another branch, say so and stop before step 3.
3. **Bump nix.** From `~/nix` run `nix flake update inlark`. It must run after the push, since the lock pins the pushed commit hash. Confirm the output shows the new commit.
4. **Report.** State the old and new commit, that `~/nix/flake.lock` is modified, and that nothing was committed there or rebuilt.

## Boundaries

- Never commit or push in `~/nix`, and never run `home-manager switch` or `nixos-rebuild`. The user does those. Mention that a rebuild is needed.
- Update only the `inlark` input, never a bare `nix flake update`.
- If the push is rejected or the tree has unrelated uncommitted changes, stop and ask.
