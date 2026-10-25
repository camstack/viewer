/**
 * The `createExport` input a clip tile produces — every assertion here is a
 * REFUSAL on the hub's side, i.e. a job the operator thinks is queued and is
 * not.
 */
import { describe, it, expect } from 'vitest'

import {
  CLIP_EXPORT_LIFE_MS,
  buildClipExportInput,
  buildClipExportSubject,
} from '../clip-export-subject.js'
import type { Clip } from '../clip-model.js'

function clip(over: Partial<Clip> = {}): Clip {
  return {
    clipId: 'native:reolink:onboard:0:abc',
    deviceId: 107,
    startMs: 1_789_935_554_000,
    endMs: 1_789_935_582_000,
    sourceId: 'native:reolink:onboard',
    kind: 'motion',
    playback: { kind: 'native', deviceId: 107, clipId: 'native:reolink:onboard:0:abc' },
    ...over,
  }
}

const REQUEST = {
  clip: clip(),
  provider: '@camstack/addon-provider-reolink',
  sourceLabel: 'SD card',
  catalogWindow: { sinceMs: 1_789_900_000_000, untilMs: 1_789_986_400_000 },
  profile: 'high',
} as const

describe('a clip export asks for NO time range', () => {
  it('sends neither fromMs nor toMs', () => {
    // The camera chose the boundaries; they reach the record only as the
    // projection. Supplying a range beside a clip subject is REFUSED rather
    // than ignored (D558 § 5.4.3) — so "helpfully" passing the row's own span
    // breaks the export outright.
    const input = buildClipExportInput(REQUEST)
    expect('fromMs' in input).toBe(false)
    expect('toMs' in input).toBe(false)
  })

  it('does not smuggle the row span in under another name either', () => {
    const input = buildClipExportInput(REQUEST)
    expect(JSON.stringify(input)).not.toContain(String(REQUEST.clip.endMs))
  })
})

describe('deviceId lives at the TOP level as well as in the subject', () => {
  it('sets both, to the same camera', () => {
    // `METHOD_DEVICE_SELECTORS` maps top-level fields only, so per-device scope
    // enforcement reads the top-level one and cannot see `subject.deviceId`. A
    // deviceId that lived only in the subject would let a principal scoped to
    // one camera export — and wake — another.
    const input = buildClipExportInput(REQUEST)
    expect(input.deviceId).toBe(107)
    expect(input.subject?.deviceId).toBe(107)
  })
})

describe('exactly ONE profile, and it rides the subject', () => {
  it('puts the profile on the subject and sends no top-level profiles array', () => {
    // One tap is never two fetches (D558 § 5.2), and a clip export may wake a
    // sleeping camera: one authorised yes is one wake.
    const input = buildClipExportInput(REQUEST)
    expect(input.subject?.profile).toBe('high')
    expect(input.profiles).toBeUndefined()
    expect(input.profile).toBeUndefined()
  })

  it('carries the low profile just as literally', () => {
    const input = buildClipExportInput({ ...REQUEST, profile: 'low' })
    expect(input.subject?.profile).toBe('low')
  })
})

describe('options a remux cannot honour are never sent', () => {
  it('sends no speed and no timelapse', () => {
    // Both are `unsupported-option` refusals at creation (D572): nothing on
    // this path is re-timed, and a silently ignored option would be a claim
    // the record carries for its whole life.
    const { options } = buildClipExportInput(REQUEST)
    expect(options.speed).toBeUndefined()
    expect(options.timelapse).toBeUndefined()
  })

  it('inherits the retention the timeline selection uses — no bespoke policy', () => {
    const { options } = buildClipExportInput(REQUEST)
    expect(options.maxLifeMs).toBe(CLIP_EXPORT_LIFE_MS)
    expect(CLIP_EXPORT_LIFE_MS).toBe(7 * 24 * 60 * 60 * 1_000)
    expect(options.deleteAfterDownload).toBe(false)
  })
})

describe('the subject names the source it was listed from', () => {
  it('carries the provider addon, the source id and the frozen label', () => {
    // `provider` is the pin `listClips` requires — a bare call fans out over
    // every source. `sourceLabel` is frozen at creation so a history row still
    // reads "SD card" after the source is unbound.
    const subject = buildClipExportSubject(REQUEST)
    expect(subject).toEqual({
      kind: 'clip',
      deviceId: 107,
      provider: '@camstack/addon-provider-reolink',
      source: 'native:reolink:onboard',
      sourceLabel: 'SD card',
      clipId: 'native:reolink:onboard:0:abc',
      catalogWindow: { sinceMs: 1_789_900_000_000, untilMs: 1_789_986_400_000 },
      profile: 'high',
    })
  })

  it('passes the catalog window through untouched — it is not a range control', () => {
    // It says WHERE to confirm the row, and a window that does not contain the
    // clip is a `catalog-miss`, never a silently wider search.
    const window = { sinceMs: 1, untilMs: 2 }
    expect(buildClipExportSubject({ ...REQUEST, catalogWindow: window }).catalogWindow).toEqual(
      window,
    )
  })
})
