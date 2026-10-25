/**
 * The unified recorded session — D42's client half.
 *
 * ONE media session per viewer: live, recorded playback and scrub are the same
 * track with a moving source pointer owned by the broker's TimelineSession.
 * This class is the client's entire recorded surface: every intent is a
 * pointer-move message on the control channel, every picture arrives on the
 * track the viewer is already watching. There is no second surface, so
 * liveness needs no proof — you can see it.
 *
 * Pinned here: the pointer vocabulary (playRecorded/seek/commit/setRate/
 * stepFrame/goLive), server state+position forwarding, and everything the
 * scrub sub-mode already proved in the field — the by-value profile pin (the
 * mid-drag teardown storm), receiver-credit acks from RENDERED
 * frames, the live-straggler guard, and the per-drag summary line.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { RecordedTrackSession } from '../recorded-track-session.js'
import { fireInitialSeek } from '../initial-seek.js'

interface FakeChannel {
  readyState: string
  readonly sent: string[]
  send(data: string): void
  addEventListener(type: string, cb: (ev: { data: unknown }) => void): void
  removeEventListener(type: string, cb: (ev: { data: unknown }) => void): void
  emit(data: string): void
}

function fakeChannel(state = 'open'): FakeChannel {
  const listeners = new Set<(ev: { data: unknown }) => void>()
  const sent: string[] = []
  return {
    readyState: state,
    sent,
    send: (d) => sent.push(d),
    addEventListener: (type, cb) => {
      if (type === 'message') listeners.add(cb)
    },
    removeEventListener: (_t, cb) => listeners.delete(cb),
    emit: (data) => {
      for (const cb of listeners) cb({ data })
    },
  }
}

interface FakeVideo {
  render(): void
  requestVideoFrameCallback(cb: () => void): number
  cancelVideoFrameCallback(handle: number): void
}

function fakeVideo(): FakeVideo {
  let pending: (() => void) | null = null
  return {
    requestVideoFrameCallback(cb) {
      pending = cb
      return 1
    },
    cancelVideoFrameCallback() {
      pending = null
    },
    render() {
      const cb = pending
      pending = null
      cb?.()
    },
  }
}

const sentMsgs = (ch: FakeChannel): Array<Record<string, unknown>> =>
  ch.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>)
const sentKinds = (ch: FakeChannel): string[] => sentMsgs(ch).map((m) => m.t as string)

describe('RecordedTrackSession — timeline warm-up', () => {
  it('warm sends the warm-up message pinned to the scrub profile, without touching the pin state', () => {
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    expect(s.warm(1_000)).toBe(true)
    expect(sentMsgs(ch)).toEqual([{ t: 'warm', epoch: 1_000, profile: 'low' }])
    // Warm must NOT count as a profile pin: the next drag still pins `low`
    // itself (a warm-then-drag at another profile would otherwise skip the pin).
    s.begin()
    expect(sentKinds(ch)).toContain('setProfile')
  })

  it('warm on a closed channel reports false and sends nothing', () => {
    const ch = fakeChannel('connecting')
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    expect(s.warm(1_000)).toBe(false)
    expect(ch.sent.length).toBe(0)
  })
})

describe('RecordedTrackSession — the pointer vocabulary', () => {
  it('playRecorded moves the pointer into recorded playback at an epoch and profile', () => {
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    expect(s.playRecorded(101, 1_000, 'mid')).toBe(true)
    expect(sentMsgs(ch)).toEqual([
      { t: 'playRecorded', deviceId: 101, epoch: 1_000, profile: 'mid' },
    ])
  })

  it('playClip moves the pointer into a FILE, with an explicit offset', () => {
    // The whole of D575: a clip is another position of the recorded source
    // pointer, so it needs one message and no protocol of its own.
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    expect(s.playClip(107, 'native:reolink:onboard:0:abc', 'provider-reolink', 0, 'low')).toBe(true)
    expect(sentMsgs(ch)).toEqual([
      {
        t: 'playClip',
        deviceId: 107,
        clipId: 'native:reolink:onboard:0:abc',
        provider: 'provider-reolink',
        offsetMs: 0,
        profile: 'low',
      },
    ])
  })

  it('playClip omits the profile when none was picked, never inventing one', () => {
    // A stored file has no broker session to resolve an adaptive tier against,
    // which is why `auto` is not in this domain at all. Absent means the
    // provider's own default; a client that guesses here would be choosing a
    // twin on the operator's behalf, in silence.
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.playClip(107, 'clip-1', 'provider-reolink', 4_000)
    expect(sentMsgs(ch)).toEqual([
      { t: 'playClip', deviceId: 107, clipId: 'clip-1', provider: 'provider-reolink', offsetMs: 4_000 },
    ])
  })

  it('playClip CLAMPS a negative offset rather than sending one the server refuses', () => {
    // `offsetMs` is `z.number().min(0)` on the wire. A negative one is a
    // rounding artefact at the head of a clip, and losing the whole tap to it
    // would be a silent dead press.
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.playClip(107, 'clip-1', 'provider-reolink', -3)
    expect(sentMsgs(ch)).toEqual([
      { t: 'playClip', deviceId: 107, clipId: 'clip-1', provider: 'provider-reolink', offsetMs: 0 },
    ])
  })

  it('a seek AFTER playClip is an ordinary pointer move on the clip\'s own axis', () => {
    // The claim D575 rests on: nothing downstream of the first message knows
    // it is in a file. A second vocabulary here would be the thing that made
    // 1.0.512 ship continuous haptics.
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.playClip(107, 'clip-1', 'provider-reolink', 0)
    s.seek(5_000)
    s.setRate(2)
    expect(sentMsgs(ch)).toEqual([
      { t: 'playClip', deviceId: 107, clipId: 'clip-1', provider: 'provider-reolink', offsetMs: 0 },
      { t: 'seek', epoch: 5_000 },
      { t: 'setRate', rate: 2 },
    ])
  })

  it('playClip refuses on a closed channel so the caller can report the gap', () => {
    const ch = fakeChannel()
    ch.readyState = 'closed'
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    expect(s.playClip(107, 'clip-1', 'provider-reolink', 0)).toBe(false)
    expect(sentMsgs(ch)).toEqual([])
  })

  it('upgradePlayback warms then seeks when the rung changes, and is a no-op on the same rung', () => {
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.playRecorded(101, 1_000, 'low')
    expect(s.upgradePlayback(101, 1_000, 'low')).toBe(true)
    expect(sentMsgs(ch).filter((m) => m.t === 'warm')).toHaveLength(0)
    expect(s.upgradePlayback(101, 1_000, 'mid')).toBe(true)
    expect(sentMsgs(ch)).toContainEqual({ t: 'warm', epoch: 1_000, profile: 'mid' })
    expect(sentMsgs(ch)).toContainEqual({
      t: 'playRecorded',
      deviceId: 101,
      epoch: 1_000,
      profile: 'mid',
    })
  })

  it('seek, setRate, stepFrame and goLive are single pointer-move messages', () => {
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.seek(2_000)
    s.setRate(0)
    s.setRate(2)
    s.stepFrame(1)
    s.stepFrame(-1)
    s.goLive()
    expect(sentMsgs(ch)).toEqual([
      { t: 'seek', epoch: 2_000 },
      { t: 'setRate', rate: 0 },
      { t: 'setRate', rate: 2 },
      { t: 'stepFrame', dir: 1 },
      { t: 'stepFrame', dir: -1 },
      { t: 'goLive' },
    ])
  })

  it('commit is the scrub→play transition: one scrubCommit seek, drag ended', () => {
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.begin()
    s.retarget(1_500)
    s.commit(1_500)
    const kinds = sentKinds(ch)
    expect(kinds).toContain('scrubCommit')
    // The commit ends the DRAG but never sends goLive — the last scrub
    // keyframe holds the track until the seek's burst replaces it.
    expect(kinds).not.toContain('goLive')
    expect(s.isActive()).toBe(false)
  })

  it('begin/commit carry the caller-supplied dragId on the wire; omitted when absent', () => {
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.begin('drag-A')
    s.commit(1_500, 'drag-A')
    expect(sentMsgs(ch)).toContainEqual({ t: 'scrubStart', dragId: 'drag-A' })
    expect(sentMsgs(ch)).toContainEqual({ t: 'scrubCommit', epoch: 1_500, dragId: 'drag-A' })

    const ch2 = fakeChannel()
    const s2 = new RecordedTrackSession({ channel: ch2, video: () => fakeVideo() })
    s2.begin()
    s2.commit(1_500)
    expect(sentMsgs(ch2)).toContainEqual({ t: 'scrubStart' })
    expect(sentMsgs(ch2)).toContainEqual({ t: 'scrubCommit', epoch: 1_500 })
  })

  it('every pointer move refuses on a closed channel so the caller can report the gap', () => {
    const ch = fakeChannel('connecting')
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    expect(s.playRecorded(101, 1_000, 'mid')).toBe(false)
    s.seek(1)
    s.setRate(1)
    s.stepFrame(1)
    s.commit(1)
    expect(ch.sent).toHaveLength(0)
  })
})

describe('RecordedTrackSession — server state and position forwarding', () => {
  it('forwards state and position messages to the host callbacks', () => {
    const ch = fakeChannel()
    const states: string[] = []
    const positions: number[] = []
    new RecordedTrackSession({
      channel: ch,
      video: () => fakeVideo(),
      onState: (st) => states.push(st),
      onPosition: (e) => positions.push(e),
    })
    ch.emit(JSON.stringify({ t: 'state', state: 'playing' }))
    ch.emit(JSON.stringify({ t: 'position', epochMs: 6_000 }))
    ch.emit(JSON.stringify({ t: 'state', state: 'live' }))
    expect(states).toEqual(['playing', 'live'])
    expect(positions).toEqual([6_000])
  })

  it('logs playback:intent on play and playback:ready when the server says playing', () => {
    const ch = fakeChannel()
    const logs: Array<{ msg: string; data: Record<string, unknown> }> = []
    const s = new RecordedTrackSession({
      channel: ch,
      video: () => fakeVideo(),
      onLog: (msg, data) => logs.push({ msg, data }),
    })
    s.playRecorded(104, 1_000, 'low')
    expect(logs.some((l) => l.msg === 'playback:intent' && l.data.kind === 'play')).toBe(true)
    ch.emit(JSON.stringify({ t: 'state', state: 'playing' }))
    const ready = logs.find((l) => l.msg === 'playback:ready')
    expect(ready?.data).toMatchObject({ kind: 'play', state: 'playing' })
    expect(typeof ready?.data.waitMs).toBe('number')
  })

  it('a scrub commit (landFromScrub) carries dragId on playback:intent AND its matching playback:ready', () => {
    const ch = fakeChannel()
    const logs: Array<{ msg: string; data: Record<string, unknown> }> = []
    const s = new RecordedTrackSession({
      channel: ch,
      video: () => fakeVideo(),
      onLog: (msg, data) => logs.push({ msg, data }),
    })
    s.landFromScrub(104, 8_000, 'low', 'drag-Z')
    const intent = logs.find((l) => l.msg === 'playback:intent' && l.data.kind === 'land')
    expect(intent?.data).toMatchObject({ dragId: 'drag-Z' })
    ch.emit(JSON.stringify({ t: 'state', state: 'playing' }))
    const ready = logs.find((l) => l.msg === 'playback:ready')
    expect(ready?.data).toMatchObject({ kind: 'land', state: 'playing', dragId: 'drag-Z' })
  })

  it('a bare seek carries no dragId, even right after a scrub intent', () => {
    const ch = fakeChannel()
    const logs: Array<{ msg: string; data: Record<string, unknown> }> = []
    const s = new RecordedTrackSession({
      channel: ch,
      video: () => fakeVideo(),
      onLog: (msg, data) => logs.push({ msg, data }),
    })
    s.landFromScrub(104, 8_000, 'low', 'drag-Z')
    s.seek(9_000) // interrupts before the drag's own playback:ready ever arrives
    ch.emit(JSON.stringify({ t: 'state', state: 'playing' }))
    const ready = logs.find((l) => l.msg === 'playback:ready')
    expect(ready?.data).toMatchObject({ kind: 'seek' })
    expect(ready?.data.dragId).toBeUndefined()
  })

  it('forwards the effective live profile selected by adaptive', () => {
    const ch = fakeChannel()
    const profiles: string[] = []
    new RecordedTrackSession({
      channel: ch,
      video: () => fakeVideo(),
      onLiveProfile: (profile) => profiles.push(profile),
    })
    ch.emit(JSON.stringify({ t: 'liveProfile', profile: 'high' }))
    ch.emit(JSON.stringify({ t: 'liveProfile', profile: 'invalid' }))
    expect(profiles).toEqual(['high'])
  })

  it('ignores malformed frames without throwing', () => {
    const ch = fakeChannel()
    const states: string[] = []
    new RecordedTrackSession({
      channel: ch,
      video: () => fakeVideo(),
      onState: (st) => states.push(st),
    })
    ch.emit('not json')
    ch.emit(JSON.stringify({ t: 'state' }))
    ch.emit(JSON.stringify({ nonsense: true }))
    expect(states).toEqual([])
  })
})

describe('RecordedTrackSession — the scrub sub-mode (field-proven behaviours kept)', () => {
  it('pins the profile by VALUE: re-begins never re-send, a playback at another profile re-pins', () => {
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.begin()
    s.end()
    s.begin() // storm / next drag with the pin unchanged — nothing re-sent
    expect(sentKinds(ch).filter((t) => t === 'setProfile')).toHaveLength(1)
    expect(sentKinds(ch).filter((t) => t === 'scrubStart')).toHaveLength(2)
    s.end()
    s.playRecorded(101, 1_000, 'mid') // playback moves the server profile
    s.begin() // the next drag must re-pin low, or it scrubs at mid
    const profiles = sentMsgs(ch)
      .filter((m) => m.t === 'setProfile')
      .map((m) => m.profile)
    expect(profiles).toEqual(['low', 'low'])
  })

  it('a rendered frame after the first position acks and announces once', () => {
    const ch = fakeChannel()
    const video = fakeVideo()
    const firstFrame = vi.fn()
    const s = new RecordedTrackSession({
      channel: ch,
      video: () => video,
      onFirstFrame: firstFrame,
    })
    s.begin()
    video.render() // live straggler — before any position
    expect(sentKinds(ch)).not.toContain('scrubAck')
    ch.emit(JSON.stringify({ t: 'position', epochMs: 6_000 }))
    video.render()
    video.render()
    expect(sentKinds(ch).filter((t) => t === 'scrubAck')).toHaveLength(2)
    expect(firstFrame).toHaveBeenCalledTimes(1)
  })

  it('end() logs the per-drag summary line', () => {
    const ch = fakeChannel()
    const video = fakeVideo()
    const logs: Array<{ msg: string; data: Record<string, unknown> }> = []
    const s = new RecordedTrackSession({
      channel: ch,
      video: () => video,
      onLog: (msg, data) => logs.push({ msg, data }),
    })
    s.begin()
    s.retarget(1_000)
    ch.emit(JSON.stringify({ t: 'position', epochMs: 1_000 }))
    video.render()
    s.end()
    const summary = logs.find((l) => l.msg === 'scrub:push-drag-end')
    expect(summary?.data).toMatchObject({ retargets: 1, positions: 1, renders: 1, acks: 1 })
  })
})

/**
 * RECEIVER CREDIT — the ack must NAME the push it settles, and it must be sent
 * on every platform.
 *
 * The server charges one credit per push and repays it on the first ack naming
 * that push. The two halves count differently: with `requestVideoFrameCallback`
 * this session acks per RENDERED frame (N acks for a sweep of N access units),
 * without it once per POSITION (one ack for the same sweep). `seq` is what
 * makes both correct.
 */
