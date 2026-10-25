/**
 * What the modal says while the hub renders the clip.
 *
 * The rule under test is the one this whole day has been about: a measurement
 * that FAILED is `null`, never `0` (D393) — and D558 pinned the server half of
 * it in as many words, *"`progressPct` stays honest … `null` otherwise. No
 * ramp."* Every `unknown` assertion below is that rule reaching a pixel.
 */
import { describe, it, expect } from 'vitest'

import {
  clipExportFailureText,
  resolveClipExportPhase,
} from '../clip-export-progress.js'
import type { ExportRecord } from '../../data/use-exports.js'

function record(over: Partial<ExportRecord> = {}): ExportRecord {
  return {
    id: 'exp-1',
    deviceId: 107,
    profile: 'high',
    fromMs: 1_789_935_554_000,
    toMs: 1_789_935_582_000,
    options: { includeAudio: false, maxLifeMs: 1, deleteAfterDownload: false },
    state: 'rendering',
    progressPct: null,
    fileBytes: null,
    expiresAt: 0,
    deleteAfterDownload: false,
    downloadedAt: null,
    createdAt: 0,
    createdBy: 'op',
    error: null,
    ...over,
  }
}

describe('a running export reports what it can measure, and nothing else', () => {
  it('turns a percentage into a fraction', () => {
    const phase = resolveClipExportPhase(record({ progressPct: 40 }))
    expect(phase).toEqual({ kind: 'working', progress: { kind: 'known', fraction: 0.4 } })
  })

  it('reports UNKNOWN — not 0 — when the hub states no percentage', () => {
    // The hub says `null` wherever no real fraction exists. Folding that into
    // zero draws an empty bar that claims nothing has happened, and then
    // lurches when the mux starts reporting.
    const phase = resolveClipExportPhase(record({ progressPct: null }))
    expect(phase).toEqual({ kind: 'working', progress: { kind: 'unknown' } })
  })

  it('reports UNKNOWN for a QUEUED job as well', () => {
    // A job that has not started and a job that cannot be measured are both
    // "we cannot say"; neither is "0 % done".
    expect(resolveClipExportPhase(record({ state: 'queued' })).kind).toBe('working')
    const phase = resolveClipExportPhase(record({ state: 'queued', progressPct: null }))
    if (phase.kind !== 'working') throw new Error('unreachable')
    expect(phase.progress.kind).toBe('unknown')
  })

  it('clamps a percentage outside 0..100 rather than drawing past the end', () => {
    const over = resolveClipExportPhase(record({ progressPct: 140 }))
    if (over.kind !== 'working') throw new Error('unreachable')
    expect(over.progress).toEqual({ kind: 'known', fraction: 1 })
  })

  it('treats a non-finite percentage as unknown, never as zero', () => {
    const phase = resolveClipExportPhase(record({ progressPct: Number.NaN }))
    if (phase.kind !== 'working') throw new Error('unreachable')
    expect(phase.progress.kind).toBe('unknown')
  })

  it('says ASKED while there is no record at all', () => {
    // Different from "running and unmeasurable": the hub has not answered yet.
    expect(resolveClipExportPhase(null)).toEqual({ kind: 'asked' })
  })
})

describe('a finished export', () => {
  it('is ready, with the size the hub measured', () => {
    expect(resolveClipExportPhase(record({ state: 'ready', fileBytes: 812_345 }))).toEqual({
      kind: 'ready',
      exportId: 'exp-1',
      fileBytes: 812_345,
    })
  })

  it('is still READY once the janitor has expired or deleted the file', () => {
    // The render succeeded. What the retention did afterwards is the Library's
    // story, not a failure of the tap that started it.
    expect(resolveClipExportPhase(record({ state: 'expired' })).kind).toBe('ready')
    expect(resolveClipExportPhase(record({ state: 'deleted' })).kind).toBe('ready')
  })
})

describe('a failure is a TOKEN plus the producer own words', () => {
  it('splits the two', () => {
    const phase = resolveClipExportPhase(
      record({ state: 'failed', error: 'camera-refused: NVR busy, try later' }),
    )
    expect(phase).toEqual({
      kind: 'failed',
      failure: { code: 'camera-refused', detail: 'NVR busy, try later' },
    })
  })

  it('keeps a bare token with no prose', () => {
    expect(clipExportFailureText('catalog-miss')).toEqual({ code: 'catalog-miss', detail: '' })
  })

  it('keeps the WHOLE text of a string that is not from that vocabulary', () => {
    // `ECONNRESET: socket hang up` must not be read as a token plus a detail —
    // dropping the half before the colon loses the only part that identifies
    // it, and nothing can translate either half anyway.
    expect(clipExportFailureText('ECONNRESET: socket hang up')).toEqual({
      code: null,
      detail: 'ECONNRESET: socket hang up',
    })
  })

  it('says nothing at all for a null or empty error', () => {
    expect(clipExportFailureText(null)).toBeNull()
    expect(clipExportFailureText('')).toBeNull()
  })

  it('knows the ceiling refusal by name', () => {
    expect(clipExportFailureText('too-large-to-transfer: 174964736 > 52428800 bytes')).toEqual({
      code: 'too-large-to-transfer',
      detail: '174964736 > 52428800 bytes',
    })
  })
})
