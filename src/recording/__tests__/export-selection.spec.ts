/**
 * The selection an operator draws on the timeline before saving an export.
 *
 * Everything here is decided by ONE pure function pair, because every way this
 * feature can go wrong is arithmetic that no mount test would catch: the
 * operator scrubs BACKWARDS more often than forwards (they are looking for
 * something that already happened), so the moving end is normally BEFORE the
 * anchor and a naive `{ fromMs: anchor, toMs: current }` sends the hub a
 * negative interval.
 */
import { describe, it, expect } from 'vitest'
import {
  MIN_EXPORT_SELECTION_MS,
  describeExportSelection,
  formatSelectionDuration,
  missingMsInSelection,
  resolveExportSelection,
  selectionCoverage,
  isSavableSelection,
} from '../export-selection.js'

const T = (s: string): number => Date.parse(`2026-09-07T${s}Z`)
/** The live edge for every case that is not about the clamp: late enough that
 *  nothing in these ranges reaches it. */
const NOW = T('23:00:00')

describe('resolveExportSelection normalises the two ends', () => {
  it('forward scrub: anchor is the start', () => {
    expect(resolveExportSelection(T('10:00:00'), T('10:05:00'), NOW)).toEqual({
      fromMs: T('10:00:00'),
      toMs: T('10:05:00'),
      durationMs: 300_000,
    })
  })

  it('BACKWARD scrub: the moving end becomes the start', () => {
    expect(resolveExportSelection(T('10:05:00'), T('10:00:00'), NOW)).toEqual({
      fromMs: T('10:00:00'),
      toMs: T('10:05:00'),
      durationMs: 300_000,
    })
  })

  it('the free end may land AFTER the anchor: two hours ago until one hour ago', () => {
    // The operator drags the free end FORWARD from where they armed it. The
    // anchor is the start of the gesture, not the start of the range.
    expect(resolveExportSelection(T('10:00:00'), T('11:30:00'), NOW)).toEqual({
      fromMs: T('10:00:00'),
      toMs: T('11:30:00'),
      durationMs: 90 * 60_000,
    })
  })

  it('the free end cannot pass the live edge — it is clamped there', () => {
    const liveEdge = T('11:00:00')
    // The heatmap maps a fraction of the whole DAY onto an epoch, so a tap
    // after the now-line names a moment that has not happened. The hub would be
    // asked to render footage from the future.
    expect(resolveExportSelection(T('10:00:00'), T('13:00:00'), liveEdge)).toEqual({
      fromMs: T('10:00:00'),
      toMs: liveEdge,
      durationMs: 60 * 60_000,
    })
  })

  it('a missing end is no selection at all', () => {
    expect(resolveExportSelection(null, T('10:00:00'), NOW)).toBeNull()
    expect(resolveExportSelection(T('10:00:00'), null, NOW)).toBeNull()
    expect(resolveExportSelection(null, null, NOW)).toBeNull()
  })

  it('the two ends coinciding is a zero-length range, not a null one', () => {
    expect(resolveExportSelection(T('10:00:00'), T('10:00:00'), NOW)?.durationMs).toBe(0)
  })
})

describe('isSavableSelection refuses what cannot be rendered', () => {
  it('rejects null', () => {
    expect(isSavableSelection(null)).toBe(false)
  })

  it('rejects a zero-length selection', () => {
    expect(isSavableSelection(resolveExportSelection(T('10:00:00'), T('10:00:00'), NOW))).toBe(false)
  })

  it('rejects anything under the floor, accepts the floor itself', () => {
    const from = T('10:00:00')
    expect(isSavableSelection(resolveExportSelection(from, from + MIN_EXPORT_SELECTION_MS - 1, NOW))).toBe(false)
    expect(isSavableSelection(resolveExportSelection(from, from + MIN_EXPORT_SELECTION_MS, NOW))).toBe(true)
  })

  it('a backward drag of a savable length is savable', () => {
    expect(isSavableSelection(resolveExportSelection(T('10:05:00'), T('10:00:00'), NOW))).toBe(true)
  })
})

