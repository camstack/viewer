import { describe, it, expect } from 'vitest'
import {
  idleScrubFirstFrame,
  markScrubStart,
  noteScrubDrawn,
} from '../scrub-first-frame.js'

describe('scrub first-frame measurement', () => {
  it('reports finger-down → painted, once per drag', () => {
    const started = markScrubStart(1_000)
    const first = noteScrubDrawn(started, 1_420)
    expect(first.firstFrameMs).toBe(420)

    // Every later paint of the SAME drag is a frame, not a first frame.
    const second = noteScrubDrawn(first.state, 1_600)
    expect(second.firstFrameMs).toBeNull()
  })

  it('reports nothing for a paint with no drag in progress', () => {
    // A seek's landing burst also paints. Measuring it from a stale start
    // would put a number on a gesture that never happened.
    expect(noteScrubDrawn(idleScrubFirstFrame, 5_000).firstFrameMs).toBeNull()
  })

  it('a new drag restarts the measurement even if the previous one never painted', () => {
    const abandoned = markScrubStart(1_000)
    const restarted = markScrubStart(9_000)
    expect(abandoned.startedAtMs).toBe(1_000)
    expect(noteScrubDrawn(restarted, 9_100).firstFrameMs).toBe(100)
  })

  it('never reports a negative duration', () => {
    const started = markScrubStart(2_000)
    expect(noteScrubDrawn(started, 1_900).firstFrameMs).toBe(0)
  })
})