describe('RecordedTrackSession — receiver credit acks name their push', () => {
  it('echoes the push sequence of the newest position on every rvfc ack', () => {
    const ch = fakeChannel()
    const video = fakeVideo()
    const s = new RecordedTrackSession({ channel: ch, video: () => video })
    s.begin()
    ch.emit(JSON.stringify({ t: 'position', epochMs: 6_000, seq: 7 }))
    video.render()
    video.render()
    const acks = sentMsgs(ch).filter((m) => m.t === 'scrubAck')
    // Both acks name push 7: the first settles it, the surplus is a no-op —
    // which is exactly what stops a 25-frame sweep repaying 25 credits.
    expect(acks).toEqual([
      { t: 'scrubAck', seq: 7 },
      { t: 'scrubAck', seq: 7 },
    ])
  })

  it('without rvfc, acks per position', () => {
    const ch = fakeChannel()
    const s = new RecordedTrackSession({
      channel: ch,
      video: () => null,
    })
    s.begin()
    ch.emit(JSON.stringify({ t: 'position', epochMs: 6_000, seq: 3 }))
    ch.emit(JSON.stringify({ t: 'position', epochMs: 7_000, seq: 4 }))
    expect(sentMsgs(ch).filter((m) => m.t === 'scrubAck')).toEqual([
      { t: 'scrubAck', seq: 3 },
      { t: 'scrubAck', seq: 4 },
    ])
  })

  it('a server that sends no sequence still gets an ack — the field is optional', () => {
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => null })
    s.begin()
    ch.emit(JSON.stringify({ t: 'position', epochMs: 6_000 }))
    expect(sentMsgs(ch).filter((m) => m.t === 'scrubAck')).toEqual([{ t: 'scrubAck' }])
  })
})

