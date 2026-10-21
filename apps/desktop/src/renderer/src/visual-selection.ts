import { useEffect, useMemo, useRef, useState } from 'react'

/** The selection while in visual mode: the base selection plus every row from anchor to cursor. */
export function visualSelection(
  keys: string[],
  base: ReadonlySet<string>,
  anchor: string,
  cursor: string,
): Set<string> {
  const next = new Set(base)
  const start = keys.indexOf(anchor)
  const end = keys.indexOf(cursor)
  if (start < 0 || end < 0) return next
  for (const key of keys.slice(Math.min(start, end), Math.max(start, end) + 1)) next.add(key)
  return next
}

const same = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((key) => b.has(key))

/**
 * Vim-style visual line mode: the focused row becomes an anchor and moving the cursor extends the
 * selection. Any selection change made elsewhere (Space, a checkbox, Escape, a bulk action) ends
 * the mode and keeps whatever it produced.
 */
export function useVisualSelection({
  conversations,
  focused,
  selected,
  setSelected,
  active,
}: {
  conversations: readonly { key: string }[]
  focused: string
  selected: ReadonlySet<string>
  setSelected: (selected: Set<string>) => void
  active: boolean
}) {
  const [mode, setMode] = useState<{ anchor: string; base: ReadonlySet<string> }>()
  const applied = useRef<ReadonlySet<string>>(selected)
  const keys = useMemo(() => conversations.map((c) => c.key), [conversations])

  useEffect(() => {
    if (!mode) return
    // A selection we did not write ends the mode; so does losing the list or the anchor row.
    if (!active || selected !== applied.current || !keys.includes(mode.anchor)) {
      setMode(undefined)
      return
    }
    const next = visualSelection(keys, mode.base, mode.anchor, focused)
    if (same(next, selected)) return
    applied.current = next
    setSelected(next)
  }, [mode, active, keys, focused, selected, setSelected])

  const toggleVisual = () => {
    if (mode) return setMode(undefined)
    if (!focused || !keys.includes(focused)) return
    const next = visualSelection(keys, selected, focused, focused)
    applied.current = next
    setSelected(next)
    setMode({ anchor: focused, base: selected })
  }

  return { visual: !!mode, toggleVisual }
}
