/**
 * What the on-demand player's store keeps, and what it refuses to keep (D483).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  ONDEMAND_BOX_DEFAULTS,
  parseOnDemandBoxPrefs,
  resolveOnDemandSize,
  useOnDemandPlayerStore,
  openOnDemandPlayer,
  focusOnDemandCamera,
} from '../ondemand-player-store.js'
import { DEFAULT_ONDEMAND_SIZE } from '../../live/ondemand-geometry.js'

describe('parsing stored box preferences', () => {
  it('reads a well-formed record back', () => {
    expect(parseOnDemandBoxPrefs({ size: 'large', position: { x: 40, y: 60 } })).toEqual({
      size: 'large',
      position: { x: 40, y: 60 },
    })
  })

  it('absent, malformed and non-object storage all give the defaults', () => {
    expect(parseOnDemandBoxPrefs(undefined)).toEqual(ONDEMAND_BOX_DEFAULTS)
    expect(parseOnDemandBoxPrefs(null)).toEqual(ONDEMAND_BOX_DEFAULTS)
    expect(parseOnDemandBoxPrefs('large')).toEqual(ONDEMAND_BOX_DEFAULTS)
    expect(parseOnDemandBoxPrefs(42)).toEqual(ONDEMAND_BOX_DEFAULTS)
  })

  it('refuses a size this build does not know', () => {
    expect(parseOnDemandBoxPrefs({ size: 'enormous' }).size).toBeNull()
  })

  /**
   * Per-field, not all-or-nothing: one unreadable member must not discard a
   * good one. A shape guard that wipes the whole record when a single field
   * changes is how a preference silently resets for every install.
   */
  it('keeps a good size alongside an unreadable position', () => {
    const prefs = parseOnDemandBoxPrefs({ size: 'compact', position: { x: 'left' } })
    expect(prefs.size).toBe('compact')
    expect(prefs.position).toBeNull()
  })

  it('keeps a good position alongside an unreadable size', () => {
    const prefs = parseOnDemandBoxPrefs({ size: 7, position: { x: 10, y: 20 } })
    expect(prefs.size).toBeNull()
    expect(prefs.position).toEqual({ x: 10, y: 20 })
  })

  it('refuses a non-finite coordinate rather than laying out against NaN', () => {
    expect(parseOnDemandBoxPrefs({ position: { x: Number.NaN, y: 0 } }).position).toBeNull()
    expect(parseOnDemandBoxPrefs({ position: { x: 0, y: Number.POSITIVE_INFINITY } }).position)
      .toBeNull()
  })

  it('accepts the origin — {x:0,y:0} is a position, not an absence', () => {
    expect(parseOnDemandBoxPrefs({ position: { x: 0, y: 0 } }).position).toEqual({ x: 0, y: 0 })
  })
})

describe('the size to lay out with', () => {
  it('is the stored one when there is one', () => {
    expect(resolveOnDemandSize({ size: 'compact', position: null })).toBe('compact')
  })

  /** ABSENT ⇒ the default, resolved on read and never written to storage. */
  it('is the default when absent', () => {
    expect(resolveOnDemandSize(ONDEMAND_BOX_DEFAULTS)).toBe(DEFAULT_ONDEMAND_SIZE)
  })
})

