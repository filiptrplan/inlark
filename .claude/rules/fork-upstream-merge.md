# Fork policy: stay mergeable with upstream

This repository is a fork of `inlark/inlark` (remote `upstream`). Upstream keeps shipping changes, and we want to merge them with as little conflict as possible. Every change made in this fork must be designed with that in mind.

## Rules

- **Prefer new files over edits to existing ones.** Put fork-specific features in their own modules, components, and directories instead of growing upstream files.
- **Keep edits to upstream files minimal.** When a hook into existing code is unavoidable, make it a small, localized change (a registration line, an import, a single call site) that delegates to the fork's own module. Do not reformat, reorder, rename, or move upstream code, and avoid drive-by cleanups in files the fork does not own.
- **Use extension points where they exist.** Register new commands, routes, settings panes, and similar through the existing registries or plugin points. If one is missing, add the smallest possible seam and put the logic behind it.
- **Isolate fork-specific state.** Keep fork-only config, schema additions, and migrations separate from upstream's, and make them additive. Never edit an existing upstream migration.
- **Keep fork-only tests and docs in their own files.** Do not interleave them with upstream's.
- **Do not touch shared, high-churn files** (lockfiles, generated files, top-level config, this project's `CLAUDE.md`) unless the change requires it. Put fork-specific agent instructions in `.claude/rules/` rather than editing `CLAUDE.md`.
- **One concern per commit,** so a conflicting change can be dropped or reworked without disturbing the rest.

## Before finishing a change

- Check `git diff --stat upstream/main...HEAD` (after `git fetch upstream`) and confirm that edits to files upstream also changes are small and intentional.
- If a feature cannot be made modular without a large edit to upstream code, say so and propose the smallest seam before implementing it.
