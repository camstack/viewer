import { describe, it, expect } from 'vitest'
import { generateDragId } from '../scrub-drag-id.js'

describe('generateDragId', () => {
  it('produces a non-empty string', () => {
    expect(typeof generateDragId()).toBe('string')
    expect(generateDragId().length).toBeGreaterThan(0)
  })

  it('two consecutive gestures get DIFFERENT ids', () => {
    const a = generateDragId()
    const b = generateDragId()
    expect(a).not.toBe(b)
  })
})
