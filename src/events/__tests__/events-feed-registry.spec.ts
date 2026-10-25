/**
 * Reassigning a face has to reach a mounted embed.
 *
 * The operator's report: after assigning an identity, the embed's cards keep
 * the old label and the unknown-face badge until a manual reload. The embed
 * owns its own feed and hears nothing from the query cache, so the native
 * invalidations that fix the native surfaces do nothing for it.
 *
 * The part that is easy to get wrong — and that the obvious fix gets wrong — is
 * WHICH command. `refresh` is incremental: `deltaSince` bounds it at the head
 * row's `lastSeen`, and assigning an identity rewrites a label without moving
 * `lastSeen`. A track from an hour ago is therefore never in the delta payload,
 * the merge never receives a fresher copy to win with, and the card stays
 * exactly as stale as before. Only `reload` re-reads it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  mountedEventsFeedCount,
  refreshEventsFeeds,
  registerEventsFeed,
  reloadEventsFeeds,
  resetEventsFeedReloadWindow,
  shouldReload,
  __setReloadTimerForTest,
  reloadEventsFeedsAfterBurst,
} from '../events-feed-registry.js'

beforeEach(() => {
  // Each test unregisters what it mounts; only the coalescing window is
  // module-level state that would leak between them.
  resetEventsFeedReloadWindow()
  expect(mountedEventsFeedCount()).toBe(0)
})

describe('the registry reaches every mounted surface', () => {
  it('prepends a live delta without reloading the feed', () => {
    const refresh = vi.fn()
    const reload = vi.fn()
    const off = registerEventsFeed({ refresh, reload })
    refreshEventsFeeds('track-ended', 1_000)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
    off()
  })

  it('reloads the reel AND the gallery from one call', () => {
    // Two embeds can be mounted at once (the reel on Cameras, the gallery on
    // Events) and neither knows about the other.
    const reel = vi.fn()
    const gallery = vi.fn()
    const offA = registerEventsFeed({ refresh: vi.fn(), reload: reel })
    const offB = registerEventsFeed({ refresh: vi.fn(), reload: gallery })
    reloadEventsFeeds('face-assignment', 1_000)
    expect(reel).toHaveBeenCalledTimes(1)
    expect(gallery).toHaveBeenCalledTimes(1)
    offA()
    offB()
  })

  it('stops reaching a surface once it unmounts', () => {
    const gone = vi.fn()
    const off = registerEventsFeed({ refresh: vi.fn(), reload: gone })
    off()
    reloadEventsFeeds('face-assignment', 1_000)
    expect(gone).not.toHaveBeenCalled()
  })

  it('is a no-op when nothing is mounted', () => {
    expect(() => reloadEventsFeeds('face-assignment', 1_000)).not.toThrow()
  })

  it('one wedged surface does not stop the others', () => {
    const ok = vi.fn()
    const offA = registerEventsFeed({
      refresh: vi.fn(),
      reload: () => {
        throw new Error('iframe is gone')
      },
    })
    const offB = registerEventsFeed({ refresh: vi.fn(), reload: ok })
    reloadEventsFeeds('face-assignment', 1_000)
    expect(ok).toHaveBeenCalledTimes(1)
    offA()
    offB()
  })
})

describe('the two triggers collapse into one re-page', () => {
  it('coalesces a mutation and its echo from the hub', () => {
    // The same identity change arrives twice by design: the local mutation's
    // `onSuccess` and the hub's `face-gallery-changed`. Both are wanted — an
    // event may be dropped (D8), so the local call is the reconcile — but the
    // feed must not re-page twice for one operator action.
    const surface = vi.fn()
    const off = registerEventsFeed({ refresh: vi.fn(), reload: surface })
    reloadEventsFeeds('face-assignment', 1_000)
    reloadEventsFeeds('face-gallery-changed', 1_200)
    expect(surface).toHaveBeenCalledTimes(1)
    off()
  })

  it('accepts a genuinely later change', () => {
    const surface = vi.fn()
    const off = registerEventsFeed({ refresh: vi.fn(), reload: surface })
    reloadEventsFeeds('face-assignment', 1_000)
    reloadEventsFeeds('face-assignment', 10_000)
    expect(surface).toHaveBeenCalledTimes(2)
    off()
  })

  /**
   * 2026-09-10: the operator assigned faces from the gallery and the app read
   * as blocked. Every assignment reloads the mounted embed, and the hub
   * recorded EIGHT assignments in ninety seconds producing SIX full reloads —
   * each one re-pages the feed.
   *
   * `reloadEventsFeeds`'s 1.5 s window cannot help: his pace was one every
   * ~11 s, so each cleared it. The burst rule belongs to the CALLER, which is
   * why it is a second function rather than a change to the fan-out above.
   */
  it('a burst of assignments re-pages the feed ZERO times while it lasts', () => {
    const surface = vi.fn()
    const off = registerEventsFeed({ refresh: vi.fn(), reload: surface })
    for (let i = 0; i < 8; i++) reloadEventsFeedsAfterBurst('face-assignment')
    expect(surface, 'the feed re-paged while the operator was still working').not.toHaveBeenCalled()
    off()
  })

  it('and re-pages ONCE after it settles, so the changes are not lost', () => {
    const pending: (() => void)[] = []
    __setReloadTimerForTest(
      (fn) => {
        pending.push(fn)
        return 0 as unknown as ReturnType<typeof setTimeout>
      },
      () => {
        pending.pop()
      },
    )
    const surface = vi.fn()
    const off = registerEventsFeed({ refresh: vi.fn(), reload: surface })

    reloadEventsFeedsAfterBurst('face-assignment')
    reloadEventsFeedsAfterBurst('face-assignment')
    reloadEventsFeedsAfterBurst('face-assignment')
    expect(surface).not.toHaveBeenCalled()
    expect(pending.length, 'nothing was armed for after the burst').toBe(1)

    pending[pending.length - 1]?.()
    expect(
      surface,
      'the changes made during the burst never reached the feed',
    ).toHaveBeenCalledTimes(1)

    off()
    __setReloadTimerForTest(setTimeout, clearTimeout)
  })

  it('shouldReload is the whole window rule, and is pure', () => {
    expect(shouldReload(1_000, 1_000)).toBe(false)
    expect(shouldReload(1_000, 2_400)).toBe(false)
    expect(shouldReload(1_000, 2_500)).toBe(true)
  })
})
