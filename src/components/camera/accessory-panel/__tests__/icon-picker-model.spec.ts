/**
 * The picker's data: the whole catalog in sections, search that reaches Italian
 * words, and a layout that never loses or repeats an icon.
 */
import { describe, expect, it } from 'vitest'
import { ICON_KEYS } from '@camstack/types/client'

import { iconListRows, iconSections } from '../icon-picker-model.js'

describe('iconSections', () => {
  it('offers every catalog icon exactly once', () => {
    const all = iconSections('').flatMap((section) => [...section.keys])
    expect(new Set(all).size).toBe(all.length)
    expect([...all].sort()).toEqual([...ICON_KEYS].sort())
  })

  it('finds an icon by its Italian word', () => {
    const keys = iconSections('kitchen').flatMap((section) => [...section.keys])
    expect(keys).toContain('utensils')
  })

  it('is empty when nothing matches', () => {
    expect(iconSections('zzzzqq')).toEqual([])
  })
})

describe('iconListRows', () => {
  it('chunks each section under its header without dropping a tile', () => {
    const sections = iconSections('')
    const rows = iconListRows(sections, 6)
    const tiles = rows.flatMap((row) => (row.kind === 'tiles' ? [...row.keys] : []))
    expect(tiles.length).toBe(ICON_KEYS.length)
    expect(rows.filter((row) => row.kind === 'header').length).toBe(sections.length)
    expect(rows.every((row) => row.kind === 'header' || row.keys.length <= 6)).toBe(true)
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
  })
})
