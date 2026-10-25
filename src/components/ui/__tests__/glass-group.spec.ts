import { describe, expect, it } from 'vitest'

import { GLASS_GROUP_SPACING, resolveGroupMode } from '../GlassSurface.js'

const base = { os: 'ios', reduceTransparency: false, nativeGlass: true }

describe('resolveGroupMode — when glass shapes are grouped natively', () => {
  it('groups only on iOS native glass with the container loaded', () => {
    expect(resolveGroupMode(base, true)).toBe('native')
  })

  it('is the plain view everywhere else', () => {
    expect(resolveGroupMode(base, false)).toBe('plain')
    expect(resolveGroupMode({ ...base, nativeGlass: false }, true)).toBe('plain')
    expect(resolveGroupMode({ ...base, os: 'android', nativeGlass: false }, true)).toBe('plain')
    expect(resolveGroupMode({ ...base, os: 'web', nativeGlass: false }, true)).toBe('plain')
  })

  it('Reduce Transparency always wins', () => {
    expect(resolveGroupMode({ ...base, reduceTransparency: true }, true)).toBe('plain')
  })

  it('merges at a pinned distance', () => {
    expect(GLASS_GROUP_SPACING).toBe(12)
  })
})
