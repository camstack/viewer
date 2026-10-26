import { describe, it, expect } from 'vitest'
import { THEME } from '../tokens.js'

describe('camstack theme tokens', () => {
  it('exposes dark and light modes with the camstack Warm Amber/Stone palette', () => {
    expect(THEME.dark.background).toBe('#0c0a09')
    expect(THEME.dark.primary).toBe('#f59e42')
    expect(THEME.light.background).toBe('#fafaf9')
    expect(THEME.light.primary).toBe('#e67e22')
  })

  it('defines the same token keys in both modes (parity)', () => {
    const darkKeys = Object.keys(THEME.dark).sort()
    const lightKeys = Object.keys(THEME.light).sort()
    expect(lightKeys).toEqual(darkKeys)
  })

  it('keeps the live-edge accent as a theme token, and kind lanes on the hub palette', () => {
    expect(THEME.dark.live).toMatch(/^#[0-9a-f]{6}$/)
    expect(THEME.light.live).toMatch(/^#[0-9a-f]{6}$/)
    expect('laneMotion' in THEME.dark).toBe(false)
    expect('laneAudio' in THEME.dark).toBe(false)
    expect('laneMotion' in THEME.light).toBe(false)
    expect('laneAudio' in THEME.light).toBe(false)
  })
})
