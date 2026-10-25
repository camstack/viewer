import { describe, it, expect, vi } from 'vitest'
import {
  initialPlaybackState,
  MAX_STRAGGLER_REPORTS,
  playbackReducer,
  RECONCILE_TOLERANCE_MS,
  shouldEmit,
  shouldCommit,
  makePlaybackBridge,
  selectActiveEpoch,
  selectPlaybackStatus,
  selectScrubDirection,
  type PlaybackState,
} from '../playback-machine.js'
import { SCRUB_DIRECTION_DEADZONE_MS } from '../scrub-direction.js'

// ── Reducer: mode transitions ──────────────────────────────────────────────
describe('playbackReducer — mode transitions', () => {
  it('starts live with a null playhead + null anchor', () => {
    expect(initialPlaybackState).toEqual({
      mode: 'live',
      playhead: null,
      seekTarget: null,
      seekAnchor: null,
      seekLanded: false,
      stragglerReports: 0,
      liveLocked: false,
      selectionAnchor: null,
      lastSource: null,
      scrubDirection: null,
    })
  })

  it('live → seeking → playback happy path (SCRUB_BEGIN/MOVE/COMMIT)', () => {
    const s1 = playbackReducer(initialPlaybackState, { type: 'SCRUB_BEGIN', source: 'timeline' })
    expect(s1.mode).toBe('seeking')
    expect(s1.seekTarget).toBeNull()
    expect(s1.lastSource).toBe('timeline')

    const s2 = playbackReducer(s1, { type: 'SCRUB_MOVE', epoch: 1000, source: 'timeline' })
    expect(s2.mode).toBe('seeking')
    expect(s2.seekTarget).toBe(1000)

    const s3 = playbackReducer(s2, { type: 'SCRUB_COMMIT', epoch: 1200, source: 'timeline' })
    expect(s3.mode).toBe('playback')
    expect(s3.playhead).toBe(1200)
    expect(s3.seekTarget).toBeNull()
    expect(s3.seekAnchor).toBe(1200)
    expect(s3.seekLanded).toBe(false)
  })

  it('seekTarget is only populated in the seeking mode', () => {
    // playback state → seekTarget must be null
    const playback = playbackReducer(initialPlaybackState, { type: 'SEEK', epoch: 500, source: 'cluster' })
    expect(playback.mode).toBe('playback')
    expect(playback.seekTarget).toBeNull()
    // live state → seekTarget null
    expect(initialPlaybackState.seekTarget).toBeNull()
  })

  it('SEEK arms the anchor and enters playback (from live)', () => {
    const s = playbackReducer(initialPlaybackState, { type: 'SEEK', epoch: 777, source: 'heatmap' })
    expect(s.mode).toBe('playback')
    expect(s.playhead).toBe(777)
    expect(s.seekTarget).toBeNull()
    expect(s.seekAnchor).toBe(777)
    expect(s.seekLanded).toBe(false)
    expect(s.lastSource).toBe('heatmap')
  })

  it('GO_LIVE resets playhead null + anchor null + mode live', () => {
    const seeked: PlaybackState = {
      mode: 'playback',
      playhead: 4242,
      seekTarget: null,
      seekAnchor: 4242,
      seekLanded: true,
      stragglerReports: 0,
      selectionAnchor: null,
      liveLocked: false,
      lastSource: 'cluster',
      scrubDirection: null,
    }
    const s = playbackReducer(seeked, { type: 'GO_LIVE' })
    expect(s.mode).toBe('live')
    expect(s.playhead).toBeNull()
    expect(s.seekTarget).toBeNull()
    expect(s.seekAnchor).toBeNull()
    expect(s.seekLanded).toBe(false)
  })

  it('an unknown action returns the same state reference', () => {
    // @ts-expect-error — exercising the default branch with an invalid action
    expect(playbackReducer(initialPlaybackState, { type: 'NOPE' })).toBe(initialPlaybackState)
  })
})

