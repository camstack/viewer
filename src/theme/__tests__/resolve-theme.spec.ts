import { describe, it, expect } from 'vitest'
import { resolveMode, resolveColors } from '../resolve-theme.js'
import { THEME } from '../tokens.js'

describe('resolveMode', () => {
  it("follows the OS scheme when preference is 'system'", () => {
    expect(resolveMode('system', 'light')).toBe('light')
    expect(resolveMode('system', 'dark')).toBe('dark')
  })
  it("defaults 'system' to dark when the OS scheme is unknown", () => {
    expect(resolveMode('system', null)).toBe('dark')
  })
  it('honors an explicit preference over the OS scheme', () => {
    expect(resolveMode('dark', 'light')).toBe('dark')
    expect(resolveMode('light', 'dark')).toBe('light')
  })
})

describe('resolveColors', () => {
  it('returns the token set for the resolved mode', () => {
    expect(resolveColors('light', null)).toBe(THEME.light)
    expect(resolveColors('system', 'dark')).toBe(THEME.dark)
  })
})
