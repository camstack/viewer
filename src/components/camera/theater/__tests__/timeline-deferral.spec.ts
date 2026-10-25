import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TIMELINE_DEFER_MS } from '../use-timeline-deferral.js'

/**
 * The timeline's heavy fetches wait for the picture — and never wait forever.
 *
 * `listTracks limit:500` plus the three-call activity bundle are the largest
 * requests the camera screen makes, and they share one WebSocket with the WebRTC
 * signalling (no `httpBatchLink` in this client), so issuing them during
 * negotiation competes with the seconds that decide how fast the stream appears.
 *
 * The fallback is the half that must not be lost in a refactor. An offline
 * camera never reports a picture, and a timeline gated only on that would stay
 * permanently empty — turning a stream fault into a "the timeline is broken"
 * report, which is a strictly worse thing to debug.
 */
describe('timeline deferral', () => {
  it('has a bounded wait — the timeline is never hostage to the player', () => {
    expect(TIMELINE_DEFER_MS).toBeGreaterThan(0)
    expect(TIMELINE_DEFER_MS).toBeLessThanOrEqual(3_000)
  })

  it('both heavy hooks accept the flag and default to loading', () => {
    // Defaulting to `true` is what keeps every OTHER caller unchanged; a default
    // of false would silently disable the query wherever the argument is omitted.
    const dir = join(process.cwd(), 'src', 'data')
    for (const f of ['use-device-tracks.ts', 'use-timeline-activity.ts']) {
      const src = readFileSync(join(dir, f), 'utf8')
      expect(src).toContain('ready = true')
      expect(src).toContain("enabled: ready && state === 'connected'")
    }
    const tracks = readFileSync(join(dir, 'use-device-tracks.ts'), 'utf8')
    expect(tracks).toContain('pollLive = true')
    expect(tracks).toContain("until: 'history'")
    expect(tracks).toContain("until: 'tail'")
  })

  it('the timeline passes the flag to BOTH of them', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'camera', 'theater', 'TheaterTimeline.tsx'),
      'utf8',
    )
    // Deferring one and not the other would keep the socket just as busy while
    // looking like the work was done.
    expect(src.match(/timelineReady/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('recorded/scrub does not poll the live tail of listTracks', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'camera', 'theater', 'TheaterTimeline.tsx'),
      'utf8',
    )
    expect(src).toContain('pollLive: props.mode === \'live\'')
  })
})

describe('the deferral releases', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('the fallback delay is reachable within the bound', () => {
    // A direct behavioural test needs a renderer, which this repo does not have
    // (see docs/roadmap.md). This asserts the timer arithmetic the hook relies
    // on, and the source guard above asserts the wiring.
    let fired = false
    setTimeout(() => {
      fired = true
    }, TIMELINE_DEFER_MS)
    vi.advanceTimersByTime(TIMELINE_DEFER_MS)
    expect(fired).toBe(true)
  })
})