// ── Reducer: POSITION_REPORT reconciliation (bug #2 + bug #3) ────────────────
describe('playbackReducer — POSITION_REPORT reconciliation', () => {
  it('is ignored while LIVE (bug #2: a stray report cannot flip live to playback)', () => {
    const s = playbackReducer(initialPlaybackState, { type: 'POSITION_REPORT', epoch: 123456 })
    expect(s).toBe(initialPlaybackState)
    expect(s.mode).toBe('live')
    expect(s.playhead).toBeNull()
  })

  it('is ignored while SEEKING (drag target owns the playhead)', () => {
    const seeking: PlaybackState = {
      mode: 'seeking',
      playhead: null,
      seekTarget: 9000,
      seekAnchor: null,
      seekLanded: false,
      stragglerReports: 0,
      liveLocked: false,
      selectionAnchor: null,
      lastSource: 'timeline',
      scrubDirection: null,
    }
    expect(playbackReducer(seeking, { type: 'POSITION_REPORT', epoch: 5000 })).toBe(seeking)
  })

  it('advances the playhead in free-running playback (anchor already cleared)', () => {
    const free: PlaybackState = {
      mode: 'playback',
      playhead: 1000,
      seekTarget: null,
      seekAnchor: null,
      seekLanded: true,
      stragglerReports: 0,
      liveLocked: false,
      selectionAnchor: null,
      lastSource: 'timeline',
      scrubDirection: null,
    }
    const s = playbackReducer(free, { type: 'POSITION_REPORT', epoch: 1500 })
    expect(s.playhead).toBe(1500)
    expect(s.mode).toBe('playback')
  })

  it('DROPS a pre-anchor straggler far from the seek anchor (bug #3)', () => {
    const seeked: PlaybackState = {
      mode: 'playback',
      playhead: 1_000_000,
      seekTarget: null,
      seekAnchor: 1_000_000,
      seekLanded: false,
      stragglerReports: 0,
      selectionAnchor: null,
      liveLocked: false,
      lastSource: 'cluster',
      scrubDirection: null,
    }
    // A near-live straggler report arrives BEFORE the real seek lands → dropped.
    // It is no longer object-IDENTICAL: a drop is now COUNTED, because the
    // straggler window has to terminate (see 'a seek that lands far away still
    // lands'). What matters is unchanged — the playhead does not move and the
    // seek has not landed.
    const s = playbackReducer(seeked, { type: 'POSITION_REPORT', epoch: 2_000_000 })
    expect(s.playhead).toBe(1_000_000)
    expect(s.seekLanded).toBe(false)
    expect(s.stragglerReports).toBe(1)
  })

  it('LANDS a report within tolerance and clears the anchor, then advances (bug #3)', () => {
    const seeked: PlaybackState = {
      mode: 'playback',
      playhead: 1_000_000,
      seekTarget: null,
      seekAnchor: 1_000_000,
      seekLanded: false,
      stragglerReports: 0,
      selectionAnchor: null,
      liveLocked: false,
      lastSource: 'cluster',
      scrubDirection: null,
    }
    const landed = playbackReducer(seeked, {
      type: 'POSITION_REPORT',
      epoch: 1_000_000 + RECONCILE_TOLERANCE_MS,
    })
    expect(landed.seekLanded).toBe(true)
    expect(landed.seekAnchor).toBeNull()
    expect(landed.playhead).toBe(1_000_000 + RECONCILE_TOLERANCE_MS)

    // Subsequent reports now advance freely.
    const advanced = playbackReducer(landed, { type: 'POSITION_REPORT', epoch: 1_005_000 })
    expect(advanced.playhead).toBe(1_005_000)
  })

  it('a report exactly at the tolerance boundary lands; one past it drops', () => {
    const base: PlaybackState = {
      mode: 'playback',
      playhead: 0,
      seekTarget: null,
      seekAnchor: 0,
      seekLanded: false,
      stragglerReports: 0,
      liveLocked: false,
      selectionAnchor: null,
      lastSource: 'timeline',
      scrubDirection: null,
    }
    expect(
      playbackReducer(base, { type: 'POSITION_REPORT', epoch: RECONCILE_TOLERANCE_MS }).seekLanded,
    ).toBe(true)
    const past = playbackReducer(base, {
      type: 'POSITION_REPORT',
      epoch: RECONCILE_TOLERANCE_MS + 1,
    })
    expect(past.seekLanded).toBe(false)
    expect(past.playhead).toBe(0)
  })

  it('re-SEEK re-arms the anchor (a new target drops old-target stragglers)', () => {
    const landed: PlaybackState = {
      mode: 'playback',
      playhead: 1000,
      seekTarget: null,
      seekAnchor: null,
      seekLanded: true,
      stragglerReports: 0,
      liveLocked: false,
      selectionAnchor: null,
      lastSource: 'timeline',
      scrubDirection: null,
    }
    const reSeeked = playbackReducer(landed, { type: 'SEEK', epoch: 5_000_000, source: 'cluster' })
    expect(reSeeked.seekAnchor).toBe(5_000_000)
    expect(reSeeked.seekLanded).toBe(false)
    expect(reSeeked.playhead).toBe(5_000_000)

    // A straggler near the OLD position (1000) is now far from the new anchor → dropped
    // (counted, not identity — the window must terminate).
    const dropped = playbackReducer(reSeeked, { type: 'POSITION_REPORT', epoch: 1000 })
    expect(dropped.seekLanded).toBe(false)
    expect(dropped.playhead).toBe(5_000_000)
    // A report near the NEW anchor lands.
    expect(
      playbackReducer(reSeeked, { type: 'POSITION_REPORT', epoch: 5_000_500 }).seekLanded,
    ).toBe(true)
  })
})

