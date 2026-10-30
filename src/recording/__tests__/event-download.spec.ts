/**
 * The arithmetic of "download this event": the clip's span, the verdict that
 * gates Save, and which stills an event can be saved as.
 */
import { describe, expect, it } from 'vitest'

import {
  EVENT_CLIP_DEFAULT_PAD_MS,
  eventClipCoverage,
  eventClipGate,
  eventClipRange,
  eventSnapshotFilename,
  snapshotOptions,
} from '../event-download.js'
import { MIN_EXPORT_SELECTION_MS } from '../export-selection.js'
import type { MediaGroup } from '../../data/track-media-groups.js'

const START = Date.parse('2026-09-07T10:00:00Z')
const END = START + 12_000

describe('eventClipRange', () => {
  it('pads a track event five seconds each side by default', () => {
    const r = eventClipRange({ timestamp: START, endTimestamp: END })
    expect(EVENT_CLIP_DEFAULT_PAD_MS).toBe(5_000)
    expect(r.fromMs).toBe(START - 5_000)
    expect(r.toMs).toBe(END + 5_000)
    expect(r.durationMs).toBe(22_000)
  })

  it('a point event ends where it starts — pre + post only', () => {
    const r = eventClipRange({ timestamp: START })
    expect(r.fromMs).toBe(START - 5_000)
    expect(r.toMs).toBe(START + 5_000)
    expect(r.durationMs).toBe(10_000)
  })

  it('an end before the start is not a negative span', () => {
    const r = eventClipRange({ timestamp: START, endTimestamp: START - 3_000 }, 0, 0)
    expect(r.fromMs).toBe(START)
    expect(r.toMs).toBe(START + MIN_EXPORT_SELECTION_MS)
  })

  it('the pad is adjustable per side', () => {
    const r = eventClipRange({ timestamp: START, endTimestamp: END }, 30_000, 0)
    expect(r.fromMs).toBe(START - 30_000)
    expect(r.toMs).toBe(END)
  })

  it('never falls under the export floor, even with no padding on a point event', () => {
    const r = eventClipRange({ timestamp: START }, 0, 0)
    expect(r.durationMs).toBe(MIN_EXPORT_SELECTION_MS)
  })

  it('does not reach past now', () => {
    const now = END + 1_000
    const r = eventClipRange({ timestamp: START, endTimestamp: END }, 5_000, 30_000, now)
    expect(r.toMs).toBe(now)
    expect(r.durationMs).toBe(now - r.fromMs)
  })
})

describe('coverage gating', () => {
  const DAY_FROM = START - 3_600_000
  const DAY_TO = START + 3_600_000
  const range = eventClipRange({ timestamp: START, endTimestamp: END })
  const cover = (startMs: number, endMs: number) => [{ startMs, endMs }]

  it('nothing recorded under the clip blocks Save', () => {
    const verdict = eventClipCoverage(cover(DAY_FROM, START - 60_000), DAY_FROM, DAY_TO, range)
    expect(verdict).toBe('absent')
    expect(eventClipGate(verdict)).toBe('blocked')
  })

  it('a hole inside the clip asks first', () => {
    const verdict = eventClipCoverage(cover(START, DAY_TO), DAY_FROM, DAY_TO, range)
    expect(verdict).toBe('partial')
    expect(eventClipGate(verdict)).toBe('confirm-gap')
  })

  it('full coverage goes straight through', () => {
    const verdict = eventClipCoverage(cover(DAY_FROM, DAY_TO), DAY_FROM, DAY_TO, range)
    expect(verdict).toBe('covered')
    expect(eventClipGate(verdict)).toBe('allow')
  })

  it('an unanswered coverage read never blocks', () => {
    const verdict = eventClipCoverage([], DAY_FROM, DAY_TO, range)
    expect(verdict).toBe('unknown')
    expect(eventClipGate(verdict)).toBe('allow')
  })
})

describe('snapshotOptions', () => {
  const file = (mediaId: number, kind: string) => ({ mediaId, kind, timestamp: 0 })
  const group = (hasFullVariant: boolean): MediaGroup => ({
    id: 'g',
    logicalKind: 'keyFrame',
    display: file(1, 'keyFrameSmall'),
    full: hasFullVariant ? file(2, 'keyFrame') : file(1, 'keyFrameSmall'),
    hasFullVariant,
    timestamp: 0,
  })

  it('offers high only when the media has a separate full variant', () => {
    expect(snapshotOptions(group(true)).high?.kind).toBe('keyFrame')
    expect(snapshotOptions(group(false)).high).toBeNull()
    expect(snapshotOptions(group(false)).low?.kind).toBe('keyFrameSmall')
  })

  it('offers nothing for an event with no media', () => {
    expect(snapshotOptions(null)).toEqual({ high: null, low: null })
  })

  it('names the file after the track and the resolution', () => {
    expect(eventSnapshotFilename({ id: 'e1', trackId: 'a/b:C' }, 'high')).toBe('camstack-a-b-c-high')
    expect(eventSnapshotFilename({ id: 'e1' }, 'low')).toBe('camstack-e1-low')
  })
})
