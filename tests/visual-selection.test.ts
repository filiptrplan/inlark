import { describe, expect, it } from 'vitest'
import { visualSelection } from '../apps/desktop/src/renderer/src/visual-selection'

const keys = ['a', 'b', 'c', 'd', 'e']

describe('visualSelection', () => {
  it('selects only the anchor before the cursor moves', () => {
    expect([...visualSelection(keys, new Set(), 'c', 'c')]).toEqual(['c'])
  })

  it('extends forward and backward from the anchor', () => {
    expect([...visualSelection(keys, new Set(), 'b', 'd')].sort()).toEqual(['b', 'c', 'd'])
    expect([...visualSelection(keys, new Set(), 'd', 'b')].sort()).toEqual(['b', 'c', 'd'])
  })

  it('shrinks when the cursor moves back toward the anchor', () => {
    expect([...visualSelection(keys, new Set(), 'b', 'c')].sort()).toEqual(['b', 'c'])
  })

  it('keeps the base selection', () => {
    expect([...visualSelection(keys, new Set(['a']), 'c', 'd')].sort()).toEqual(['a', 'c', 'd'])
  })

  it('returns the base when the anchor or cursor is missing', () => {
    expect([...visualSelection(keys, new Set(['a']), 'x', 'c')]).toEqual(['a'])
    expect([...visualSelection(keys, new Set(['a']), 'c', 'x')]).toEqual(['a'])
  })
})