// ── Reducer: EMBED_STATE adoption ────────────────────────────────────────────
describe('playbackReducer — EMBED_STATE', () => {
  const playback: PlaybackState = {
    mode: 'playback',
    playhead: 1000,
    seekTarget: null,
    seekAnchor: null,
    seekLanded: true,
      stragglerReports: 0,
      selectionAnchor: null,
      liveLocked: false,
    lastSource: 'timeline',
    scrubDirection: null,
  }

  it("embed 'live' NEVER overrides a user seek", () => {
    const s = playbackReducer(playback, { type: 'EMBED_STATE', embed: 'live' })
    expect(s).toBe(playback)
    expect(s.mode).toBe('playback')
  })

  it("adopts embed 'gap' only while in playback", () => {
    expect(playbackReducer(playback, { type: 'EMBED_STATE', embed: 'gap' }).mode).toBe('gap')
    // Not adopted from live.
    expect(playbackReducer(initialPlaybackState, { type: 'EMBED_STATE', embed: 'gap' })).toBe(
      initialPlaybackState,
    )
  })

  it("adopts embed 'error' only while in playback", () => {
    expect(playbackReducer(playback, { type: 'EMBED_STATE', embed: 'error' }).mode).toBe('error')
    expect(playbackReducer(initialPlaybackState, { type: 'EMBED_STATE', embed: 'error' })).toBe(
      initialPlaybackState,
    )
  })

  it("ignores transient embed states ('loading'/'playing'/'paused')", () => {
    expect(playbackReducer(playback, { type: 'EMBED_STATE', embed: 'loading' })).toBe(playback)
    expect(playbackReducer(playback, { type: 'EMBED_STATE', embed: 'playing' })).toBe(playback)
    expect(playbackReducer(playback, { type: 'EMBED_STATE', embed: 'paused' })).toBe(playback)
  })
})

// ── Throttle + commit dedupe (ported from scrub-controller) ──────────────────
describe('shouldEmit', () => {
  it('coalesces emits to the throttle window', () => {
    expect(shouldEmit(1000, 1000 + 40)).toBe(true)
    expect(shouldEmit(1000, 1000 + 30)).toBe(false)
  })
})

describe('shouldCommit (drop redundant feeder reloads)', () => {
  it('always commits the first time', () => {
    expect(shouldCommit(null, 1000, 5000)).toBe(true)
  })
  it('drops an exact-duplicate commit within the dedupe window', () => {
    expect(shouldCommit({ epoch: 1000, at: 5000 }, 1000, 5200)).toBe(false)
  })
  it('drops a tiny nudge near the last target within the window', () => {
    expect(shouldCommit({ epoch: 1_000_000, at: 5000 }, 1_000_400, 5300)).toBe(false)
  })
  it('commits a genuinely different (far) target', () => {
    expect(shouldCommit({ epoch: 1_000_000, at: 5000 }, 1_060_000, 5300)).toBe(true)
  })
  it('commits a re-seek to the same spot once the window has elapsed', () => {
    expect(shouldCommit({ epoch: 1000, at: 5000 }, 1000, 5000 + 3000)).toBe(true)
  })
})

