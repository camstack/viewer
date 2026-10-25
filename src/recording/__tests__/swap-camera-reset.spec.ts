/**
 * The playback machine across an IN-PLACE camera swap (D483).
 *
 * Until this change the screen was keyed by route id, so a swap remounted it
 * and a fresh machine arrived by construction. With the key gone that guarantee
 * is gone with it, and the failure shape changes: a field that survives the
 * swap is one camera's playhead showing on another's picture — the exact defect
 * `usePlaybackMachine` is per-instance to prevent.
 *
 * So every assertion here is "the new camera starts from nothing, PLUS the one
 * thing the gesture passed as an argument".
 */
import { describe, it, expect } from 'vitest'
import {
  initialPlaybackState,
  playbackReducer,
  selectActiveEpoch,
  type PlaybackState,
} from '../playback-machine.js'

const T = 1_699_999_000_000
const OTHER = 1_699_000_000_000

/** Camera A, mid-scrub, with every sticky flag the machine has set. */
const SCRUBBING: PlaybackState = {
  ...initialPlaybackState,
  mode: 'seeking',
  playhead: OTHER,
  seekTarget: OTHER + 5_000,
  seekAnchor: OTHER,
  seekLanded: true,
  stragglerReports: 3,
  lastSource: 'heatmap',
  scrubDirection: 'backward',
  liveLocked: true,
  selectionAnchor: OTHER - 60_000,
}

describe('swapping to a camera while the old one was in PLAYBACK', () => {
  const next = playbackReducer(SCRUBBING, { type: 'SWAP_CAMERA', atMs: T })

  it('lands on the instant the gesture carried, in playback', () => {
    expect(next.mode).toBe('playback')
    expect(next.playhead).toBe(T)
    expect(selectActiveEpoch(next)).toBe(T)
  })

  it('arms the anchor, so a straggler from the old camera cannot land', () => {
    expect(next.seekAnchor).toBe(T)
    expect(next.seekLanded).toBe(false)
    expect(next.stragglerReports).toBe(0)
  })

  /**
   * The old camera's instant must not survive in ANY field. A `seekTarget` left
   * behind draws the indicator at the previous camera's position for as long as
   * the drag state lasts.
   */
  it('keeps nothing of the old camera', () => {
    expect(next.seekTarget).toBeNull()
    expect(next.scrubDirection).toBeNull()
    expect(next.playhead).not.toBe(OTHER)
  })

  /**
   * The two STICKY flags, which are the ones a partial reset forgets.
   * `GO_LIVE` deliberately keeps `liveLocked`; an export selection is an epoch
   * range in footage from a camera the operator is no longer looking at, and a
   * Save button surviving the swap would export the wrong camera.
   */
  it('drops the live lock and any armed export selection', () => {
    expect(next.liveLocked).toBe(false)
    expect(next.selectionAnchor).toBeNull()
  })
})

describe('no live frame in between', () => {
  /**
   * The named case: swap from a SCRUBBING camera and the new one must be at the
   * carried instant with no live moment on the way.
   *
   * The machine half is here — `SWAP_CAMERA` lands on `playback` directly and
   * never passes through `live`, so nothing downstream can observe a live
   * frame. The PLAYER half is `set-device-contract.spec.ts`: the instant rides
   * the swap command, so the page opens the new camera at it instead of
   * opening live and being seeked afterwards (which is what would put a live
   * frame on screen).
   */
  it('goes straight to playback at the instant — never through live', () => {
    const next = playbackReducer(SCRUBBING, { type: 'SWAP_CAMERA', atMs: T })
    expect(next.mode).toBe('playback')
    expect(next.playhead).toBe(T)
    // The two shapes that WOULD show a live frame, ruled out by value.
    expect(next.mode).not.toBe('live')
    expect(next.playhead).not.toBeNull()
  })

  /** And the reducer is one step: there is no intermediate state to observe. */
  it('is a single transition, so no intermediate state exists at all', () => {
    const direct = playbackReducer(SCRUBBING, { type: 'SWAP_CAMERA', atMs: T })
    const viaLive = playbackReducer(
      playbackReducer(SCRUBBING, { type: 'GO_LIVE' }),
      { type: 'SWAP_CAMERA', atMs: T },
    )
    // Same destination — but the two-step route has a live state in the middle,
    // which is the whole reason the swap is one action.
    expect(direct.mode).toBe(viaLive.mode)
    expect(playbackReducer(SCRUBBING, { type: 'GO_LIVE' }).mode).toBe('live')
  })
})

describe('swapping to a camera while the old one was LIVE', () => {
  it('starts the new camera live, from a clean machine', () => {
    const live: PlaybackState = { ...initialPlaybackState, liveLocked: true, lastSource: 'cluster' }
    expect(playbackReducer(live, { type: 'SWAP_CAMERA', atMs: null })).toEqual(
      initialPlaybackState,
    )
  })

  it('is a full reset even from a deeply dirty state', () => {
    expect(playbackReducer(SCRUBBING, { type: 'SWAP_CAMERA', atMs: null })).toEqual(
      initialPlaybackState,
    )
  })
})

describe('why this is one action and not GO_LIVE + a seek', () => {
  /**
   * The latent bug the audit found. `adoptSeek` dispatches `SEEK`, and `SEEK`
   * is diverted to a preview-only update while the live lock is armed or a
   * selection is open — so seeding a locked machine that way moves the
   * indicator and leaves `mode` on `live`: the new camera would show the live
   * edge while the timeline claimed it was at T.
   *
   * Asserted as the CONTRAST, so the reason this action exists cannot be
   * deleted as redundant.
   */
  it('a bare SEEK on a locked machine does NOT enter playback', () => {
    const viaSeek = playbackReducer(SCRUBBING, { type: 'SEEK', epoch: T, source: 'timeline' })
    expect(viaSeek.mode).not.toBe('playback')

    const viaSwap = playbackReducer(SCRUBBING, { type: 'SWAP_CAMERA', atMs: T })
    expect(viaSwap.mode).toBe('playback')
  })

  /** And GO_LIVE is not a full reset either — it keeps the lock on purpose. */
  it('GO_LIVE keeps the live lock, so it cannot stand in for the reset', () => {
    expect(playbackReducer(SCRUBBING, { type: 'GO_LIVE' }).liveLocked).toBe(true)
    expect(playbackReducer(SCRUBBING, { type: 'SWAP_CAMERA', atMs: null }).liveLocked).toBe(false)
  })
})

describe('the seeded shape matches what a real seek produces', () => {
  /**
   * The embed performs the seek itself (the instant rides the `setDevice`
   * command), so the machine ADOPTS it. If the two shapes drift, the position
   * reports that follow are reconciled against an anchor the machine never
   * really armed.
   */
  it('agrees with SEEK on every field a seek sets', () => {
    const clean: PlaybackState = { ...initialPlaybackState }
    const seeked = playbackReducer(clean, { type: 'SEEK', epoch: T, source: 'timeline' })
    const swapped = playbackReducer(SCRUBBING, { type: 'SWAP_CAMERA', atMs: T })
    expect(swapped.mode).toBe(seeked.mode)
    expect(swapped.playhead).toBe(seeked.playhead)
    expect(swapped.seekAnchor).toBe(seeked.seekAnchor)
    expect(swapped.seekLanded).toBe(seeked.seekLanded)
    expect(swapped.seekTarget).toBe(seeked.seekTarget)
  })
})
