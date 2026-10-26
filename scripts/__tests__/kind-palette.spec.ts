import { describe, expect, it } from 'vitest'
import { kindPaletteViolations, scanKindPalette } from '../check-kind-palette.mjs'

describe('kind palette guard', () => {
  it('flags a kind key painted with a hex, and the old table names', () => {
    const hits = kindPaletteViolations("export const CLASS_COLORS = { person: '#22c55e' }\n", 'a.ts')
    expect(hits.some((h) => h.includes('CLASS_COLORS'))).toBe(true)
    expect(hits.some((h) => h.includes('kind key'))).toBe(true)
  })

  it('leaves operator overrides and the theme live token', () => {
    expect(kindPaletteViolations("motionColor: '#DC2626'", 'settings.ts')).toEqual([])
    expect(kindPaletteViolations("live: '#22d3ee'", 'tokens.ts')).toEqual([])
  })

  it('finds no kind-colour table in the app, embed, or shared paint module', () => {
    expect(scanKindPalette()).toEqual([])
  })
})
