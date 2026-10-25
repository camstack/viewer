/**
 * The viewer's half of the per-track operator flags.
 *
 * Two things are worth a test here and the rest is React. First, that
 * `toTrackSummary` keeps an untouched flag ABSENT — the moment it defaults to
 * `false`, "never marked" and "deliberately unmarked" collapse and the toggle
 * can no longer tell them apart. Second, that `toTrackFlagsResult` refuses a
 * partial answer: a response missing one boolean would drive that toggle to
 * `false` on screen, silently un-marking a flag the operator never touched.
 */
import { describe, it, expect } from 'vitest'
import { toTrackSummary, trackHasOperatorFlag, trackMatchesFlagFilters, visibleFlagFilters } from '../track-events.js'
import { pendingFlagKey, toTrackFlagsResult } from '../use-track-flags.js'

function row(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    trackId: 't1',
    deviceId: 101,
    className: 'person',
    firstSeen: 1000,
    lastSeen: 2000,
    ...extra,
  }
}

describe('toTrackSummary — operator flags', () => {
  it('carries markForTrain, debug and favourited through', () => {
    const track = toTrackSummary(row({ markForTrain: true, debug: false, favourited: true }), 'Front door')

    expect(track?.markForTrain).toBe(true)
    expect(track?.debug).toBe(false)
    expect(track?.favourited).toBe(true)
  })

  it('carries the debug note, and leaves it absent when the hub sends none', () => {
    expect(toTrackSummary(row({ debug: true, debugNote: 'check the crop' }), 'Front door')?.debugNote).toBe(
      'check the crop',
    )
    expect(toTrackSummary(row({ debug: true }), 'Front door')?.debugNote).toBeUndefined()
    expect(toTrackSummary(row({ debugNote: 7 }), 'Front door')?.debugNote).toBeUndefined()
  })

  it('leaves an untouched track ABSENT rather than defaulting it to false', () => {
    const track = toTrackSummary(row({}), 'Front door')

    expect(track).not.toBeNull()
    expect(track?.markForTrain).toBeUndefined()
    expect(track?.debug).toBeUndefined()
    expect(track?.favourited).toBeUndefined()
  })

  it('ignores a non-boolean flag from an older or malformed hub', () => {
    const track = toTrackSummary(row({ markForTrain: 'yes' }), 'Front door')

    expect(track?.markForTrain).toBeUndefined()
  })
})

describe('toTrackFlagsResult', () => {
  it('accepts the full resolved triple including favourited', () => {
    expect(
      toTrackFlagsResult({
        trackId: 't1',
        markForTrain: true,
        debug: false,
        debugNote: '',
        favourited: true,
      }),
    ).toEqual({
      trackId: 't1',
      markForTrain: true,
      debug: false,
      debugNote: '',
      favourited: true,
    })
  })

  it('carries the debug note through', () => {
    const out = toTrackFlagsResult({
      trackId: 't1',
      markForTrain: false,
      debug: true,
      debugNote: 'the box jumps to the fence',
      favourited: false,
    })

    expect(out?.debugNote).toBe('the box jumps to the fence')
  })

  it('accepts an answer with NO note — the field is additive, an older hub omits it', () => {
    // The one asymmetry with the booleans above, and it is deliberate: rejecting
    // the whole answer over a missing note would break all three toggles against
    // every hub that has not been updated yet. A missing note is not a partial
    // answer about a flag — it is a hub that cannot store one.
    const out = toTrackFlagsResult({
      trackId: 't1',
      markForTrain: false,
      debug: true,
      favourited: false,
    })

    expect(out).not.toBeNull()
    expect(out?.debugNote).toBe('')
  })

  it('ignores a non-string note rather than refusing the answer', () => {
    const out = toTrackFlagsResult({
      trackId: 't1',
      markForTrain: false,
      debug: true,
      debugNote: 42,
      favourited: false,
    })

    expect(out?.debugNote).toBe('')
  })

  it('refuses an answer missing a flag — a partial must not drive a toggle', () => {
    expect(toTrackFlagsResult({ trackId: 't1', markForTrain: true })).toBeNull()
    expect(toTrackFlagsResult({ trackId: 't1', markForTrain: true, debug: false })).toBeNull()
  })

  it('refuses a non-boolean flag', () => {
    expect(toTrackFlagsResult({ trackId: 't1', markForTrain: 1, debug: 0, favourited: 1 })).toBeNull()
  })

  it('refuses a missing or empty trackId', () => {
    expect(toTrackFlagsResult({ markForTrain: true, debug: true, favourited: true })).toBeNull()
    expect(
      toTrackFlagsResult({ trackId: '', markForTrain: true, debug: true, favourited: true }),
    ).toBeNull()
  })

  it('refuses a non-object', () => {
    expect(toTrackFlagsResult(null)).toBeNull()
    expect(toTrackFlagsResult('ok')).toBeNull()
  })
})

