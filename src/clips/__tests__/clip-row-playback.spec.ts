/**
 * The running clip's row says it is running — and says honestly how far.
 *
 * > *"quando una clip gira, si deve evidenziare, e mostrarne il progresso
 * > sulla stessa"* — the operator, 2026-09-23.
 *
 * The whole point of the shape under test is that HIGHLIGHT and PROGRESS are
 * two answers: a clip is routinely the one on the frame while its length was
 * never measured, and the broker says so in as many words (*"clip playback:
 * duration unknown — the source ended without a length"*). Every test below
 * that pins `unknown` is pinning the D393 rule: a measurement that failed is
 * `null`, never `0`, all the way to what is drawn.
 */
import { describe, it, expect } from 'vitest'
import {
  UNKNOWN_CLIP_ROW_PLAYBACK,
  clipRowFromEpoch,
  clipRowFromHeld,
} from '../clip-row-playback.js'
import { UNKNOWN_CLIP_DURATION, resolveClipProgress } from '../clip-progress.js'

describe('clip-row-playback — a FILE on the frame, on its own axis', () => {
  it('reports the fraction once both the position and a measured length exist', () => {
    const row = clipRowFromHeld(resolveClipProgress(15_000, { ms: 30_000, source: 'measured' }))
    expect(row.progress).toEqual({ kind: 'known', fraction: 0.5 })
  })

  it('is UNKNOWN — not 0 — when the broker never measured a length', () => {
    // The row is still playing. A bar at 0 % would claim the file had not
    // started, and would lurch the instant a measurement landed.
    const row = clipRowFromHeld(resolveClipProgress(15_000, UNKNOWN_CLIP_DURATION))
    expect(row.progress.kind).toBe('unknown')
  })

  it('is UNKNOWN before the first position report', () => {
    const row = clipRowFromHeld(resolveClipProgress(null, { ms: 30_000, source: 'measured' }))
    expect(row.progress.kind).toBe('unknown')
  })

  it('clamps a position past the measured end rather than reporting >1', () => {
    const row = clipRowFromHeld(resolveClipProgress(90_000, { ms: 30_000, source: 'measured' }))
    expect(row.progress).toEqual({ kind: 'known', fraction: 1 })
  })
})

describe('clip-row-playback — a DERIVED clip, played by seeking our footage', () => {
  const WINDOW = { startMs: 1_000_000, endMs: 1_060_000, inProgress: false }

  it('reports the playhead inside the card own window', () => {
    expect(clipRowFromEpoch({ ...WINDOW, playheadMs: 1_030_000 }).progress).toEqual({
      kind: 'known',
      fraction: 0.5,
    })
  })

  it('is UNKNOWN before the playhead has said anything', () => {
    expect(clipRowFromEpoch({ ...WINDOW, playheadMs: null }).progress.kind).toBe('unknown')
  })

  it('is UNKNOWN on an in-progress row: its catalog end is not the file end', () => {
    // 592 reported the same `endTime` for eight minutes while the file grew.
    // A fraction against that window is a number that moves for reasons that
    // have nothing to do with playback.
    expect(
      clipRowFromEpoch({ ...WINDOW, inProgress: true, playheadMs: 1_030_000 }).progress.kind,
    ).toBe('unknown')
  })

  it('is UNKNOWN on a zero or inverted span, never a division by zero', () => {
    expect(
      clipRowFromEpoch({ startMs: 5, endMs: 5, inProgress: false, playheadMs: 5 }).progress.kind,
    ).toBe('unknown')
    expect(
      clipRowFromEpoch({ startMs: 10, endMs: 5, inProgress: false, playheadMs: 7 }).progress.kind,
    ).toBe('unknown')
  })

  it('clamps a playhead outside the window to the ends', () => {
    expect(clipRowFromEpoch({ ...WINDOW, playheadMs: 0 }).progress).toEqual({
      kind: 'known',
      fraction: 0,
    })
    expect(clipRowFromEpoch({ ...WINDOW, playheadMs: 9_000_000 }).progress).toEqual({
      kind: 'known',
      fraction: 1,
    })
  })
})

describe('clip-row-playback — the two facts stay two facts', () => {
  it('an unknown progress is still a PLAYING row, with no number invented for it', () => {
    // This is the whole shape: the surface draws the highlight off the row
    // HAVING a state, and the bar off the state's arm. Nothing here can say
    // "playing" only by producing a fraction.
    expect(UNKNOWN_CLIP_ROW_PLAYBACK.progress.kind).toBe('unknown')
    expect(Object.keys(UNKNOWN_CLIP_ROW_PLAYBACK.progress)).toEqual(['kind'])
  })
})
