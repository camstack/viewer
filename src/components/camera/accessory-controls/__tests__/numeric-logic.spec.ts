import { describe, it, expect } from 'vitest'
import { clampRange, stepValue, nextInList } from '../numeric-logic.js'

describe('clampRange', () => {
  it('clamps into the inclusive range', () => {
    expect(clampRange(-5, 0, 100)).toBe(0)
    expect(clampRange(150, 0, 100)).toBe(100)
    expect(clampRange(42, 0, 100)).toBe(42)
  })
})

describe('stepValue', () => {
  it('nudges by the step and clamps to [min,max]', () => {
    expect(stepValue(50, 1, 5, 0, 100)).toBe(55)
    expect(stepValue(50, -1, 5, 0, 100)).toBe(45)
    expect(stepValue(100, 1, 5, 0, 100)).toBe(100)
    expect(stepValue(0, -1, 5, 0, 100)).toBe(0)
  })
  it('treats null current as min and defaults a non-positive step to 1', () => {
    expect(stepValue(null, 1, 5, 10, 30)).toBe(15)
    expect(stepValue(20, 1, 0, 0, 100)).toBe(21)
  })
  it('trims floating dust', () => {
    expect(stepValue(21, 1, 0.5, 5, 35)).toBe(21.5)
    expect(stepValue(21.1, 1, 0.2, 5, 35)).toBe(21.3)
  })
})

describe('nextInList', () => {
  const list = ['low', 'medium', 'high'] as const
  it('advances and wraps', () => {
    expect(nextInList('low', list)).toBe('medium')
    expect(nextInList('high', list)).toBe('low')
  })
  it('returns the first entry when current is absent', () => {
    expect(nextInList('turbo', list)).toBe('low')
  })
  it('is a no-op for an empty list', () => {
    expect(nextInList('x', [])).toBe('x')
  })
})