// ── Pure bridge wiring (ported + adapted to the new action names) ────────────
describe('makePlaybackBridge (sink wiring)', () => {
  const newSink = () => ({
    scrubStart: vi.fn(),
    scrubTo: vi.fn(),
    scrubCommit: vi.fn(),
    seek: vi.fn(),
    goLive: vi.fn(),
  })

  it('drives the sink across a drag (begin→move→commit)', () => {
    const sink = newSink()
    const bridge = makePlaybackBridge(sink, vi.fn(), { current: 0 })
    bridge.beginScrub('timeline')
    bridge.moveScrub(6000, 'timeline')
    bridge.commitScrub(6000, 'timeline')
    expect(sink.scrubStart).toHaveBeenCalled()
    expect(sink.scrubTo).toHaveBeenCalledWith(6000)
    // The commit carries the SAME dragId the drag's scrubStart got.
    const dragId = sink.scrubStart.mock.calls[0]?.[0] as string
    expect(typeof dragId).toBe('string')
    expect(sink.scrubCommit).toHaveBeenCalledWith(6000, dragId)
  })

  it('a commit with no preceding drag carries no dragId (bare call, matching a hint-less scrubTo)', () => {
    const sink = newSink()
    const bridge = makePlaybackBridge(sink, vi.fn(), { current: 0 })
    bridge.commitScrub(6000, 'heatmap')
    expect(sink.scrubCommit).toHaveBeenCalledWith(6000)
  })

  // ── The load-bearing dragId contract ────────────────────────────────────────
  // The whole point of C1: two consecutive gestures must NOT share an id (or
  // the hub's join would merge two unrelated drags into one), and every line
  // ONE gesture produces — its scrubStart and its scrubCommit — must carry the
  // SAME id (or the join finds nothing). Both are asserted here from the sink
  // calls a real drag drives, disarmed once to confirm they fail without the
  // wiring: with `beginScrub` reverted to call `sink.scrubStart()` bare and
  // `commitScrub` to call `sink.scrubCommit(epoch)` bare, this test goes red.
  it('mints a fresh dragId per gesture, and carries one gesture id through its own scrubStart+commit', () => {
    const sink = newSink()
    const bridge = makePlaybackBridge(sink, vi.fn(), { current: 0 })

    bridge.beginScrub('timeline')
    bridge.commitScrub(1_000, 'timeline')
    const firstStart = sink.scrubStart.mock.calls[0]?.[0] as string
    const firstCommit = sink.scrubCommit.mock.calls[0]?.[1] as string
    expect(firstStart).toBe(firstCommit)

    bridge.beginScrub('timeline')
    bridge.commitScrub(2_000, 'timeline')
    const secondStart = sink.scrubStart.mock.calls[1]?.[0] as string
    const secondCommit = sink.scrubCommit.mock.calls[1]?.[1] as string
    expect(secondStart).toBe(secondCommit)

    // Two consecutive gestures never share an id.
    expect(secondStart).not.toBe(firstStart)
  })

  it('adoptSeek moves the machine into playback WITHOUT driving the sink', () => {
    const sink = newSink()
    const dispatched: unknown[] = []
    const bridge = makePlaybackBridge(sink, (a) => dispatched.push(a), { current: 0 })
    bridge.adoptSeek(9000, 'cluster')
    expect(sink.seek).not.toHaveBeenCalled()
    expect(sink.scrubCommit).not.toHaveBeenCalled()
    expect(dispatched).toEqual([{ type: 'SEEK', epoch: 9000, source: 'cluster' }])
  })

  it('an adopted seek arms the commit dedupe like a real one (no redundant feeder reload)', () => {
    const sink = newSink()
    const bridge = makePlaybackBridge(sink, vi.fn(), { current: 0 }, { current: null })
    bridge.adoptSeek(9000, 'cluster')
    bridge.seek(9000, 'cluster')
    expect(sink.seek).not.toHaveBeenCalled()
  })

  it('a tap issues a direct seek', () => {
    const sink = newSink()
    const bridge = makePlaybackBridge(sink, vi.fn(), { current: 0 })
    bridge.seek(6000, 'cluster')
    expect(sink.seek).toHaveBeenCalledWith(6000)
  })

  it('goLive drives the sink goLive', () => {
    const sink = newSink()
    const bridge = makePlaybackBridge(sink, vi.fn(), { current: 0 })
    bridge.goLive()
    expect(sink.goLive).toHaveBeenCalled()
  })

  it('dispatches the discriminated-union action for each gesture', () => {
    const sink = newSink()
    const dispatch = vi.fn()
    const bridge = makePlaybackBridge(sink, dispatch, { current: 0 })
    bridge.beginScrub('timeline')
    bridge.moveScrub(1000, 'timeline')
    bridge.commitScrub(1200, 'timeline')
    bridge.seek(500, 'heatmap')
    bridge.goLive()
    bridge.reportPosition(9000)
    bridge.reportEmbedState('gap')
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'SCRUB_BEGIN', source: 'timeline' })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'SCRUB_MOVE', epoch: 1000, source: 'timeline' })
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: 'SCRUB_COMMIT', epoch: 1200, source: 'timeline' })
    expect(dispatch).toHaveBeenNthCalledWith(4, { type: 'SEEK', epoch: 500, source: 'heatmap' })
    expect(dispatch).toHaveBeenNthCalledWith(5, { type: 'GO_LIVE' })
    expect(dispatch).toHaveBeenNthCalledWith(6, { type: 'POSITION_REPORT', epoch: 9000 })
    expect(dispatch).toHaveBeenNthCalledWith(7, { type: 'EMBED_STATE', embed: 'gap' })
  })

  it('drops a duplicate commit fired twice in quick succession', () => {
    const sink = newSink()
    const lastCommitRef = { current: null as { epoch: number; at: number } | null }
    const bridge = makePlaybackBridge(sink, vi.fn(), { current: 0 }, lastCommitRef)
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(5000)
    bridge.commitScrub(1000, 'heatmap')
    nowSpy.mockReturnValue(5200)
    bridge.commitScrub(1000, 'heatmap')
    nowSpy.mockRestore()
    expect(sink.scrubCommit).toHaveBeenCalledTimes(1)
    expect(sink.scrubCommit).toHaveBeenCalledWith(1000)
  })

  it('drops a seek that duplicates the last commit, but allows a far one', () => {
    const sink = newSink()
    const lastCommitRef = { current: null as { epoch: number; at: number } | null }
    const bridge = makePlaybackBridge(sink, vi.fn(), { current: 0 }, lastCommitRef)
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(5000)
    bridge.seek(1_000_000, 'heatmap')
    nowSpy.mockReturnValue(5100)
    bridge.seek(1_000_100, 'heatmap')
    nowSpy.mockReturnValue(5200)
    bridge.seek(2_000_000, 'heatmap')
    nowSpy.mockRestore()
    expect(sink.seek).toHaveBeenCalledTimes(2)
    expect(sink.seek).toHaveBeenNthCalledWith(1, 1_000_000)
    expect(sink.seek).toHaveBeenNthCalledWith(2, 2_000_000)
  })

  it('still dispatches the state action even when the commit is deduped', () => {
    const sink = newSink()
    const dispatch = vi.fn()
    const bridge = makePlaybackBridge(sink, dispatch, { current: 0 }, { current: null })
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(5000)
    bridge.commitScrub(1000, 'heatmap')
    nowSpy.mockReturnValue(5200)
    bridge.commitScrub(1000, 'heatmap')
    nowSpy.mockRestore()
    expect(dispatch).toHaveBeenCalledWith({ type: 'SCRUB_COMMIT', epoch: 1000, source: 'heatmap' })
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('never dedupes a commit while the player is LIVE (live→recorded must reach the server)', () => {
    const sink = newSink()
    const lastCommitRef = { current: null as { epoch: number; at: number } | null }
    let live = true
    const bridge = makePlaybackBridge(sink, vi.fn(), { current: 0 }, lastCommitRef, () => live)
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(5000)
    bridge.seek(1_000_000, 'timeline')
    nowSpy.mockReturnValue(5100)
    bridge.seek(1_000_000, 'timeline')
    live = false
    nowSpy.mockReturnValue(5200)
    bridge.seek(1_000_000, 'timeline')
    nowSpy.mockRestore()
    expect(sink.seek).toHaveBeenCalledTimes(2)
  })

  it('throttles continuous moves via the shared lastEmitRef', () => {
    const sink = newSink()
    const lastEmitRef = { current: 0 }
    const bridge = makePlaybackBridge(sink, vi.fn(), lastEmitRef)
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1000)
    bridge.moveScrub(100, 'timeline')
    nowSpy.mockReturnValue(1030)
    bridge.moveScrub(200, 'timeline')
    nowSpy.mockReturnValue(1100)
    bridge.moveScrub(300, 'timeline')
    nowSpy.mockRestore()
    expect(sink.scrubTo).toHaveBeenCalledTimes(2)
    expect(sink.scrubTo).toHaveBeenNthCalledWith(1, 100)
    expect(sink.scrubTo).toHaveBeenNthCalledWith(2, 300)
  })
})

