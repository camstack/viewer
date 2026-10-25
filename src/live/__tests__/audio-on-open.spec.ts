/**
 * audio-on-open — the tri-state resolution and the migration off the boolean.
 *
 * Two things are load-bearing and neither is visible from the UI:
 *
 *   1. `last-selected` must distinguish "left it silent" from "never chosen",
 *      even though both currently open muted. Collapsing them would make a
 *      later change to the fallback rewrite an answer the operator gave.
 *   2. The migration must not move anybody. A boolean `true` was the shipped
 *      default from 2026-09-13, so nearly every existing document carries one,
 *      and folding it onto the new default would silence a fleet of users who
 *      had asked for sound.
 */
import { describe, expect, it } from 'vitest'
import {
  AUDIO_ON_OPEN_DEFAULT,
  AUDIO_ON_OPEN_MODES,
  isAudioOnOpenMode,
  opensMuted,
  parseAudioOnOpen,
  type AudioOnOpenMode,
} from '../audio-on-open.js'

describe('the offer', () => {
  it('is exactly the three modes, and the default is one of them', () => {
    expect([...AUDIO_ON_OPEN_MODES].sort()).toEqual(['last-selected', 'off', 'on'])
    expect(AUDIO_ON_OPEN_MODES).toContain(AUDIO_ON_OPEN_DEFAULT)
  })

  it('defaults to last-selected — the operator’s ask', () => {
    expect(AUDIO_ON_OPEN_DEFAULT).toBe<AudioOnOpenMode>('last-selected')
  })

  it('narrows a persisted value to a mode this build still offers', () => {
    expect(isAudioOnOpenMode('on')).toBe(true)
    expect(isAudioOnOpenMode('last-selected')).toBe(true)
    // A mode a later build might offer is not one of ours.
    expect(isAudioOnOpenMode('follow-system')).toBe(false)
    expect(isAudioOnOpenMode(true)).toBe(false)
    expect(isAudioOnOpenMode(undefined)).toBe(false)
  })
})

describe('opensMuted', () => {
  it('`on` always speaks, whatever the camera remembers', () => {
    expect(opensMuted('on', undefined)).toBe(false)
    expect(opensMuted('on', true)).toBe(false)
    // Even a camera the operator deliberately silenced: `on` is an absolute.
    expect(opensMuted('on', false)).toBe(false)
  })

  it('`off` always stays silent, whatever the camera remembers', () => {
    expect(opensMuted('off', undefined)).toBe(true)
    expect(opensMuted('off', false)).toBe(true)
    expect(opensMuted('off', true)).toBe(true)
  })

  it('`last-selected` with history reproduces the last choice', () => {
    expect(opensMuted('last-selected', true)).toBe(false)
    expect(opensMuted('last-selected', false)).toBe(true)
  })

  it('`last-selected` with NO history opens silent', () => {
    // The documented fallback: unexpected sound is worse than unexpected
    // silence, and the first open is exactly when nobody knows what the camera
    // is about to do.
    expect(opensMuted('last-selected', undefined)).toBe(true)
  })

  it('"left it silent" and "never chosen" are separate inputs, not one', () => {
    // Same outcome today, different arguments — the function must keep being
    // able to tell them apart.
    expect(opensMuted('last-selected', false)).toBe(opensMuted('last-selected', undefined))
    expect(false).not.toBe(undefined)
  })
})

describe('migration off the boolean', () => {
  it('keeps an operator who asked for sound', () => {
    expect(parseAudioOnOpen(true)).toBe<AudioOnOpenMode>('on')
  })

  it('keeps an operator who asked for silence', () => {
    expect(parseAudioOnOpen(false)).toBe<AudioOnOpenMode>('off')
  })

  it('neither legacy value lands on the new default', () => {
    // The failure this guards: folding `true` onto `last-selected` would go
    // quiet on everyone who had audio on, and folding `false` onto it would be
    // the unacceptable direction — sound nobody asked for.
    expect(parseAudioOnOpen(true)).not.toBe(AUDIO_ON_OPEN_DEFAULT)
    expect(parseAudioOnOpen(false)).not.toBe(AUDIO_ON_OPEN_DEFAULT)
  })

  it('a document that already carries a mode is read verbatim', () => {
    for (const mode of AUDIO_ON_OPEN_MODES) expect(parseAudioOnOpen(mode)).toBe(mode)
  })

  it('absent or junk reads as the default, never as a throw', () => {
    expect(parseAudioOnOpen(undefined)).toBe(AUDIO_ON_OPEN_DEFAULT)
    expect(parseAudioOnOpen(null)).toBe(AUDIO_ON_OPEN_DEFAULT)
    expect(parseAudioOnOpen('yes')).toBe(AUDIO_ON_OPEN_DEFAULT)
    expect(parseAudioOnOpen(1)).toBe(AUDIO_ON_OPEN_DEFAULT)
    expect(parseAudioOnOpen({})).toBe(AUDIO_ON_OPEN_DEFAULT)
  })

  it('an unmigrated document opens EXACTLY as it did before the mode existed', () => {
    // The whole promise of the migration, spelled end to end: the old boolean
    // decided the mute directly, and the pair (parse → resolve) must land on
    // the same answer for both values and for any camera history.
    for (const legacy of [true, false]) {
      for (const history of [undefined, true, false]) {
        expect(opensMuted(parseAudioOnOpen(legacy), history)).toBe(!legacy)
      }
    }
  })
})
