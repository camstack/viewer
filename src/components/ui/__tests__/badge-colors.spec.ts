import { describe, it, expect } from 'vitest'
import { THEME } from '../../../theme/tokens.js'
import { badgeColors, type BadgeTone } from '../badge-colors.js'

const TONES: readonly BadgeTone[] = ['success', 'warning', 'danger', 'info', 'primary', 'neutral']

function channel(hex: string, at: number): number {
  const v = parseInt(hex.slice(at, at + 2), 16) / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
function lum(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

describe('badgeColors', () => {
  for (const mode of ['dark', 'light'] as const) {
    for (const tone of TONES) {
      it(`${mode} ${tone}: fill text passes AA on its fill`, () => {
        const c = badgeColors(THEME[mode], tone, 'fill')
        expect(contrast(c.background, c.text)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  it('outline is transparent with a status-coloured border and text', () => {
    const c = badgeColors(THEME.dark, 'danger', 'outline')
    expect(c.background).toBe('transparent')
    expect(c.border).toBe(THEME.dark.danger)
    expect(c.text).toBe(THEME.dark.danger)
  })

  it('tint keeps the soft wash', () => {
    const c = badgeColors(THEME.light, 'success', 'tint')
    expect(c.background).toBe(`${THEME.light.success}22`)
  })
})