describe('opening and closing', () => {
  beforeEach(() => {
    useOnDemandPlayerStore.setState({ request: null, prefs: ONDEMAND_BOX_DEFAULTS })
  })

  it('starts closed', () => {
    expect(useOnDemandPlayerStore.getState().request).toBeNull()
  })

  it('opens with the camera and the instant', () => {
    openOnDemandPlayer({ deviceId: 101, atMs: 1_700_000_000_000 })
    expect(useOnDemandPlayerStore.getState().request).toEqual({
      deviceId: 101,
      atMs: 1_700_000_000_000,
    })
  })

  /**
   * One verb for open and retarget. A second `open` must move the pointer, not
   * refuse — otherwise every reel card is silently inert while a player is up.
   */
  it('RETARGETS an open player instead of refusing', () => {
    openOnDemandPlayer({ deviceId: 101, atMs: 1 })
    openOnDemandPlayer({ deviceId: 616, atMs: 2 })
    expect(useOnDemandPlayerStore.getState().request).toEqual({ deviceId: 616, atMs: 2 })
  })

  it('closes', () => {
    openOnDemandPlayer({ deviceId: 101, atMs: 1 })
    useOnDemandPlayerStore.getState().close()
    expect(useOnDemandPlayerStore.getState().request).toBeNull()
  })

  /**
   * The box is a preference about the SCREEN, the open request is about this
   * moment. Closing the player must not forget where the operator likes it.
   */
  it('keeps the box preferences across a close', () => {
    useOnDemandPlayerStore.getState().setSize('large')
    useOnDemandPlayerStore.getState().setPosition({ x: 20, y: 30 })
    openOnDemandPlayer({ deviceId: 101, atMs: 1 })
    useOnDemandPlayerStore.getState().close()
    expect(useOnDemandPlayerStore.getState().prefs).toEqual({
      size: 'large',
      position: { x: 20, y: 30 },
    })
  })

  /**
   * The overlay must survive a camera swap in the reel (and any other
   * navigation): the request lives in this module-level store, above the
   * navigator, so nothing a SCREEN does can clear it.
   *
   * What this proves and what it does not: it proves the STATE survives
   * arbitrary screen churn, which is the half that could have been got wrong
   * here. It does not prove the mounted component survives — that rests on
   * `OnDemandPlayerHost` being a sibling of `<Stack>` in
   * `app/(app)/_layout.tsx` and reading nothing from the router, and it was
   * not verified at runtime.
   */
  it('keeps the open request across anything a screen does', () => {
    openOnDemandPlayer({ deviceId: 101, atMs: 1_700_000_000_000 })
    // Whatever a screen remount does, it cannot reach this store's request.
    useOnDemandPlayerStore.getState().setSize('large')
    useOnDemandPlayerStore.getState().setPosition({ x: 5, y: 5 })
    expect(useOnDemandPlayerStore.getState().request).toEqual({
      deviceId: 101,
      atMs: 1_700_000_000_000,
    })
  })

  it('changing one box field leaves the other alone', () => {
    useOnDemandPlayerStore.getState().setSize('compact')
    useOnDemandPlayerStore.getState().setPosition({ x: 1, y: 2 })
    useOnDemandPlayerStore.getState().setSize('large')
    expect(useOnDemandPlayerStore.getState().prefs.position).toEqual({ x: 1, y: 2 })
  })
})

describe('opening a camera full-screen takes it out of the overlay', () => {
  beforeEach(() => {
    useOnDemandPlayerStore.setState({ request: null, prefs: ONDEMAND_BOX_DEFAULTS })
  })

  it('closes the overlay when the camera opened IS the one on show', () => {
    openOnDemandPlayer({ deviceId: 101, atMs: 1 })
    focusOnDemandCamera(101)
    expect(useOnDemandPlayerStore.getState().request).toBeNull()
  })

  it('leaves a different camera alone', () => {
    openOnDemandPlayer({ deviceId: 101, atMs: 1 })
    focusOnDemandCamera(616)
    expect(useOnDemandPlayerStore.getState().request).toEqual({ deviceId: 101, atMs: 1 })
  })

  /**
   * The swipe-to-overlay gesture opens the overlay on the camera the operator
   * is STILL LOOKING AT and only then leaves the screen. Focus is therefore a
   * one-shot about ARRIVING somewhere, never a standing condition the overlay
   * is re-judged against — a standing rule would delete that gesture's whole
   * product between the open and the navigation.
   */
  it('an open AFTER the arrival survives — focus is an arrival, not a condition', () => {
    focusOnDemandCamera(101)
    openOnDemandPlayer({ deviceId: 101, atMs: 1 })
    expect(useOnDemandPlayerStore.getState().request).toEqual({ deviceId: 101, atMs: 1 })
  })
})