// ── Config-carried initial seek (deep-link go-to-moment) ────────────────────
describe('fireInitialSeek', () => {
  it('is a clean no-fire with no session yet', () => {
    expect(fireInitialSeek(null, 7, 123_000, 'mid')).toBe(false)
  })

  it('does nothing on a channel that is not open, so the caller keeps the pending seek', () => {
    const ch = fakeChannel('connecting')
    const session = new RecordedTrackSession({ channel: ch, video: () => null })
    expect(fireInitialSeek(session, 7, 123_000, 'mid')).toBe(false)
    expect(ch.sent).toEqual([])
  })

  it('warms the timeline and enters recorded in one burst once the channel is open', () => {
    const ch = fakeChannel()
    const session = new RecordedTrackSession({ channel: ch, video: () => null })
    expect(fireInitialSeek(session, 7, 123_000, 'mid')).toBe(true)
    expect(sentMsgs(ch)).toEqual([
      { t: 'warm', epoch: 123_000, profile: 'low' },
      { t: 'playRecorded', deviceId: 7, epoch: 123_000, profile: 'mid' },
    ])
  })
})

describe('RecordedTrackSession — the served tier is not a secret', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('forwards servedProfile and moves the pin mirror to what is actually playing', () => {
    vi.useFakeTimers()
    const ch = fakeChannel()
    const served: unknown[] = []
    const s = new RecordedTrackSession({
      channel: ch,
      video: () => fakeVideo(),
      onServedProfile: (m) => served.push(m),
    })
    s.begin()
    s.landFromScrub(104, 8_000_000, 'high')
    ch.emit(JSON.stringify({ t: 'state', state: 'playing' }))
    vi.advanceTimersByTime(10_000)
    // The upgrade asked for high; the server could only serve low here.
    expect(sentMsgs(ch).filter((m) => m.t === 'playRecorded' && m.profile === 'high')).toHaveLength(1)
    ch.emit(JSON.stringify({ t: 'servedProfile', profile: 'low', requested: 'high' }))
    expect(served).toEqual([{ profile: 'low', requested: 'high' }])
    // The mirror learned the server moved: the next drag's pin to low is a
    // no-op, not a re-send of a profile that is already playing.
    const before = sentMsgs(ch).filter((m) => m.t === 'setProfile').length
    s.begin()
    expect(sentMsgs(ch).filter((m) => m.t === 'setProfile')).toHaveLength(before)
  })

  it('does not arm a delayed upgrade into a tier the server just reported degraded', () => {
    vi.useFakeTimers()
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.begin()
    s.landFromScrub(104, 8_000_000, 'high')
    ch.emit(JSON.stringify({ t: 'servedProfile', profile: 'mid', requested: 'high' }))
    ch.emit(JSON.stringify({ t: 'state', state: 'playing' }))
    vi.advanceTimersByTime(10_000)
    const plays = sentMsgs(ch).filter((m) => m.t === 'playRecorded' && m.profile === 'high')
    expect(plays).toHaveLength(0)
    // …and the veto lifts when High comes back for the request.
    ch.emit(JSON.stringify({ t: 'servedProfile', profile: 'high', requested: 'high' }))
    s.landFromScrub(104, 9_000_000, 'high')
    ch.emit(JSON.stringify({ t: 'state', state: 'playing' }))
    vi.advanceTimersByTime(10_000)
    expect(sentMsgs(ch).filter((m) => m.t === 'playRecorded' && m.profile === 'high')).toHaveLength(1)
  })
})

