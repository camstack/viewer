/**
 * The on-demand player's decisions, by value (D483).
 *
 * Every one of them is a claim the component's pixels cannot make: which
 * surfaces get the overlay at all, what instant an entry point means, when an
 * open player has outlived its own camera, and when it has been made redundant
 * by the camera it shows being opened full-screen.
 */
import { describe, it, expect } from 'vitest'
import {
  canOpenOnDemand,
  resolveSeekRoute,
  resolveReelInstant,
  resolveOnDemandOpen,
  resolveOnDemandOnFocus,
  onDemandSeedSeekMs,
  onDemandStartsLoading,
  liveOnDemandRequest,
  type MomentRequest,
} from '../ondemand-player.js'
import { DETAIL_WIDE_MIN_WIDTH, TABLET_MIN_SIDE } from '../../hooks/sidebar-rules.js'

const REQUEST: MomentRequest = { deviceId: 101, atMs: 1_700_000_000_000 }

/**
 * A SHORT web window of `width` — a laptop browser with little height.
 *
 * Deliberately shorter than `TABLET_MIN_SIDE`: `shouldUseWideDetail` has two
 * clauses, and on web the first one reads the WINDOW (there is no device screen
 * to ask), so a browser window whose shorter side is >= 768 and which is
 * landscape already qualifies as "tablet-proportioned" REGARDLESS of
 * `DETAIL_WIDE_MIN_WIDTH`. Keeping the height below 768 is what isolates the
 * width threshold so this test measures one thing. The other clause gets its
 * own case below.
 */
const web = (width: number) => ({ width, height: 700, isWeb: true, screenMinSide: undefined })
/** A tablet held in landscape / portrait. */
const tabletLandscape = {
  width: 1194,
  height: 834,
  isWeb: false,
  screenMinSide: TABLET_MIN_SIDE,
}
const tabletPortrait = {
  width: 834,
  height: 1194,
  isWeb: false,
  screenMinSide: TABLET_MIN_SIDE,
}
const phoneLandscape = { width: 932, height: 430, isWeb: false, screenMinSide: 430 }

describe('which surfaces get the on-demand player', () => {
  /**
   * The gate is `shouldUseWideDetail`, borrowed whole. Asserted against the
   * borrowed CONSTANT rather than a literal 1000: a test carrying its own copy
   * of the threshold would keep passing after the authority moved, which is the
   * one thing this delegation exists to prevent.
   */
  it('a wide web window, at the authority the camera theater already uses', () => {
    expect(canOpenOnDemand(web(DETAIL_WIDE_MIN_WIDTH))).toBe(true)
    expect(canOpenOnDemand(web(DETAIL_WIDE_MIN_WIDTH - 1))).toBe(false)
  })

  /**
   * The borrowed authority's OTHER clause, recorded here because it is not
   * what "web >= 1000pt" suggests and a reader of `canOpenOnDemand` would
   * otherwise be surprised by it in the field.
   *
   * On web there is no device screen to ask, so `isTabletViewport` falls back
   * to the window: a landscape browser window whose SHORTER side is at least
   * `TABLET_MIN_SIDE` is tablet-proportioned and qualifies below 1000pt. A
   * 900x800 browser window therefore gets the overlay. That is the existing
   * theater's behaviour, inherited deliberately — the alternative is a second
   * threshold that disagrees with the layout the overlay floats over.
   */
  it('also a tablet-PROPORTIONED web window, below the width constant', () => {
    const squarish = { width: 900, height: 800, isWeb: true, screenMinSide: undefined }
    expect(squarish.width).toBeLessThan(DETAIL_WIDE_MIN_WIDTH)
    expect(Math.min(squarish.width, squarish.height)).toBeGreaterThanOrEqual(TABLET_MIN_SIDE)
    expect(canOpenOnDemand(squarish)).toBe(true)
  })

  it('a tablet in landscape, and not the same tablet in portrait', () => {
    expect(canOpenOnDemand(tabletLandscape)).toBe(true)
    expect(canOpenOnDemand(tabletPortrait)).toBe(false)
  })

  it('never a phone, however it is held — the operator scoped this to tablet and web', () => {
    expect(canOpenOnDemand(phoneLandscape)).toBe(false)
    expect(canOpenOnDemand({ width: 430, height: 932, isWeb: false, screenMinSide: 430 })).toBe(
      false,
    )
  })
})

describe('what the "go to this moment" button does', () => {
  it('opens the overlay where there is room for it', () => {
    expect(resolveSeekRoute(tabletLandscape, REQUEST)).toEqual({
      kind: 'onDemand',
      request: REQUEST,
    })
  })

  /**
   * The button must not STOP working on a phone. Below the gate it keeps
   * today's behaviour exactly — the `?at=` navigation — so this change adds a
   * surface and removes none.
   */
  it('keeps navigating below the gate, carrying the same instant', () => {
    expect(resolveSeekRoute(phoneLandscape, REQUEST)).toEqual({
      kind: 'navigate',
      deviceId: 101,
      atMs: 1_700_000_000_000,
    })
  })

  it('routes on the viewport alone — the same request goes both ways', () => {
    const wide = resolveSeekRoute(web(1200), REQUEST)
    const narrow = resolveSeekRoute(web(700), REQUEST)
    expect(wide.kind).toBe('onDemand')
    expect(narrow.kind).toBe('navigate')
  })
})

