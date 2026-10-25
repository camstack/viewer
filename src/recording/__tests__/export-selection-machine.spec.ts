/**
 * The export selection is a STATE OF THE PLAYBACK MACHINE, not a second machine.
 *
 * There is exactly one thing in this app that knows where the playhead is, and
 * the selection's moving end IS the playhead's preview. A parallel reducer
 * holding its own copy of "where the operator is looking" is the failure this
 * file exists to make impossible: the two would drift, and the drawn band would
 * disagree with the range that gets exported.
 *
 * The other half of the feature is a NEGATIVE: while a selection is armed the
 * drag must not LAND. `recorded-track-session.ts` holds the last pushed scrub
 * keyframe on the track until a commit's burst replaces it, so withholding the
 * commit is exactly "show the last frame reached and do not start playback" —
 * the behaviour is native to scrub and is PRESERVED here, not rebuilt.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  initialPlaybackState,
  makePlaybackBridge,
  playbackReducer,
  selectActiveEpoch,
  selectExportSelectionAnchor,
  type PlaybackState,
} from '../playback-machine.js'

const newSink = () => ({
  scrubStart: vi.fn(),
  scrubTo: vi.fn(),
  scrubCommit: vi.fn(),
  seek: vi.fn(),
  goLive: vi.fn(),
})

/** A machine parked in recorded playback at `epoch`. */
function inPlayback(epoch: number): PlaybackState {
  return playbackReducer(initialPlaybackState, { type: 'SEEK', epoch, source: 'timeline' })
}

describe('arming the selection', () => {
  it('anchors at the epoch it is given', () => {
    const s = playbackReducer(inPlayback(5_000), { type: 'SELECTION_BEGIN', epoch: 5_000 })
    expect(selectExportSelectionAnchor(s)).toBe(5_000)
  })

  it('is REFUSED at the live edge — the rec button still means "record the live picture" there', () => {
    const s = playbackReducer(initialPlaybackState, { type: 'SELECTION_BEGIN', epoch: 5_000 })
    expect(selectExportSelectionAnchor(s)).toBeNull()
  })

  it('SELECTION_END drops it and leaves the playhead exactly where it was', () => {
    const armed = playbackReducer(inPlayback(5_000), { type: 'SELECTION_BEGIN', epoch: 5_000 })
    const moved = playbackReducer(armed, { type: 'SCRUB_COMMIT', epoch: 1_000, source: 'timeline' })
    const ended = playbackReducer(moved, { type: 'SELECTION_END' })
    expect(selectExportSelectionAnchor(ended)).toBeNull()
    expect(ended.playhead).toBe(5_000)
    expect(ended.mode).toBe('playback')
  })

  it('GO_LIVE closes it — leaving the recording cannot leave a selection behind', () => {
    const armed = playbackReducer(inPlayback(5_000), { type: 'SELECTION_BEGIN', epoch: 5_000 })
    expect(selectExportSelectionAnchor(playbackReducer(armed, { type: 'GO_LIVE' }))).toBeNull()
  })
})

describe('scrubbing while armed moves the OTHER end and nothing else', () => {
  const armed = playbackReducer(inPlayback(5_000), { type: 'SELECTION_BEGIN', epoch: 5_000 })

  it('a move retargets the preview; the player stays where it is', () => {
    const s = playbackReducer(armed, { type: 'SCRUB_MOVE', epoch: 1_000, source: 'timeline' })
    expect(selectActiveEpoch(s)).toBe(1_000)
    expect(s.playhead).toBe(5_000)
    expect(s.mode).toBe('playback')
  })

  it('the RELEASE keeps the browsed end and arms no seek anchor', () => {
    const s = playbackReducer(armed, { type: 'SCRUB_COMMIT', epoch: 1_000, source: 'timeline' })
    // No seek was issued, so arming an anchor would make the next position
    // report look like a straggler for a seek that never happened.
    expect(s.seekAnchor).toBe(armed.seekAnchor)
    expect(selectActiveEpoch(s)).toBe(1_000)
    expect(s.playhead).toBe(5_000)
  })

  it('the moving end may be BEFORE the anchor — scrubbing back is the normal case', () => {
    const s = playbackReducer(armed, { type: 'SCRUB_COMMIT', epoch: 1_000, source: 'timeline' })
    expect(selectActiveEpoch(s)! < selectExportSelectionAnchor(s)!).toBe(true)
  })

  it('a cluster tap picks the other end too — it does not start playing the event', () => {
    const s = playbackReducer(armed, { type: 'SEEK', epoch: 2_000, source: 'cluster' })
    expect(selectActiveEpoch(s)).toBe(2_000)
    expect(s.playhead).toBe(5_000)
    expect(selectExportSelectionAnchor(s)).toBe(5_000)
  })
})

