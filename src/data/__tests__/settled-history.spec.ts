import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A timeline window that has already ENDED is not polled and never goes stale.
 *
 * Those tracks are closed and written; the ranges and buckets cannot change. Yet
 * both hooks carried a flat 30s `refetchInterval` and a 30s `staleTime`, so
 * yesterday was re-fetched every half minute — up to 500 rows, superjson-parsed
 * on the JS thread, on a socket that also carries the WebRTC signalling. It was
 * the bulk of the ~10 `listTracks`/minute measured on ONE camera during a scrub
 * on 2026-08-01, while the operator reported the timeline seizing.
 *
 * A source guard because the viewer cannot mount a component (see
 * `docs/roadmap.md` — vitest includes only `*.spec.ts`, environment `node`, no
 * renderer), and because the property is a policy: the exact numbers may move,
 * but "settled history is not polled" must not quietly revert in a refactor.
 */

const DATA = join(process.cwd(), 'src', 'data')
const read = (f: string): string => readFileSync(join(DATA, f), 'utf8')

const HOOKS = ['use-device-tracks.ts', 'use-timeline-activity.ts'] as const

describe('settled history is neither polled nor re-fetched', () => {
  it('the tracks hook splits history (never stale, never polled) from a live tail', () => {
    const src = read('use-device-tracks.ts')
    expect(src).toContain('isDeviceTracksLiveWindow')
    expect(src).toContain('staleTime: Number.POSITIVE_INFINITY')
    expect(src).toContain('refetchInterval: false')
    expect(src).toContain('refetchInterval: pollLive && liveWindow ? RECONCILE_MS : false')
  })

  it('the activity hook decides on a settled-past flag', () => {
    const src = read('use-timeline-activity.ts')
    expect(src).toContain('isImmutablePast')
    expect(src).toMatch(/toMs < Date\.now\(\) - /)
  })

  it('the activity hook makes settled history never stale', () => {
    expect(read('use-timeline-activity.ts')).toContain(
      'isImmutablePast ? Number.POSITIVE_INFINITY : 30_000',
    )
  })

  it('both hooks hold the previous window while a wider one loads', () => {
    // Extending the lookback changes `fromMs`; without this the query collapses
    // to undefined for the round trip and every cluster card unmounts — the
    // "continuous loading" was a WIPE, not a slow fetch.
    for (const hook of HOOKS) {
      expect(read(hook)).toContain('placeholderData: (previous) => previous')
    }
  })
})