// ── Selectors ────────────────────────────────────────────────────────────────
describe('selectActiveEpoch', () => {
  it('uses seekTarget while seeking, else the playhead', () => {
    expect(
      selectActiveEpoch({
        mode: 'seeking',
        playhead: 100,
        seekTarget: 250,
        seekAnchor: null,
        seekLanded: false,
      stragglerReports: 0,
      selectionAnchor: null,
      liveLocked: false,
        lastSource: 'timeline',
        scrubDirection: null,
        }),
    ).toBe(250)
    expect(
      selectActiveEpoch({
        mode: 'playback',
        playhead: 100,
        seekTarget: null,
        seekAnchor: null,
        seekLanded: true,
      stragglerReports: 0,
      selectionAnchor: null,
      liveLocked: false,
        lastSource: 'timeline',
        scrubDirection: null,
        }),
    ).toBe(100)
  })
  it('is null while live', () => {
    expect(selectActiveEpoch(initialPlaybackState)).toBeNull()
  })
})

describe('selectPlaybackStatus', () => {
  it('reports LIVE while live', () => {
    expect(selectPlaybackStatus(initialPlaybackState)).toEqual({
      isLive: true,
      label: 'LIVE',
      showGoLive: false,
    })
  })
  it('reports the playhead clock while in playback', () => {
    const epoch = new Date('2026-06-16T12:47:03Z').getTime()
    const r = selectPlaybackStatus({
      mode: 'playback',
      playhead: epoch,
      seekTarget: null,
      seekAnchor: null,
      seekLanded: true,
      stragglerReports: 0,
      liveLocked: false,
      selectionAnchor: null,
      lastSource: 'timeline',
      scrubDirection: null,
    })
    expect(r.isLive).toBe(false)
    expect(r.showGoLive).toBe(true)
    expect(r.label).toMatch(/\d{2}:47:03$/)
  })
  it('reports the seek preview clock while seeking', () => {
    const epoch = new Date('2026-06-16T09:15:30Z').getTime()
    const r = selectPlaybackStatus({
      mode: 'seeking',
      playhead: null,
      seekTarget: epoch,
      seekAnchor: null,
      seekLanded: false,
      stragglerReports: 0,
      liveLocked: false,
      selectionAnchor: null,
      lastSource: 'timeline',
      scrubDirection: null,
    })
    expect(r.isLive).toBe(false)
    expect(r.label).toMatch(/\d{2}:15:30$/)
  })
  it('reports the gap + error labels', () => {
    const gap: PlaybackState = {
      mode: 'gap',
      playhead: null,
      seekTarget: null,
      seekAnchor: null,
      seekLanded: false,
      stragglerReports: 0,
      liveLocked: false,
      selectionAnchor: null,
      lastSource: 'timeline',
      scrubDirection: null,
    }
    expect(selectPlaybackStatus(gap).label).toBe('No footage')
    expect(selectPlaybackStatus({ ...gap, mode: 'error' }).label).toBe('Error')
  })
})

/**
 * The straggler window is bounded by REPORTS, not by distance.
 *
 * Measured on 2026-08-01, camera 101: the operator sought a moment with no
 * footage, the feeder legitimately snapped to the nearest segment 151 s and
 * 251 s away, and every position report was then further than
 * RECONCILE_TOLERANCE_MS (1500 ms) from the anchor. Every one was dropped as a
 * "pre-seek straggler", `seekLanded` never became true, and the indicator sat
 * frozen on the REQUESTED time while the stream played the one the server had
 * actually landed on:
 *
 *   deltaMs -251145 / -151519 · indicatorEpoch === seekAnchor · seekLanded false
 *
 * The rejection exists to drop reports still in flight from BEFORE the seek.
 * Those are bounded by the round trip — one or two at the ~1 Hz cadence — never
 * by how far away they are.
 */
