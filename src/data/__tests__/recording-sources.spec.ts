/**
 * The recording source resolver.
 *
 * What is pinned here is the asymmetry that D625 was written about: absence
 * resolves to OURS without asking anything, and a pick that has not resolved
 * resolves to NOTHING rather than falling back to ours. A fallback in either
 * direction silently swaps one camera's coverage bar for another's.
 */
import { RecordingSourceSchema } from '@camstack/types'
import { describe, expect, it } from 'vitest'
import {
  RECORDING_SOURCE_CAMSTACK,
  RECORDING_SOURCE_CAMSTACK_ADDON,
  parseRecordingSources,
  resolveRecordingProvider,
  type RecordingSourceRow,
} from '../recording-sources.js'

const CARD: RecordingSourceRow = {
  sourceId: 'native:reolink:card',
  addonId: 'provider-reolink',
  label: 'SD card',
}
const OURS: RecordingSourceRow = {
  sourceId: RECORDING_SOURCE_CAMSTACK,
  addonId: RECORDING_SOURCE_CAMSTACK_ADDON,
}

describe('resolveRecordingProvider — absence MEANS ours', () => {
  it('resolves no pick to ours without consulting the list at all', () => {
    // The list is deliberately hostile: empty, and not even answered. Ours
    // must still resolve, because a timeline paints on mount and a default
    // that waited for `listSources` would be a blank bar on every launch.
    const choice = resolveRecordingProvider(undefined, [], false)
    expect(choice.sourceId).toBe(RECORDING_SOURCE_CAMSTACK)
    expect(choice.addonId).toBe(RECORDING_SOURCE_CAMSTACK_ADDON)
    expect(choice.derivation).toBe('default')
  })

  it('resolves the reserved id spelled out the same way as absence', () => {
    const spelled = resolveRecordingProvider(RECORDING_SOURCE_CAMSTACK, [], false)
    expect(spelled).toEqual(resolveRecordingProvider(undefined, [], false))
  })

  it('sends the addonId the cap asks for, never the source id', () => {
    // `provider` takes "the addonId a row carries, never a source id" — and
    // for ours those two are DIFFERENT strings, which is the whole reason a
    // single translation point exists.
    expect(RECORDING_SOURCE_CAMSTACK).not.toBe(RECORDING_SOURCE_CAMSTACK_ADDON)
    expect(resolveRecordingProvider(undefined, [], true).addonId).toBe(
      RECORDING_SOURCE_CAMSTACK_ADDON,
    )
  })
})

describe('resolveRecordingProvider — an unresolved pick is not ours', () => {
  it('holds at null while listSources has not answered', () => {
    const choice = resolveRecordingProvider('native:reolink:card', [], false)
    expect(choice.derivation).toBe('pending')
    expect(choice.addonId).toBeNull()
    // The pick is still reported, so a surface can say WHICH source it is
    // waiting on rather than showing nothing.
    expect(choice.sourceId).toBe('native:reolink:card')
  })

  it('holds at null when the answered list does not contain the pick', () => {
    const choice = resolveRecordingProvider('native:reolink:card', [OURS], true)
    expect(choice.derivation).toBe('missing')
    expect(choice.addonId).toBeNull()
  })

  it('never falls back to ours, or to the first row', () => {
    // Both fallbacks are wrong and both are tempting: `?? sources[0]` is what
    // the clip picker does, and "default to ours" is what the rest of this
    // module does. On a timeline either one paints another source's coverage
    // under the label of the picked one.
    for (const known of [true, false]) {
      const choice = resolveRecordingProvider('gone', [OURS, CARD], known)
      expect(choice.addonId).toBeNull()
      expect(choice.sourceId).toBe('gone')
    }
  })

  it('resolves a pick the answered list DOES contain', () => {
    const choice = resolveRecordingProvider('native:reolink:card', [OURS, CARD], true)
    expect(choice).toEqual({
      sourceId: 'native:reolink:card',
      addonId: 'provider-reolink',
      derivation: 'picked',
    })
  })
})

describe('parseRecordingSources', () => {
  /**
   * The wire row, VALIDATED against the cap's own schema before it is handed
   * to the parser.
   *
   * This is the whole point of this helper. The first version of this suite
   * spelled the field `sourceId` because the parser did, and both were wrong —
   * `RecordingSourceSchema` says `source`, so the parser dropped every row the
   * hub sends and the test agreed with it. A fake that supplies what
   * production never receives is the failure mode this repo keeps paying for,
   * and it cannot happen through this door: the schema rejects the fixture.
   */
  const wireRow = (row: unknown): unknown => RecordingSourceSchema.parse(row)

  it('refuses a fixture the cap would not accept', () => {
    // The exact mistake, pinned: `sourceId` is not a field of this schema.
    expect(() =>
      wireRow({ sourceId: 'a', addonId: 'x', label: 'A', availability: { state: 'ok' } }),
    ).toThrow()
  })

  it('reads the row the hub really sends', () => {
    // Measured on the live hub for camera 107, 2026-09-24.
    const rows = parseRecordingSources([
      wireRow({
        source: 'camstack',
        label: 'CamStack recordings',
        addonId: 'recorder',
        availability: { state: 'ok', coverageAsOf: 1790261798809 },
      }),
    ])
    expect(rows).toEqual([
      { sourceId: 'camstack', addonId: 'recorder', label: 'CamStack recordings' },
    ])
  })

  it('keeps rows that carry both names and drops the rest', () => {
    const rows = parseRecordingSources([
      { source: 'a', addonId: 'x', label: 'A' },
      { source: 'b' },
      { addonId: 'y' },
      { source: '', addonId: 'z' },
      'nonsense',
      null,
    ])
    expect(rows).toEqual([{ sourceId: 'a', addonId: 'x', label: 'A' }])
  })

  it('answers empty for a response that is not a list', () => {
    expect(parseRecordingSources(null)).toEqual([])
    expect(parseRecordingSources({ rows: [] })).toEqual([])
  })

  it('omits a label the row did not carry rather than inventing one', () => {
    const [row] = parseRecordingSources([{ source: 'a', addonId: 'x' }])
    expect(row).toEqual({ sourceId: 'a', addonId: 'x' })
    expect('label' in (row ?? {})).toBe(false)
  })
})
