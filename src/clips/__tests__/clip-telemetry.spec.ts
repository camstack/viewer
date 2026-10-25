/**
 * The clip surface has to leave a trail even when it SUCCEEDS.
 *
 * The operator reported no thumbnails and no playback progress, and his
 * session on the hub carried zero clip lines — the scope spoke on failure
 * only, so "it ran and produced nothing" and "it never ran" were the same
 * silence. These counters are the difference.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { log } from '../../lib/logger.js'
import {
  CLIP_TELEMETRY_QUIET_MS,
  noteClipList,
  noteClipPlayback,
  noteClipStill,
  resetClipTelemetry,
} from '../clip-telemetry.js'

const lines: { msg: string; data: Record<string, unknown> }[] = []

beforeEach(() => {
  vi.useFakeTimers()
  lines.length = 0
  resetClipTelemetry()
  vi.spyOn(log, 'info').mockImplementation((_scope, msg, data) => {
    lines.push({ msg, data: (data ?? {}) as Record<string, unknown> })
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('clip telemetry', () => {
  it('says nothing until the surface goes quiet — a burst is ONE line', () => {
    for (let i = 0; i < 40; i++) noteClipStill({ outcome: 'served', ms: 10 })
    expect(lines).toHaveLength(0)
    vi.advanceTimersByTime(CLIP_TELEMETRY_QUIET_MS)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.msg).toBe('stills burst')
    expect((lines[0]?.data.burst as Record<string, number>).asks).toBe(40)
  })

  it('keeps the outcomes APART — deferred is not refused and neither is a failure', () => {
    noteClipStill({ outcome: 'deferred', ms: 5 })
    noteClipStill({ outcome: 'refused', ms: 5 })
    noteClipStill({ outcome: 'failed', ms: 5 })
    noteClipStill({ outcome: 'held', ms: 0 })
    vi.advanceTimersByTime(CLIP_TELEMETRY_QUIET_MS)
    const burst = lines[0]?.data.burst as Record<string, number>
    expect(burst).toMatchObject({ deferred: 1, refused: 1, failed: 1, held: 1, asks: 4 })
  })

  it('carries the totals since launch beside the burst that just ended', () => {
    noteClipStill({ outcome: 'served', ms: 10 })
    vi.advanceTimersByTime(CLIP_TELEMETRY_QUIET_MS)
    noteClipStill({ outcome: 'failed', ms: 10 })
    vi.advanceTimersByTime(CLIP_TELEMETRY_QUIET_MS)
    expect(lines).toHaveLength(2)
    const second = lines[1]?.data as Record<string, Record<string, number>>
    // the burst is only the second ask…
    expect(second.burst?.asks).toBe(1)
    // …while the totals remember both, which is what a report needs.
    expect(second.sinceLaunch?.asks).toBe(2)
    expect(second.sinceLaunch?.served).toBe(1)
    expect(second.sinceLaunch?.failed).toBe(1)
  })

  it('reports a list that ANSWERED with zero rows as answered, not failed', () => {
    // An empty day is an answer. Folding it into `failed` would recreate the
    // exact ambiguity these counters exist to remove.
    noteClipList({ deviceId: 3628, provider: 'provider-reolink', rows: 0, ms: 12 })
    vi.advanceTimersByTime(CLIP_TELEMETRY_QUIET_MS)
    const burst = lines[0]?.data.burst as Record<string, number>
    expect(burst.answered).toBe(1)
    expect(burst.failed ?? 0).toBe(0)
    expect(lines[0]?.data.provider).toBe('provider-reolink')
  })

  it('names which quality playback resolved to', () => {
    noteClipPlayback({ deviceId: 3628, ok: true, served: 'low', ms: 30 })
    vi.advanceTimersByTime(CLIP_TELEMETRY_QUIET_MS)
    const burst = lines[0]?.data.burst as Record<string, number>
    expect(burst['served:low']).toBe(1)
    expect(burst.resolved).toBe(1)
  })
})
