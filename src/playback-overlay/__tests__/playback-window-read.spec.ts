import { describe, it, expect } from 'vitest'
import {
  OVERLAY_LOOKBACK_MS,
  OVERLAY_PREFETCH_MS,
  OVERLAY_WINDOW_MS,
  WINDOW_TRACK_LIMIT,
  frameFromWindow,
  keepPreviousWindow,
  readPlaybackWindow,
  windowCovers,
  windowStartFor,
} from '../playback-window-read'

interface Row {
  trackId: string
  className: string
  firstSeen: number
  lastSeen: number
  envelope: { minX: number; minY: number; maxX: number; maxY: number }
  positions: { timestamp: number; x: number; y: number; bbox: { x: number; y: number; w: number; h: number } }[]
}

function row(id: string, firstSeen: number, lastSeen: number): Row {
  const positions: Row['positions'] = []
  for (let k = 0, ts = firstSeen; ts <= lastSeen; k += 1, ts += 1_000) {
    const px = 100 + (k % 5) * 100
    const py = 100 + (k % 3) * 50
    positions.push({ timestamp: ts, x: (px + 50) / 1000, y: (py + 50) / 500, bbox: { x: px, y: py, w: 100, h: 100 } })
  }
  return { trackId: id, className: 'person', firstSeen, lastSeen, envelope: { minX: 0.1, minY: 0.2, maxX: 0.6, maxY: 0.6 }, positions }
}

/** A hub fake with the REAL listTracks semantics: since/until filter on
 *  firstSeen, newest first, row limit. */
function hub(all: readonly Row[], opts: { fail?: boolean } = {}): Record<string, unknown> {
  return {
    pipelineAnalytics: {
      listTracks: {
        query: async (i: { since?: number; until?: number; limit?: number }) => {
          if (opts.fail) throw new Error('boom')
          return all
            .filter((r) => (i.since === undefined || r.firstSeen >= i.since) && (i.until === undefined || r.firstSeen <= i.until))
            .sort((a, b) => b.firstSeen - a.firstSeen)
            .slice(0, i.limit ?? 100)
        },
      },
    },
  }
}

const T = 10_000_000 // playback time
const block = windowStartFor(T)

describe('readPlaybackWindow + frameFromWindow', () => {
  it('(a) boxes a long-lived track that began before the window', async () => {
    const longLived = row('long', block - 5 * 60_000, T + 30_000)
    const read = await readPlaybackWindow(hub([longLived]), 1, block)
    const frame = frameFromWindow(read, T)
    expect(frame.availability).toBe('known')
    if (frame.availability !== 'known') return
    expect(frame.boxes).toHaveLength(1)
    expect(frame.occupancy).toEqual([{ className: 'person', count: 1 }])
  })

  it('a track older than the lookback is outside the bound (documented limit)', async () => {
    const tooOld = row('old', block - OVERLAY_LOOKBACK_MS - 1, T + 30_000)
    const read = await readPlaybackWindow(hub([tooOld]), 1, block)
    // nothing in the window; the probe still sees it, so the range reads as quiet
    expect(read.windowTracks).toBe(0)
  })

  it('(b) a failed read rejects, so the hook has no data and the frame is unknown', async () => {
    await expect(readPlaybackWindow(hub([], { fail: true }), 1, block)).rejects.toThrow()
    expect(frameFromWindow(undefined, T)).toEqual({ availability: 'unknown' })
  })

  it('(c) a limit-full answer is unknown, never known', async () => {
    const many = Array.from({ length: WINDOW_TRACK_LIMIT }, (_, i) => row(`t${i}`, block + i, block + i + 1_000))
    const read = await readPlaybackWindow(hub(many), 1, block)
    expect(read.truncated).toBe(true)
    expect(frameFromWindow(read, block + 5).availability).toBe('unknown')
  })

  it('an empty window with nothing older is unknown; with older history it is quiet', async () => {
    const empty = await readPlaybackWindow(hub([]), 1, block)
    expect(frameFromWindow(empty, T).availability).toBe('unknown')
    const quiet = await readPlaybackWindow(hub([row('older', block - 3_600_000, block - 3_599_000)]), 1, block)
    expect(frameFromWindow(quiet, T)).toMatchObject({ availability: 'known', boxes: [] })
  })
})

describe('window blocks', () => {
  it('switches to the next block early, and the previous one still covers t', async () => {
    const t = windowStartFor(T) + OVERLAY_WINDOW_MS - OVERLAY_PREFETCH_MS // first instant of the next key
    const prev = await readPlaybackWindow(hub([]), 1, block)
    expect(windowStartFor(t)).toBe(block + OVERLAY_WINDOW_MS)
    expect(windowCovers(prev, t)).toBe(true)
    expect(windowCovers(prev, block + OVERLAY_WINDOW_MS + 1)).toBe(false)
  })
})

describe('the previous window as a placeholder', () => {
  it('stands in for the same camera while it covers t', async () => {
    const a = await readPlaybackWindow(hub([]), 1, block)
    expect(keepPreviousWindow(a, 1, T)).toBe(a)
  })
  it('never crosses to another camera, even when t is covered', async () => {
    const a = await readPlaybackWindow(hub([row('x', T - 5_000, T + 5_000)]), 1, block)
    expect(windowCovers(a, T)).toBe(true)
    expect(keepPreviousWindow(a, 2, T)).toBeUndefined()
  })
})
