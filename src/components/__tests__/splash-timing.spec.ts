import { describe, expect, it } from 'vitest'
import { INTRO_MS, MAX_HOLD_MS, fadeDelayMs } from '../splash/splash-timing.js'

describe('splash fade timing', () => {
  it('finishes the pass when the app is ready early', () => {
    expect(fadeDelayMs({ ready: true, reduceMotion: false, elapsedMs: 300 })).toBe(INTRO_MS - 300)
  })
  it('fades at once when the app is ready after the pass', () => {
    expect(fadeDelayMs({ ready: true, reduceMotion: false, elapsedMs: INTRO_MS + 500 })).toBe(0)
  })
  it('never plays the pass under reduce-motion: fades as soon as ready', () => {
    expect(fadeDelayMs({ ready: true, reduceMotion: true, elapsedMs: 10 })).toBe(0)
  })
  it('waits for readiness, bounded by the hard cap', () => {
    expect(fadeDelayMs({ ready: false, reduceMotion: false, elapsedMs: 1000 })).toBe(MAX_HOLD_MS - 1000)
    expect(fadeDelayMs({ ready: false, reduceMotion: false, elapsedMs: MAX_HOLD_MS + 1 })).toBe(0)
  })
  it('waits for the OS motion answer, bounded by the cap', () => {
    expect(fadeDelayMs({ ready: true, reduceMotion: null, elapsedMs: 100 })).toBe(MAX_HOLD_MS - 100)
  })
})