describe('the instant a reel card means', () => {
  /**
   * "Camera B at the moment I am looking at." The primary machine's
   * `activeEpoch` IS that moment, and `null` is its live edge — which answers
   * `'live'`, in words. There is no third answer and no query.
   */
  it('is the primary playhead when the primary is in recorded playback', () => {
    expect(resolveReelInstant(1_699_999_000_000)).toBe(1_699_999_000_000)
  })

  it('is LIVE — not wall-clock now — when the primary is live', () => {
    expect(resolveReelInstant(null)).toBe('live')
  })

  it('treats epoch zero as a real instant, not as absent', () => {
    expect(resolveReelInstant(0)).toBe(0)
  })
})

/**
 * Operator report on viewer 1.0.588: the floating window opened from a camera
 * card did not start until pause → play, or by itself several seconds later.
 * The card asked for `atMs: Date.now()`, the overlay mounted its player with
 * that as `initialSeekMs`, and the embed entered RECORDED playback at "now" —
 * past the archive's edge, so the hub's feeder snapped to the newest CLOSED
 * segment's last millisecond and waited there for the next one to close.
 */
describe('the seek the overlay player is mounted with', () => {
  it('is NONE for a live request — the embed opens live on its own', () => {
    expect(onDemandSeedSeekMs({ deviceId: 101, atMs: 'live' })).toBeUndefined()
  })

  it('is NONE for the camera card\'s button — the card has no instant to carry', () => {
    expect(liveOnDemandRequest(101)).toEqual({ deviceId: 101, atMs: 'live' })
    expect(onDemandSeedSeekMs(liveOnDemandRequest(101))).toBeUndefined()
  })

  it('is the instant for a moment request', () => {
    expect(onDemandSeedSeekMs(REQUEST)).toBe(1_700_000_000_000)
  })

  it('carries epoch zero rather than dropping it', () => {
    expect(onDemandSeedSeekMs({ deviceId: 101, atMs: 0 })).toBe(0)
  })
})

describe('an open player must not outlive its camera', () => {
  it('keeps the request while the camera is still listed', () => {
    expect(resolveOnDemandOpen(REQUEST, [614, 101, 616])).toEqual(REQUEST)
  })

  it('drops it once an ANSWERED list no longer carries the camera', () => {
    expect(resolveOnDemandOpen(REQUEST, [614, 616])).toBeNull()
  })

  /**
   * The D315 discipline, and the reason this takes `undefined` instead of the
   * `(allCameras ?? []).map(...)` its nearest neighbour (`resolveCellPanel`'s
   * call site in `CameraDetailScreen`) passes: a list that has not ANSWERED
   * yet is not an empty list. Folding the two together closes the player on
   * every cold cache and on every transport blip — a media session torn down
   * because a query was still in flight.
   */
  it('keeps it while the camera list is UNKNOWN — not-yet-known is not gone', () => {
    expect(resolveOnDemandOpen(REQUEST, undefined)).toEqual(REQUEST)
  })

  it('drops it when the list answered with nothing at all', () => {
    expect(resolveOnDemandOpen(REQUEST, [])).toBeNull()
  })

  it('nothing open stays nothing open', () => {
    expect(resolveOnDemandOpen(null, [101])).toBeNull()
    expect(resolveOnDemandOpen(null, undefined)).toBeNull()
  })
})

/**
 * Two pictures of ONE camera is the defect this closes.
 *
 * The overlay survives navigation by construction, so opening a camera
 * full-screen no longer takes its overlay away — and when that camera IS the
 * one in the overlay the operator gets the same stream twice, in two sessions,
 * on one screen.
 *
 * It is a rule about the camera and NOT about navigating: a different camera in
 * the overlay is the whole point of the feature ("watch B while I look at A")
 * and must survive untouched.
 */
describe('an overlay must not double the camera the operator just opened', () => {
  it('closes when the camera opened full-screen is the one on show', () => {
    expect(resolveOnDemandOnFocus(REQUEST, 101)).toBeNull()
  })

  it('keeps a DIFFERENT camera — that is the feature, not the defect', () => {
    expect(resolveOnDemandOnFocus(REQUEST, 616)).toEqual(REQUEST)
  })

  it('nothing open stays nothing open', () => {
    expect(resolveOnDemandOnFocus(null, 101)).toBeNull()
  })
})

/**
 * The transport ring of the floating window (PiP button's neighbour, the
 * play control) waits on the RECORDED session's own `recState` report. A live
 * mount never sends one — `recState` is a recorded-playback message — so a
 * window that opened live and started `loading` kept the ring spinning around
 * the play button over a picture that was already playing.
 */
describe('whether the overlay\'s transport starts busy', () => {
  it('does NOT for a live request — nothing would ever clear it', () => {
    expect(onDemandStartsLoading({ deviceId: 101, atMs: 'live' })).toBe(false)
    expect(onDemandStartsLoading(liveOnDemandRequest(101))).toBe(false)
  })

  it('does for a moment request — the recorded session reports when it settles', () => {
    expect(onDemandStartsLoading(REQUEST)).toBe(true)
    expect(onDemandStartsLoading({ deviceId: 101, atMs: 0 })).toBe(true)
  })
})
