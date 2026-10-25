/**
 * The reel's highlight defaults and its subscription demand (D483 phase two).
 */
import { describe, it, expect } from 'vitest'
import {
  REEL_AUDIO_DEFAULT_UI,
  REEL_HIGHLIGHT_DEFAULTS,
  reelHighlightDemand,
} from '../reel-highlight.js'
import { GRID_HIGHLIGHT_DEFAULTS } from '../grid-store.js'
import {
  AUDIO_LEVEL_THRESHOLDS_DBFS,
  dbfsForAudioUi,
} from '../../components/camera/audio-level.js'

describe('the reel starts with motion AND audio on', () => {
  it('motion is on', () => {
    expect(REEL_HIGHLIGHT_DEFAULTS.motion).toBe(true)
  })

  /**
   * "Audio on" is a MODE plus a threshold, not a boolean. `'level'` is what
   * makes the dBFS comparison happen at all — `'sensor'` would light on any
   * audio DETECTION regardless of loudness, which is a different feature.
   */
  it('audio is on as a LEVEL, with the rung the default names', () => {
    expect(REEL_HIGHLIGHT_DEFAULTS.audio).toBe('level')
    expect(REEL_HIGHLIGHT_DEFAULTS.audioDb).toBe(dbfsForAudioUi(REEL_AUDIO_DEFAULT_UI))
  })

  /**
   * The rung, pinned by VALUE with the calibration it was chosen against.
   *
   * `audio-level.ts`: quiet indoor audio is ≈ -55…-42 dBFS, conversation
   * ≈ -42…-25. The default must sit ABOVE the quiet band or a reel of N cards
   * lights on room tone — see `REEL_AUDIO_DEFAULT_UI` for the full argument.
   * If the operator moves this, this assertion is where the reasoning is.
   */
  it('sits above the quiet band, so room tone does not light the reel', () => {
    expect(REEL_HIGHLIGHT_DEFAULTS.audioDb).toBe(-39)
    expect(REEL_HIGHLIGHT_DEFAULTS.audioDb).toBeGreaterThan(-42)
    // And is not the deafest rung, which would barely ever fire.
    expect(REEL_HIGHLIGHT_DEFAULTS.audioDb).toBeLessThan(
      AUDIO_LEVEL_THRESHOLDS_DBFS[AUDIO_LEVEL_THRESHOLDS_DBFS.length - 1]!,
    )
  })

  it('detection stays off — the operator named motion and audio', () => {
    expect(REEL_HIGHLIGHT_DEFAULTS.detection).toBe(false)
  })

  /**
   * The GRID's default is commented "motion-only, like a sane starting point".
   * Changing it would re-default every persisted grid, so the reel overrides
   * rather than edits.
   */
  it('leaves the shared grid default alone', () => {
    expect(GRID_HIGHLIGHT_DEFAULTS.audio).toBe('off')
    expect(GRID_HIGHLIGHT_DEFAULTS.motion).toBe(true)
  })

  /** Spread, not restated: a field added to the shared shape reaches the reel. */
  it('carries every field the shared shape has', () => {
    expect(Object.keys(REEL_HIGHLIGHT_DEFAULTS).sort()).toEqual(
      Object.keys(GRID_HIGHLIGHT_DEFAULTS).sort(),
    )
  })
})

describe('what a card actually needs to subscribe to', () => {
  it('asks for motion and audio by default, and not detection', () => {
    expect(reelHighlightDemand(REEL_HIGHLIGHT_DEFAULTS)).toEqual({
      motion: true,
      audio: true,
      detection: false,
      idle: false,
    })
  })

  /**
   * `audio` is a mode, so `'off'` is a NON-EMPTY STRING: a truthiness test
   * would read it as "audio wanted" and open a subscription per card for a
   * trigger the operator switched off.
   */
  it("reads audio 'off' as off, not as a truthy string", () => {
    const d = reelHighlightDemand({ ...REEL_HIGHLIGHT_DEFAULTS, audio: 'off' })
    expect(d.audio).toBe(false)
  })

  it("treats 'sensor' as audio wanted too", () => {
    expect(reelHighlightDemand({ ...REEL_HIGHLIGHT_DEFAULTS, audio: 'sensor' }).audio).toBe(true)
  })

  /** Everything off ⇒ no card opens anything. The reel is N cards, so this is
   *  the difference between one idle surface and N live subscriptions. */
  it('is idle only when every trigger is off', () => {
    expect(
      reelHighlightDemand({
        ...REEL_HIGHLIGHT_DEFAULTS,
        motion: false,
        audio: 'off',
        detection: false,
      }).idle,
    ).toBe(true)
    expect(reelHighlightDemand(REEL_HIGHLIGHT_DEFAULTS).idle).toBe(false)
    expect(
      reelHighlightDemand({ ...REEL_HIGHLIGHT_DEFAULTS, motion: false, audio: 'off', detection: true })
        .idle,
    ).toBe(false)
  })
})