describe('RecordedTrackSession — scrub land on low, delayed playback upgrade', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('warms the destination profile at land and again 1.5 s before the upgrade', () => {
    vi.useFakeTimers()
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    expect(s.landFromScrub(104, 8_000_000, 'high')).toBe(true)
    expect(sentMsgs(ch).filter((m) => m.t === 'warm')).toEqual([
      { t: 'warm', epoch: 8_000_000, profile: 'high' },
    ])
    ch.emit(JSON.stringify({ t: 'state', state: 'playing' }))
    ch.emit(JSON.stringify({ t: 'position', epochMs: 8_003_000 }))
    vi.advanceTimersByTime(3_499)
    expect(sentMsgs(ch).filter((m) => m.t === 'warm')).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(sentMsgs(ch).filter((m) => m.t === 'warm')).toEqual([
      { t: 'warm', epoch: 8_000_000, profile: 'high' },
      { t: 'warm', epoch: 8_003_000, profile: 'high' },
    ])
  })

  it('lands immediately on low and does not send the desired high until 5 s of playback', () => {
    vi.useFakeTimers()
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.begin()
    expect(s.landFromScrub(104, 8_000_000, 'high')).toBe(true)
    const plays = sentMsgs(ch).filter((m) => m.t === 'playRecorded')
    expect(plays).toEqual([
      { t: 'playRecorded', deviceId: 104, epoch: 8_000_000, profile: 'low' },
    ])
    ch.emit(JSON.stringify({ t: 'state', state: 'playing' }))
    ch.emit(JSON.stringify({ t: 'position', epochMs: 8_003_000 }))
    vi.advanceTimersByTime(4_999)
    expect(sentMsgs(ch).filter((m) => m.t === 'playRecorded')).toHaveLength(1)
    vi.advanceTimersByTime(1)
    const after = sentMsgs(ch).filter((m) => m.t === 'playRecorded')
    expect(after).toHaveLength(2)
    expect(after[1]).toEqual({
      t: 'playRecorded',
      deviceId: 104,
      epoch: 8_003_000,
      profile: 'high',
    })
  })

  it('re-arms from an already-playing land without waiting for another playing event', () => {
    vi.useFakeTimers()
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.landFromScrub(104, 1_000, 'high')
    ch.emit(JSON.stringify({ t: 'state', state: 'playing' }))
    vi.advanceTimersByTime(2_000)
    expect(s.landFromScrub(104, 2_000, 'high')).toBe(true)
    vi.advanceTimersByTime(4_999)
    expect(sentMsgs(ch).filter((m) => m.t === 'playRecorded')).toEqual([
      { t: 'playRecorded', deviceId: 104, epoch: 1_000, profile: 'low' },
      { t: 'playRecorded', deviceId: 104, epoch: 2_000, profile: 'low' },
    ])
    vi.advanceTimersByTime(1)
    const after = sentMsgs(ch).filter((m) => m.t === 'playRecorded')
    expect(after).toHaveLength(3)
    expect(after[2]).toEqual({
      t: 'playRecorded',
      deviceId: 104,
      epoch: 2_000,
      profile: 'high',
    })
  })

  it('never upgrades when the desired playback profile is already low', () => {
    vi.useFakeTimers()
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.landFromScrub(104, 1_000, 'low')
    ch.emit(JSON.stringify({ t: 'state', state: 'playing' }))
    vi.advanceTimersByTime(6_000)
    expect(sentMsgs(ch).filter((m) => m.t === 'playRecorded')).toEqual([
      { t: 'playRecorded', deviceId: 104, epoch: 1_000, profile: 'low' },
    ])
  })

  it('cancels the upgrade if a new drag starts before 5 s', () => {
    vi.useFakeTimers()
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.landFromScrub(104, 1_000, 'high')
    ch.emit(JSON.stringify({ t: 'state', state: 'playing' }))
    s.begin()
    vi.advanceTimersByTime(6_000)
    expect(sentMsgs(ch).filter((m) => m.t === 'playRecorded')).toHaveLength(1)
  })

  it('cancels the upgrade on goLive', () => {
    vi.useFakeTimers()
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.landFromScrub(104, 1_000, 'high')
    ch.emit(JSON.stringify({ t: 'state', state: 'playing' }))
    s.goLive()
    vi.advanceTimersByTime(6_000)
    expect(sentMsgs(ch).filter((m) => m.t === 'playRecorded')).toHaveLength(1)
  })

  it('a heatmap playRecorded cancels a pending scrub upgrade', () => {
    vi.useFakeTimers()
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.landFromScrub(104, 1_000, 'high')
    ch.emit(JSON.stringify({ t: 'state', state: 'playing' }))
    s.playRecorded(104, 9_000, 'high')
    vi.advanceTimersByTime(6_000)
    const plays = sentMsgs(ch).filter((m) => m.t === 'playRecorded')
    expect(plays).toHaveLength(2)
    expect(plays[1]).toMatchObject({ epoch: 9_000, profile: 'high' })
  })
})