describe('a seek that lands far away still lands', () => {
  const seek = (epoch: number): PlaybackState =>
    playbackReducer(initialPlaybackState, { type: 'SEEK', epoch, source: 'timeline' })

  it('adopts a distant position once the straggler window is spent', () => {
    let state = seek(1_000_000)
    const far = 1_000_000 + 251_145
    for (let i = 1; i < MAX_STRAGGLER_REPORTS; i += 1) {
      state = playbackReducer(state, { type: 'POSITION_REPORT', epoch: far })
      expect(state.seekLanded).toBe(false)
      expect(state.playhead).toBe(1_000_000) // still frozen, still rejecting
    }
    state = playbackReducer(state, { type: 'POSITION_REPORT', epoch: far })
    expect(state.seekLanded).toBe(true)
    expect(state.playhead).toBe(far)
    expect(state.seekAnchor).toBeNull()
  })

  it('still lands IMMEDIATELY when the server hits the mark', () => {
    // The straggler budget must not delay the ordinary case by three reports.
    const state = playbackReducer(seek(1_000_000), {
      type: 'POSITION_REPORT',
      epoch: 1_000_400,
    })
    expect(state.seekLanded).toBe(true)
    expect(state.playhead).toBe(1_000_400)
  })

  it('a new seek re-arms the budget', () => {
    // Otherwise a session that spent its stragglers once would adopt the FIRST
    // report of every later seek, including a genuine pre-seek straggler.
    let state = seek(1_000_000)
    state = playbackReducer(state, { type: 'POSITION_REPORT', epoch: 9_000_000 })
    expect(state.stragglerReports).toBe(1)
    state = playbackReducer(state, { type: 'SEEK', epoch: 2_000_000, source: 'timeline' })
    expect(state.stragglerReports).toBe(0)
    expect(state.seekLanded).toBe(false)
  })

  it('free-running playback still advances with no anchor armed', () => {
    let state = seek(1_000_000)
    state = playbackReducer(state, { type: 'POSITION_REPORT', epoch: 1_000_100 })
    state = playbackReducer(state, { type: 'POSITION_REPORT', epoch: 1_005_000 })
    expect(state.playhead).toBe(1_005_000)
  })
})

// ── Scrub direction ─────────────────────────────────────────────────────────
describe('playbackReducer — scrub direction', () => {
  const step = SCRUB_DIRECTION_DEADZONE_MS + 1

  it('begins a drag with no direction — one sample cannot have one', () => {
    const state = playbackReducer(initialPlaybackState, { type: 'SCRUB_BEGIN', source: 'timeline' })
    expect(state.scrubDirection).toBeNull()
    expect(selectScrubDirection(state)).toBeNull()
  })

  it('derives the direction from the target it already retargets', () => {
    let state = playbackReducer(initialPlaybackState, { type: 'SCRUB_BEGIN', source: 'timeline' })
    state = playbackReducer(state, { type: 'SCRUB_MOVE', epoch: 1_000_000, source: 'timeline' })
    // First move: nothing to measure against (live edge → playhead is null).
    expect(state.scrubDirection).toBeNull()
    state = playbackReducer(state, { type: 'SCRUB_MOVE', epoch: 1_000_000 + step, source: 'timeline' })
    expect(state.scrubDirection).toBe('forward')
    state = playbackReducer(state, { type: 'SCRUB_MOVE', epoch: 1_000_000 - step, source: 'timeline' })
    expect(state.scrubDirection).toBe('backward')
  })

  it('measures the FIRST move of a recorded drag against the playhead', () => {
    // Scrubbing away from a recorded position has a reference from move one, so
    // the arrow appears immediately rather than after a second frame.
    let state = playbackReducer(initialPlaybackState, { type: 'SEEK', epoch: 5_000_000, source: 'timeline' })
    state = playbackReducer(state, { type: 'SCRUB_BEGIN', source: 'timeline' })
    state = playbackReducer(state, { type: 'SCRUB_MOVE', epoch: 5_000_000 - step, source: 'timeline' })
    expect(state.scrubDirection).toBe('backward')
  })

  it('holds through jitter instead of flickering', () => {
    let state = playbackReducer(initialPlaybackState, { type: 'SEEK', epoch: 5_000_000, source: 'timeline' })
    state = playbackReducer(state, { type: 'SCRUB_BEGIN', source: 'timeline' })
    state = playbackReducer(state, { type: 'SCRUB_MOVE', epoch: 5_000_000 + step, source: 'timeline' })
    expect(state.scrubDirection).toBe('forward')
    state = playbackReducer(state, { type: 'SCRUB_MOVE', epoch: 5_000_000 + step - 1, source: 'timeline' })
    expect(state.scrubDirection).toBe('forward')
  })

  it('clears the direction on commit, seek and go-live — the button comes back', () => {
    let scrubbing = playbackReducer(initialPlaybackState, { type: 'SEEK', epoch: 5_000_000, source: 'timeline' })
    scrubbing = playbackReducer(scrubbing, { type: 'SCRUB_BEGIN', source: 'timeline' })
    scrubbing = playbackReducer(scrubbing, { type: 'SCRUB_MOVE', epoch: 5_000_000 + step, source: 'timeline' })
    expect(scrubbing.scrubDirection).toBe('forward')

    expect(
      playbackReducer(scrubbing, { type: 'SCRUB_COMMIT', epoch: 5_001_000, source: 'timeline' })
        .scrubDirection,
    ).toBeNull()
    expect(
      playbackReducer(scrubbing, { type: 'SEEK', epoch: 5_001_000, source: 'timeline' }).scrubDirection,
    ).toBeNull()
    expect(playbackReducer(scrubbing, { type: 'GO_LIVE' }).scrubDirection).toBeNull()
  })

  it('reports no direction outside a drag, whatever the field holds', () => {
    // The selector is what the button reads: a stale direction surviving into
    // playback would replace play/pause with an arrow that never goes away.
    const stale: PlaybackState = {
      ...initialPlaybackState,
      mode: 'playback',
      scrubDirection: 'forward',
    }
    expect(selectScrubDirection(stale)).toBeNull()
  })
})

