import { describe, expect, it } from 'vitest'
import { isHonestEventMediaMiss } from '../event-media-fallback.js'

describe('isHonestEventMediaMiss', () => {
  it('treats HTTP 404 as a real absence — no getEventMedia', () => {
    expect(isHonestEventMediaMiss(404)).toBe(true)
  })

  it('does not swallow a transport or server error', () => {
    expect(isHonestEventMediaMiss(500)).toBe(false)
    expect(isHonestEventMediaMiss(0)).toBe(false)
  })
})