describe('RecordedTrackSession — a clip on the pointer (D575, the client half)', () => {
  /**
   * The server routes `seek` / `scrubCommit` / `setRate` / `stepFrame` to the
   * CLIP feeder while a clip holds the pointer — and it leaves the clip on
   * `playRecorded`. This class turned every scrub RELEASE and every post-seek
   * climb into `playRecorded`, so from the app a drag inside a clip landed on
   * the recorder's footage at "epoch 12 000" (1970) and the file was gone.
   * The routing decision the server already makes is mirrored here, once.
   */
  afterEach(() => {
    vi.useRealTimers()
  })

  it('holdsClip says whether the pointer is on a file, and playRecorded / goLive leave it', () => {
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    expect(s.holdsClip()).toBe(false)
    s.playClip(107, 'clip-1', 'provider-reolink', 0)
    expect(s.holdsClip()).toBe(true)
    s.goLive()
    expect(s.holdsClip()).toBe(false)
    s.playClip(107, 'clip-1', 'provider-reolink', 0)
    s.playRecorded(107, 1_700_000_000_000, 'mid')
    expect(s.holdsClip()).toBe(false)
  })

  it('a scrub RELEASED on a clip commits on the clip axis — never a playRecorded, never a later upgrade', () => {
    vi.useFakeTimers()
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.playClip(107, 'clip-1', 'provider-reolink', 0)
    expect(s.begin('drag-7')).toBe(true)
    s.retarget(3_000)
    expect(s.landFromScrub(107, 4_200, 'high', 'drag-7')).toBe(true)
    // The land's 5 s climb to `high` is a playRecorded on the wire; on a file
    // there is no tier to climb to and the message would leave the clip.
    ch.emit(JSON.stringify({ t: 'state', state: 'playing' }))
    vi.advanceTimersByTime(10_000)
    expect(sentMsgs(ch)).toEqual([
      { t: 'playClip', deviceId: 107, clipId: 'clip-1', provider: 'provider-reolink', offsetMs: 0 },
      { t: 'setProfile', profile: 'low' },
      { t: 'scrubStart', dragId: 'drag-7' },
      { t: 'scrubTo', epoch: 3_000 },
      { t: 'scrubCommit', epoch: 4_200, dragId: 'drag-7' },
    ])
    expect(s.holdsClip()).toBe(true)
  })

  it('upgradePlayback on a clip is refused out loud, not sent', () => {
    const ch = fakeChannel()
    const logs: Array<{ msg: string; data: Record<string, unknown> }> = []
    const s = new RecordedTrackSession({
      channel: ch,
      video: () => fakeVideo(),
      onLog: (msg, data) => logs.push({ msg, data }),
    })
    s.playClip(107, 'clip-1', 'provider-reolink', 0)
    s.upgradePlayback(107, 2_000, 'high')
    expect(sentKinds(ch)).toEqual(['playClip'])
    expect(logs.map((l) => l.msg)).toContain('clip:playback-upgrade-refused')
  })

  it('once the clip is left, a release lands as playRecorded again', () => {
    const ch = fakeChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => fakeVideo() })
    s.playClip(107, 'clip-1', 'provider-reolink', 0)
    s.goLive()
    s.begin('drag-8')
    s.landFromScrub(107, 1_700_000_000_000, 'low', 'drag-8')
    expect(sentKinds(ch)).toEqual(['playClip', 'goLive', 'setProfile', 'scrubStart', 'playRecorded'])
  })

  it('forwards the clip audio report, named by clip, with the rate it names', () => {
    const ch = fakeChannel()
    const reports: unknown[] = []
    const s = new RecordedTrackSession({
      channel: ch,
      video: () => fakeVideo(),
      onClipAudio: (r) => reports.push(r),
    })
    ch.emit(JSON.stringify({ t: 'clipAudio', clipId: 'clip-1', carried: true, codec: 'opus' }))
    ch.emit(JSON.stringify({ t: 'clipAudio', clipId: 'clip-1', carried: false, reason: 'rate', rate: 8 }))
    ch.emit(JSON.stringify({ t: 'clipAudio', clipId: 'clip-1', carried: false, reason: 'no-audio-track' }))
    expect(reports).toEqual([
      { clipId: 'clip-1', carried: true, codec: 'opus' },
      { clipId: 'clip-1', carried: false, reason: 'rate', rate: 8 },
      { clipId: 'clip-1', carried: false, reason: 'no-audio-track' },
    ])
    s.dispose()
  })

  it('refuses a `rate` silence that does not name the rate — and keeps the silence', () => {
    // D621 enforces the pair at the hub's serializer, so this cannot arrive
    // from a hub that has it. If it does, an `N\u00d7` badge with no N is the
    // unanswerable message the reason exists to replace: the silence is still
    // reported, its cause is simply unnamed, exactly as it was before D621.
    const ch = fakeChannel()
    const reports: unknown[] = []
    const s = new RecordedTrackSession({
      channel: ch,
      video: () => fakeVideo(),
      onClipAudio: (r) => reports.push(r),
    })
    ch.emit(JSON.stringify({ t: 'clipAudio', clipId: 'clip-1', carried: false, reason: 'rate' }))
    ch.emit(JSON.stringify({ t: 'clipAudio', clipId: 'clip-1', carried: false, reason: 'rate', rate: 0 }))
    // A reason this build has never heard of is dropped, not invented.
    ch.emit(JSON.stringify({ t: 'clipAudio', clipId: 'clip-1', carried: false, reason: 'sunspots' }))
    expect(reports).toEqual([
      { clipId: 'clip-1', carried: false },
      { clipId: 'clip-1', carried: false },
      { clipId: 'clip-1', carried: false },
    ])
    s.dispose()
  })

  it('refuses a clipAudio that names no clip, or no carried flag', () => {
    const ch = fakeChannel()
    const reports: unknown[] = []
    const s = new RecordedTrackSession({
      channel: ch,
      video: () => fakeVideo(),
      onClipAudio: (r) => reports.push(r),
    })
    ch.emit(JSON.stringify({ t: 'clipAudio', clipId: '', carried: false, reason: 'rate', rate: 2 }))
    ch.emit(JSON.stringify({ t: 'clipAudio', clipId: 'clip-1' }))
    expect(reports).toEqual([])
    s.dispose()
  })

  it('forwards the truncated-serve report, named by clip, sentence verbatim (D623)', () => {
    const ch = fakeChannel()
    const reports: unknown[] = []
    const s = new RecordedTrackSession({
      channel: ch,
      video: () => fakeVideo(),
      onClipIncomplete: (r) => reports.push(r),
    })
    ch.emit(
      JSON.stringify({
        t: 'clipIncomplete',
        clipId: 'clip-1',
        code: 'stream-short',
        reason: '4.3 s of 45.0 s arrived',
      }),
    )
    ch.emit(
      JSON.stringify({ t: 'clipIncomplete', clipId: 'clip-1', code: 'stream-empty', reason: 'no video' }),
    )
    expect(reports).toEqual([
      { clipId: 'clip-1', code: 'stream-short', reason: '4.3 s of 45.0 s arrived' },
      { clipId: 'clip-1', code: 'stream-empty', reason: 'no video' },
    ])
    s.dispose()
  })

  it('refuses an unnamed clip, an empty sentence and a code this build does not know', () => {
    // `completeness-unverified` is the third provider verdict and the hub
    // schema already refuses it (D623): "we could not check" is a diagnostic,
    // not something to put on a screen. Refused here too, so a hub that grew
    // a new word cannot leak one through this class.
    const ch = fakeChannel()
    const reports: unknown[] = []
    const s = new RecordedTrackSession({
      channel: ch,
      video: () => fakeVideo(),
      onClipIncomplete: (r) => reports.push(r),
    })
    ch.emit(JSON.stringify({ t: 'clipIncomplete', clipId: '', code: 'stream-short', reason: 'x' }))
    ch.emit(JSON.stringify({ t: 'clipIncomplete', clipId: 'clip-1', code: 'stream-short', reason: '' }))
    ch.emit(
      JSON.stringify({ t: 'clipIncomplete', clipId: 'clip-1', code: 'completeness-unverified', reason: 'x' }),
    )
    ch.emit(JSON.stringify({ t: 'clipIncomplete', clipId: 'clip-1', reason: 'x' }))
    expect(reports).toEqual([])
    s.dispose()
  })

  it('forwards the clip duration the server measured, named by clip', () => {
    const ch = fakeChannel()
    const reports: Array<{ clipId: string; durationMs: number }> = []
    const s = new RecordedTrackSession({
      channel: ch,
      video: () => fakeVideo(),
      onClipDuration: (r) => reports.push(r),
    })
    ch.emit(JSON.stringify({ t: 'clipDuration', clipId: 'clip-1', durationMs: 16_240 }))
    // A measurement that failed is not a number, and never zero (D393).
    ch.emit(JSON.stringify({ t: 'clipDuration', clipId: 'clip-1', durationMs: 0 }))
    ch.emit(JSON.stringify({ t: 'clipDuration', clipId: 'clip-1' }))
    expect(reports).toEqual([{ clipId: 'clip-1', durationMs: 16_240 }])
    s.dispose()
  })
})