// ── Live lock ────────────────────────────────────────────────────────────────
/**
 * The lock the operator arms to BROWSE the timeline without taking the picture
 * off the live edge. Every gesture still moves the visible position; none of
 * them moves the player.
 */
describe('playbackReducer — live lock', () => {
  const armed = (state: PlaybackState = initialPlaybackState): PlaybackState =>
    playbackReducer(state, { type: 'SET_LIVE_LOCK', locked: true })

  it('is OFF by default — the bar opens on today behaviour', () => {
    expect(initialPlaybackState.liveLocked).toBe(false)
  })

  it('arms and disarms without moving the playhead', () => {
    const on = armed()
    expect(on.liveLocked).toBe(true)
    expect(on.mode).toBe('live')
    expect(on.playhead).toBeNull()
    const off = playbackReducer(on, { type: 'SET_LIVE_LOCK', locked: false })
    expect(off.liveLocked).toBe(false)
    expect(off.mode).toBe('live')
  })

  it('previews a locked drag WITHOUT entering recorded playback', () => {
    let state = armed()
    state = playbackReducer(state, { type: 'SCRUB_BEGIN', source: 'timeline' })
    expect(state.mode).toBe('live')
    state = playbackReducer(state, { type: 'SCRUB_MOVE', epoch: 1_000_000, source: 'timeline' })
    expect(state.mode).toBe('live')
    expect(state.playhead).toBeNull()
    // The visible position DOES follow the finger — that is the whole point.
    expect(state.seekTarget).toBe(1_000_000)
    expect(selectActiveEpoch(state)).toBe(1_000_000)
  })

  it('keeps the browsed position past the release, and the picture on LIVE', () => {
    let state = armed()
    state = playbackReducer(state, { type: 'SCRUB_BEGIN', source: 'timeline' })
    state = playbackReducer(state, { type: 'SCRUB_MOVE', epoch: 1_000_000, source: 'timeline' })
    state = playbackReducer(state, { type: 'SCRUB_COMMIT', epoch: 1_002_000, source: 'timeline' })
    expect(state.mode).toBe('live')
    expect(state.playhead).toBeNull()
    // No anchor is armed: there is no seek in flight to reconcile against.
    expect(state.seekAnchor).toBeNull()
    expect(state.seekTarget).toBe(1_002_000)
    expect(selectPlaybackStatus(state).isLive).toBe(true)
  })

  it('previews a locked heatmap tap WITHOUT leaving live', () => {
    const state = playbackReducer(armed(), { type: 'SEEK', epoch: 4_242_000, source: 'heatmap' })
    expect(state.mode).toBe('live')
    expect(state.playhead).toBeNull()
    expect(state.seekAnchor).toBeNull()
    expect(state.seekTarget).toBe(4_242_000)
    expect(state.liveLocked).toBe(true)
  })

  it('a locked cluster tap (event) unlocks and enters recorded playback', () => {
    const state = playbackReducer(armed(), { type: 'SEEK', epoch: 4_242_000, source: 'cluster' })
    expect(state.liveLocked).toBe(false)
    expect(state.mode).toBe('playback')
    expect(state.playhead).toBe(4_242_000)
    expect(state.seekAnchor).toBe(4_242_000)
    expect(state.seekTarget).toBeNull()
  })

  it('GO_LIVE still snaps back, and KEEPS the lock armed', () => {
    let state = playbackReducer(armed(), { type: 'SEEK', epoch: 4_242_000, source: 'heatmap' })
    state = playbackReducer(state, { type: 'GO_LIVE' })
    expect(state.mode).toBe('live')
    expect(state.seekTarget).toBeNull()
    expect(state.liveLocked).toBe(true)
    expect(selectActiveEpoch(state)).toBeNull()
  })

  it('unlocking drops the preview and restores scrub = playback', () => {
    let state = playbackReducer(armed(), { type: 'SEEK', epoch: 4_242_000, source: 'timeline' })
    state = playbackReducer(state, { type: 'SET_LIVE_LOCK', locked: false })
    expect(state.seekTarget).toBeNull()
    expect(selectActiveEpoch(state)).toBeNull()

    const seeked = playbackReducer(state, { type: 'SEEK', epoch: 2_000_000, source: 'timeline' })
    expect(seeked.mode).toBe('playback')
    expect(seeked.playhead).toBe(2_000_000)
    expect(seeked.seekAnchor).toBe(2_000_000)
    expect(seeked.seekLanded).toBe(false)
  })

  it('leaves a recorded playhead where it is when the lock is armed mid-playback', () => {
    // The lock anchors the PICTURE; browsing must not drag it anywhere, live
    // edge or not. The way back to live remains the Live control.
    let state = playbackReducer(initialPlaybackState, { type: 'SEEK', epoch: 9_000_000, source: 'timeline' })
    state = playbackReducer(state, { type: 'SET_LIVE_LOCK', locked: true })
    expect(state.mode).toBe('playback')
    expect(state.playhead).toBe(9_000_000)
    state = playbackReducer(state, { type: 'SCRUB_MOVE', epoch: 3_000_000, source: 'timeline' })
    expect(state.mode).toBe('playback')
    expect(state.playhead).toBe(9_000_000)
    expect(selectActiveEpoch(state)).toBe(3_000_000)
  })
})

