import { describe, it, expect } from 'vitest'
import { BAND, THEME } from '../tokens.js'

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

  it('exposes semantic activity-band colors used by the timeline', () => {
    expect(BAND.recording).toBe('#f87171')
  })

  it('motion and audio are THEME tokens now, in both modes — not raw hex in BAND', () => {
    expect(THEME.dark.laneMotion).toMatch(/^#[0-9a-f]{6}$/)
    expect(THEME.light.laneMotion).toMatch(/^#[0-9a-f]{6}$/)
    expect(THEME.dark.laneAudio).toMatch(/^#[0-9a-f]{6}$/)
    expect(THEME.light.laneAudio).toMatch(/^#[0-9a-f]{6}$/)
    expect('motion' in BAND).toBe(false)
    expect('audio' in BAND).toBe(false)
  })
})