describe('trackHasOperatorFlag', () => {
  it('is true when any of the three flags is ON', () => {
    expect(trackHasOperatorFlag({ favourited: true })).toBe(true)
    expect(trackHasOperatorFlag({ debug: true })).toBe(true)
    expect(trackHasOperatorFlag({ markForTrain: true })).toBe(true)
  })

  it('is false when every flag is absent or explicitly off', () => {
    expect(trackHasOperatorFlag({})).toBe(false)
    expect(trackHasOperatorFlag({ favourited: false, debug: false, markForTrain: false })).toBe(
      false,
    )
  })
})

describe('trackMatchesFlagFilters — three independent chips, OR', () => {
  it('passes every track when no chip is on', () => {
    expect(trackMatchesFlagFilters({ debug: true }, { debug: false, markForTrain: false, favourited: false })).toBe(
      true,
    )
    expect(trackMatchesFlagFilters({}, { debug: false, markForTrain: false, favourited: false })).toBe(true)
  })

  it('keeps only the selected flag when one chip is on', () => {
    const fav = { debug: false, markForTrain: false, favourited: true }
    expect(trackMatchesFlagFilters({ favourited: true }, fav)).toBe(true)
    expect(trackMatchesFlagFilters({ debug: true }, fav)).toBe(false)
    expect(trackMatchesFlagFilters({ markForTrain: true }, fav)).toBe(false)
  })

  it('unions the selected flags when several chips are on', () => {
    const debugAndFav = { debug: true, markForTrain: false, favourited: true }
    expect(trackMatchesFlagFilters({ debug: true }, debugAndFav)).toBe(true)
    expect(trackMatchesFlagFilters({ favourited: true }, debugAndFav)).toBe(true)
    expect(trackMatchesFlagFilters({ markForTrain: true }, debugAndFav)).toBe(false)
  })
})

describe('visibleFlagFilters — gated on the permission of each flag', () => {
  it('offers favourite to everyone, debug and train only to admin', () => {
    expect(visibleFlagFilters(false)).toEqual(['favourited'])
    expect(visibleFlagFilters(true)).toEqual(['debug', 'markForTrain', 'favourited'])
  })
})

describe('pendingFlagKey — which button wears the spinner', () => {
  // The one-key-per-patch rule (rule 1 above) means a patch NAMES the pressed
  // button; the operator report behind this ("no loader when I activate a
  // flag") is a header where all three icons dimmed identically instead.
  it('names the single flag an in-flight patch writes', () => {
    expect(pendingFlagKey({ markForTrain: true })).toBe('markForTrain')
    expect(pendingFlagKey({ markForTrain: false })).toBe('markForTrain')
    expect(pendingFlagKey({ debug: true })).toBe('debug')
    expect(pendingFlagKey({ favourited: false })).toBe('favourited')
  })

  it('names the NOTE when the patch is a note edit — the debug button owns that spinner too', () => {
    expect(pendingFlagKey({ debugNote: 'check the crop' })).toBe('debugNote')
    expect(pendingFlagKey({ debugNote: '' })).toBe('debugNote')
  })

  it('returns null for the (never sent) empty patch', () => {
    expect(pendingFlagKey({})).toBeNull()
  })
})
