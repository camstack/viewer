import { describe, it, expect } from 'vitest'
import {
  resolveTimelineFaults,
  activeFaultSources,
  pruneDismissals,
  FAULT_PRIORITY,
  type FaultSignal,
  type FaultSource,
  type TimelineFaultSignals,
} from '../timeline-faults.js'

const quiet: FaultSignal = { failed: false, fetching: false, reason: null }
const broken: FaultSignal = { failed: true, fetching: false, reason: null }
const retrying: FaultSignal = { failed: true, fetching: true, reason: null }

function signals(patch: Partial<TimelineFaultSignals> = {}): TimelineFaultSignals {
  return { stream: quiet, recordings: quiet, events: quiet, ...patch }
}

describe('resolveTimelineFaults', () => {
  it('says nothing when every source is healthy', () => {
    expect(resolveTimelineFaults({ connected: true, sources: signals(), dismissed: [] })).toEqual([])
  })

  it('stays silent while the socket is down, whatever failed', () => {
    // The connection banner already owns that cause, and a retry button wired to
    // a dead socket fails instantly and reads as a broken control.
    const faults = resolveTimelineFaults({
      connected: false,
      sources: signals({ stream: broken, recordings: broken, events: broken }),
      dismissed: [],
    })
    expect(faults).toEqual([])
  })

  it('distinguishes a failure from an attempt in flight', () => {
    expect(
      resolveTimelineFaults({ connected: true, sources: signals({ events: broken }), dismissed: [] }),
    ).toEqual([{ source: 'events', phase: 'failed', reason: null }])
    expect(
      resolveTimelineFaults({ connected: true, sources: signals({ events: retrying }), dismissed: [] }),
    ).toEqual([{ source: 'events', phase: 'retrying', reason: null }])
  })

  it('carries the stream reason the player gave', () => {
    const faults = resolveTimelineFaults({
      connected: true,
      sources: signals({ stream: { failed: true, fetching: false, reason: 'ICE failed' } }),
      dismissed: [],
    })
    expect(faults).toEqual([{ source: 'stream', phase: 'failed', reason: 'ICE failed' }])
  })

  it('stacks concurrent faults in priority order: stream > recordings > events', () => {
    const faults = resolveTimelineFaults({
      connected: true,
      sources: signals({ events: broken, stream: broken, recordings: broken }),
      dismissed: [],
    })
    expect(faults.map((f) => f.source)).toEqual(['stream', 'recordings', 'events'])
    expect(FAULT_PRIORITY).toEqual(['stream', 'recordings', 'events'])
  })

  it('has no source behind the clips MODE — that list has no read of its own', () => {
    // Clips mode used to call `videoclips.listClips` and could fail on its own.
    // Its cards are derived from the event clusters plus the recording
    // availability now, so its two ways of failing are already `events` and
    // `recordings`; a fourth source could only ever say "fine".
    expect(FAULT_PRIORITY).not.toContain('clips')
  })

  it('keeps the priority order when only some sources failed', () => {
    const faults = resolveTimelineFaults({
      connected: true,
      sources: signals({ events: broken, recordings: retrying }),
      dismissed: [],
    })
    expect(faults).toEqual([
      { source: 'recordings', phase: 'retrying', reason: null },
      { source: 'events', phase: 'failed', reason: null },
    ])
  })

  it('hides a dismissed source and leaves its neighbours alone', () => {
    const faults = resolveTimelineFaults({
      connected: true,
      sources: signals({ stream: broken, events: broken }),
      dismissed: ['stream'],
    })
    expect(faults.map((f) => f.source)).toEqual(['events'])
  })
})

describe('activeFaultSources', () => {
  it('lists what is failing right now, in priority order, ignoring dismissals', () => {
    expect(activeFaultSources(signals({ events: broken, stream: retrying }))).toEqual([
      'stream',
      'events',
    ])
    expect(activeFaultSources(signals())).toEqual([])
  })
})

describe('pruneDismissals', () => {
  it('forgets a dismissal once its source recovered, so a NEW fault shows again', () => {
    expect(pruneDismissals(['stream', 'events'], ['events'])).toEqual(['events'])
  })

  it('keeps a dismissal while its source is still failing', () => {
    expect(pruneDismissals(['stream'], ['stream', 'events'])).toEqual(['stream'])
  })

  it('returns the SAME array when nothing changed', () => {
    // Identity matters: this feeds a setState in an effect, and a fresh array
    // every render would loop.
    const dismissed: readonly FaultSource[] = ['stream']
    expect(pruneDismissals(dismissed, ['stream'])).toBe(dismissed)
    const empty: readonly FaultSource[] = []
    expect(pruneDismissals(empty, [])).toBe(empty)
  })
})