describe('the bridge: frames are pushed, playback is never landed', () => {
  it('the drag still drives scrubStart/scrubTo, so the last frame reached is shown', () => {
    const sink = newSink()
    const bridge = makePlaybackBridge(
      sink, vi.fn(), { current: 0 }, { current: null },
      () => false, () => false, () => false, { current: null },
      () => true,
    )
    bridge.beginScrub('timeline')
    bridge.moveScrub(1_000, 'timeline')
    expect(sink.scrubStart).toHaveBeenCalled()
    expect(sink.scrubTo).toHaveBeenCalledWith(1_000)
  })

  it('the release does NOT commit — no land, so no playback starts', () => {
    const sink = newSink()
    const bridge = makePlaybackBridge(
      sink, vi.fn(), { current: 0 }, { current: null },
      () => false, () => false, () => false, { current: null },
      () => true,
    )
    bridge.beginScrub('timeline')
    bridge.moveScrub(1_000, 'timeline')
    bridge.commitScrub(1_000, 'timeline')
    expect(sink.scrubCommit).not.toHaveBeenCalled()
  })

  it('a TAP is served as a one-position drag, never as a seek', () => {
    const sink = newSink()
    const bridge = makePlaybackBridge(
      sink, vi.fn(), { current: 0 }, { current: null },
      () => false, () => false, () => false, { current: null },
      () => true,
    )
    bridge.seek(2_000, 'heatmap')
    // A bare `seek` would LAND and start playing. A scrubStart+scrubTo pushes
    // the one frame at that instant and holds it.
    expect(sink.seek).not.toHaveBeenCalled()
    expect(sink.scrubStart).toHaveBeenCalled()
    expect(sink.scrubTo).toHaveBeenCalledWith(2_000)
  })

  it('with NO selection armed the same gestures land as they always did', () => {
    const sink = newSink()
    const bridge = makePlaybackBridge(sink, vi.fn(), { current: 0 })
    bridge.beginScrub('timeline')
    bridge.moveScrub(1_000, 'timeline')
    bridge.commitScrub(1_000, 'timeline')
    bridge.seek(2_000, 'heatmap')
    expect(sink.scrubCommit).toHaveBeenCalled()
    expect(sink.seek).toHaveBeenCalledWith(2_000)
  })

  it('goLive still reaches the player while armed — the way back is never blocked', () => {
    const sink = newSink()
    const bridge = makePlaybackBridge(
      sink, vi.fn(), { current: 0 }, { current: null },
      () => false, () => false, () => false, { current: null },
      () => true,
    )
    bridge.goLive()
    expect(sink.goLive).toHaveBeenCalled()
  })
})

describe('the ±10 s jog trims an armed selection', () => {
  it('a jog while armed moves the FREE END and plays nothing', () => {
    const armed = playbackReducer(inPlayback(100_000), { type: 'SELECTION_BEGIN', epoch: 100_000 })
    const jogged = playbackReducer(armed, { type: 'SEEK', epoch: 90_000, source: 'timeline' })
    expect(selectActiveEpoch(jogged)).toBe(90_000)
    expect(jogged.playhead).toBe(100_000)
    expect(jogged.selectionAnchor).toBe(100_000)
  })

  it('a re-armed selection starts at ZERO length — a discarded one leaves no stretch behind', () => {
    let s = playbackReducer(inPlayback(100_000), { type: 'SELECTION_BEGIN', epoch: 100_000 })
    s = playbackReducer(s, { type: 'SEEK', epoch: 20_000, source: 'timeline' })
    s = playbackReducer(s, { type: 'SELECTION_END' })
    s = playbackReducer(s, { type: 'SELECTION_BEGIN', epoch: selectActiveEpoch(s) ?? 0 })
    expect(selectActiveEpoch(s)).toBe(s.selectionAnchor)
  })
})