describe('selectionCoverage tells the operator what is really in the range', () => {
  const window = { from: T('00:00:00'), to: T('23:59:59') }
  const covered = [{ startMs: T('09:00:00'), endMs: T('12:00:00') }]

  it('fully inside the footage → covered', () => {
    const sel = resolveExportSelection(T('10:00:00'), T('11:00:00'), NOW)!
    expect(selectionCoverage(covered, window.from, window.to, sel)).toBe('covered')
  })

  it('a HOLE in the middle → partial', () => {
    const holed = [
      { startMs: T('09:00:00'), endMs: T('10:00:00') },
      { startMs: T('10:30:00'), endMs: T('12:00:00') },
    ]
    const sel = resolveExportSelection(T('09:30:00'), T('11:00:00'), NOW)!
    expect(selectionCoverage(holed, window.from, window.to, sel)).toBe('partial')
    expect(missingMsInSelection(holed, sel)).toBe(30 * 60_000)
  })

  it('running off the end of the footage → partial', () => {
    const sel = resolveExportSelection(T('11:00:00'), T('13:00:00'), NOW)!
    expect(selectionCoverage(covered, window.from, window.to, sel)).toBe('partial')
  })

  it('nothing recorded anywhere in the range → absent', () => {
    const sel = resolveExportSelection(T('14:00:00'), T('15:00:00'), NOW)!
    expect(selectionCoverage(covered, window.from, window.to, sel)).toBe('absent')
    expect(missingMsInSelection(covered, sel)).toBe(60 * 60_000)
  })

  it('EMPTY coverage is unknown, never absent — an unread window must not block a save', () => {
    const sel = resolveExportSelection(T('10:00:00'), T('11:00:00'), NOW)!
    expect(selectionCoverage([], window.from, window.to, sel)).toBe('unknown')
  })

  it('a range reaching outside the queried window is unknown, not partial', () => {
    const sel = resolveExportSelection(T('10:00:00'), T('11:00:00'), NOW)!
    // The window itself starts after the selection: nobody asked about this time.
    expect(selectionCoverage(covered, T('10:30:00'), window.to, sel)).toBe('unknown')
  })
})

describe('formatSelectionDuration', () => {
  it('under an hour is m:ss', () => {
    expect(formatSelectionDuration(0)).toBe('0:00')
    expect(formatSelectionDuration(9_000)).toBe('0:09')
    expect(formatSelectionDuration(605_000)).toBe('10:05')
  })

  it('an hour or more grows an hours field', () => {
    expect(formatSelectionDuration(3_600_000)).toBe('1:00:00')
    expect(formatSelectionDuration(3_725_000)).toBe('1:02:05')
  })

  it('a negative duration never renders as a time', () => {
    expect(formatSelectionDuration(-1)).toBe('0:00')
  })
})

/**
 * The one derivation every surface reads: the band on the strip, the label on
 * the Save chip and the enablement of Save all come from here, so they cannot
 * describe a different range than the one that gets exported.
 */
describe('describeExportSelection', () => {
  const from = T('00:00:00')
  const to = T('23:59:59')
  const footage = [{ startMs: T('09:00:00'), endMs: T('12:00:00') }]

  it('nothing armed → not armed, no range, nothing to save', () => {
    const view = describeExportSelection(null, T('10:00:00'), footage, from, to, NOW)
    expect(view.armed).toBe(false)
    expect(view.range).toBeNull()
    expect(view.canSave).toBe(false)
    expect(view.durationLabel).toBe('0:00')
  })

  it('a backward selection inside the footage is savable and ordered', () => {
    const view = describeExportSelection(T('11:00:00'), T('10:00:00'), footage, from, to, NOW)
    expect(view.armed).toBe(true)
    expect(view.range).toEqual({ fromMs: T('10:00:00'), toMs: T('11:00:00'), durationMs: 3_600_000 })
    expect(view.canSave).toBe(true)
    expect(view.warn).toBe(false)
    expect(view.durationLabel).toBe('1:00:00')
  })

  it('a selection over NO footage cannot be saved — there is nothing to render', () => {
    const view = describeExportSelection(T('14:00:00'), T('15:00:00'), footage, from, to, NOW)
    expect(view.coverage).toBe('absent')
    expect(view.canSave).toBe(false)
  })

  it('a selection over a HOLE is savable but warns', () => {
    const holed = [
      { startMs: T('09:00:00'), endMs: T('10:00:00') },
      { startMs: T('10:30:00'), endMs: T('12:00:00') },
    ]
    const view = describeExportSelection(T('09:30:00'), T('11:00:00'), holed, from, to, NOW)
    expect(view.warn).toBe(true)
    expect(view.canSave).toBe(true)
  })

  it('an UNREAD coverage window never blocks the save', () => {
    const view = describeExportSelection(T('10:00:00'), T('11:00:00'), [], from, to, NOW)
    expect(view.coverage).toBe('unknown')
    expect(view.canSave).toBe(true)
  })

  it('the live edge (no epoch) is not a selection even with an anchor', () => {
    expect(describeExportSelection(T('10:00:00'), null, footage, from, to, NOW).canSave).toBe(false)
  })
})