describe('makePlaybackBridge — live lock', () => {
  const newSink = () => ({
    scrubStart: vi.fn(),
    scrubTo: vi.fn(),
    scrubCommit: vi.fn(),
    seek: vi.fn(),
    goLive: vi.fn(),
  })

  it('never drives the sink out of live while the lock is armed', () => {
    const sink = newSink()
    let locked = true
    const bridge = makePlaybackBridge(
      sink,
      vi.fn(),
      { current: 0 },
      { current: null },
      () => false,
      () => locked,
    )
    bridge.beginScrub('timeline')
    bridge.moveScrub(1_000_000, 'timeline')
    bridge.commitScrub(1_002_000, 'timeline')
    bridge.seek(500, 'heatmap')
    expect(sink.scrubStart).not.toHaveBeenCalled()
    expect(sink.scrubTo).not.toHaveBeenCalled()
    expect(sink.scrubCommit).not.toHaveBeenCalled()
    expect(sink.seek).not.toHaveBeenCalled()

    // An event (cluster) tap must reach the player even while locked —
    // the lock is for browsing the timeline, not for blocking recorded
    // playback of a tapped event.
    bridge.seek(500, 'cluster')
    expect(sink.seek).toHaveBeenCalledWith(500)
  })

  it('still drives GO_LIVE while locked when the picture is off live', () => {
    // Lock armed mid-recording: snapping home must return the picture to live.
    const sink = newSink()
    const bridge = makePlaybackBridge(
      sink,
      vi.fn(),
      { current: 0 },
      { current: null },
      () => false,
      () => true,
      () => false,
    )
    bridge.goLive()
    expect(sink.goLive).toHaveBeenCalled()
  })

  it('does not remount the stream when snapping home while already live-locked', () => {
    // Browse events under the lock, then scroll back to today: GO_LIVE still
    // clears the timeline preview, but the picture never left live — remounting
    // the WebRTC session is the "stream restarted" the operator reported.
    const sink = newSink()
    const dispatch = vi.fn()
    const bridge = makePlaybackBridge(
      sink,
      dispatch,
      { current: 0 },
      { current: null },
      () => true,
      () => true,
      () => true,
    )
    bridge.goLive()
    expect(dispatch).toHaveBeenCalledWith({ type: 'GO_LIVE' })
    expect(sink.goLive).not.toHaveBeenCalled()
  })

  it('still dispatches the preview actions while locked (the timeline moves)', () => {
    const dispatch = vi.fn()
    const bridge = makePlaybackBridge(
      newSink(),
      dispatch,
      { current: 0 },
      { current: null },
      () => false,
      () => true,
    )
    bridge.moveScrub(1_000_000, 'timeline')
    bridge.commitScrub(1_002_000, 'timeline')
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: 'SCRUB_MOVE',
      epoch: 1_000_000,
      source: 'timeline',
    })
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: 'SCRUB_COMMIT',
      epoch: 1_002_000,
      source: 'timeline',
    })
  })

  it('toggleLiveLock flips the flag it is shown', () => {
    const dispatch = vi.fn()
    let locked = false
    const bridge = makePlaybackBridge(
      newSink(),
      dispatch,
      { current: 0 },
      { current: null },
      () => false,
      () => locked,
    )
    bridge.toggleLiveLock()
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'SET_LIVE_LOCK', locked: true })
    locked = true
    bridge.toggleLiveLock()
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'SET_LIVE_LOCK', locked: false })
  })

  it('defaults to UNLOCKED when no getter is supplied (existing call sites)', () => {
    const sink = newSink()
    const bridge = makePlaybackBridge(sink, vi.fn(), { current: 0 })
    bridge.seek(6000, 'cluster')
    expect(sink.seek).toHaveBeenCalledWith(6000)
  })
})
