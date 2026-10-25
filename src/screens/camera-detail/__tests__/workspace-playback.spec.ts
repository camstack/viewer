import { describe, it, expect, vi } from 'vitest'
import {
  fanOutPlaybackToWall,
  type WallPlayback,
} from '../workspace-playback.js'
import {
  createGridPlaybackBus,
  type GridPlaybackSink,
} from '../../../live/playback-bus.js'

/** A sink that records the verbs it received, in order. */
function recordingSink(): { sink: GridPlaybackSink; log: string[] } {
  const log: string[] = []
  return {
    log,
    sink: {
      scrubStart: () => log.push('scrubStart'),
      scrubTo: (ms) => log.push(`scrubTo:${ms}`),
      scrubCommit: (ms) => log.push(`scrubCommit:${ms}`),
      seek: (ms) => log.push(`seek:${ms}`),
      setRate: (r) => log.push(`setRate:${r}`),
      goLive: () => log.push('goLive'),
    },
  }
}

function primaryHandlers(): { handlers: WallPlayback; log: string[] } {
  const log: string[] = []
  return {
    log,
    handlers: {
      onSeek: (ms) => log.push(`seek:${ms}`),
      onScrubBegin: () => log.push('scrubStart'),
      onScrubMove: (ms) => log.push(`scrubTo:${ms}`),
      onScrubCommit: (ms) => log.push(`scrubCommit:${ms}`),
      onGoLive: () => log.push('goLive'),
      onTogglePlayPause: () => log.push('toggle'),
      onSelectRate: (r) => log.push(`rate:${r}`),
    },
  }
}

describe('the controls that stayed on the timebar act on EVERY camera in the view', () => {
  it('a seek reaches the picture and the wall', () => {
    const primary = primaryHandlers()
    const wallA = recordingSink()
    const wallB = recordingSink()
    const bus = createGridPlaybackBus()
    bus.register('a', wallA.sink)
    bus.register('b', wallB.sink)

    const out = fanOutPlaybackToWall({
      primary: primary.handlers,
      broadcast: bus.broadcast,
      paused: false,
    })
    out.onSeek(1_700_000_000_000, 'timeline')

    expect(primary.log).toEqual(['seek:1700000000000'])
    expect(wallA.log).toEqual(['seek:1700000000000'])
    expect(wallB.log).toEqual(['seek:1700000000000'])
  })

  it('the whole drag travels — begin, moves, and the one commit', () => {
    const primary = primaryHandlers()
    const wall = recordingSink()
    const bus = createGridPlaybackBus()
    bus.register('wall', wall.sink)
    const out = fanOutPlaybackToWall({
      primary: primary.handlers,
      broadcast: bus.broadcast,
      paused: false,
    })

    out.onScrubBegin('timeline')
    out.onScrubMove(100, 'timeline', { mode: 'fine', velocityPxPerS: 12 })
    out.onScrubMove(200, 'timeline')
    out.onScrubCommit(200, 'timeline')

    expect(wall.log).toEqual(['scrubStart', 'scrubTo:100', 'scrubTo:200', 'scrubCommit:200'])
    expect(primary.log).toEqual(wall.log)
  })

  it('go-live returns the whole view to the edge, not only the picture', () => {
    const primary = primaryHandlers()
    const wall = recordingSink()
    const bus = createGridPlaybackBus()
    bus.register('wall', wall.sink)
    fanOutPlaybackToWall({
      primary: primary.handlers,
      broadcast: bus.broadcast,
      paused: false,
    }).onGoLive()
    expect(wall.log).toEqual(['goLive'])
  })

  it('play/pause sends the state the toggle PRODUCES, not the one it left', () => {
    const wall = recordingSink()
    const bus = createGridPlaybackBus()
    bus.register('wall', wall.sink)

    // Playing → the tap pauses everything.
    fanOutPlaybackToWall({
      primary: primaryHandlers().handlers,
      broadcast: bus.broadcast,
      paused: false,
    }).onTogglePlayPause()
    expect(wall.log).toEqual(['setRate:0'])

    // Paused → the tap resumes everything.
    wall.log.length = 0
    fanOutPlaybackToWall({
      primary: primaryHandlers().handlers,
      broadcast: bus.broadcast,
      paused: true,
    }).onTogglePlayPause()
    expect(wall.log).toEqual(['setRate:1'])
  })

  it('a speed change applies to every camera', () => {
    const wall = recordingSink()
    const bus = createGridPlaybackBus()
    bus.register('wall', wall.sink)
    fanOutPlaybackToWall({
      primary: primaryHandlers().handlers,
      broadcast: bus.broadcast,
      paused: false,
    }).onSelectRate(2)
    expect(wall.log).toEqual(['setRate:2'])
  })

  it('the picture is driven FIRST — it is the surface the operator is watching', () => {
    const order: string[] = []
    const primary: WallPlayback = {
      onSeek: () => order.push('picture'),
      onScrubBegin: () => undefined,
      onScrubMove: () => undefined,
      onScrubCommit: () => undefined,
      onGoLive: () => undefined,
      onTogglePlayPause: () => undefined,
      onSelectRate: () => undefined,
    }
    const broadcast = vi.fn(() => {
      order.push('wall')
      return 1
    })
    fanOutPlaybackToWall({ primary, broadcast, paused: false }).onSeek(1, 'timeline')
    expect(order).toEqual(['picture', 'wall'])
  })

  it('with no wall on screen the picture still moves — the broadcast reaches nobody', () => {
    const primary = primaryHandlers()
    const bus = createGridPlaybackBus()
    const out = fanOutPlaybackToWall({
      primary: primary.handlers,
      broadcast: bus.broadcast,
      paused: false,
    })
    out.onSeek(42, 'timeline')
    expect(primary.log).toEqual(['seek:42'])
    expect(bus.size()).toBe(0)
  })
})
