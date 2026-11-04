// Fork-only: the bridge for moving a server-saved draft to another account.
import type { DraftsBridge } from '../../preload/drafts'

declare global {
  interface Window {
    inlarkDrafts?: DraftsBridge
  }
}

/** Missing in the demo and web builds, where a saved draft keeps its account. */
export const draftsBridge = (): DraftsBridge | undefined => window.inlarkDrafts
