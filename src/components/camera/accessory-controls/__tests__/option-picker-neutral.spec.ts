import { describe, expect, it } from 'vitest'
import { isOptionActive } from '../control-atoms.js'

describe('OptionPicker neutralValue: only a real choice is accented', () => {
  it('the neutral value (AC "off") is not active', () => {
    expect(isOptionActive('off', 'off')).toBe(false)
  })
  it('a real mode is active', () => {
    expect(isOptionActive('cool', 'off')).toBe(true)
  })
  it('no selection is not active', () => {
    expect(isOptionActive(null, 'off')).toBe(false)
    expect(isOptionActive('', 'off')).toBe(false)
  })
  it('without a neutral value any selection is active', () => {
    expect(isOptionActive('off')).toBe(true)
  })
})
