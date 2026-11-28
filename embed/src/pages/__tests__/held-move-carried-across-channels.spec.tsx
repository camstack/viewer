/**
 * The player page carries a held recorded move from one control channel to
 * the next — mounted, through the real `onControlChannel` and host commands.
 *
 * The session half (hold, drop, carry) is `held-playback-on-reconnect.spec.ts`.
 * This is the page's half, which a session spec cannot see: on every new
 * channel the page takes the old session's held move BEFORE disposing it and
 * hands it to the new session, after any clip that waited for a channel; and
 * a host `playRecorded` clears a clip still waiting, so the older intent can
 * never be asserted over the newer one.
 *
 * The event order is the one a real browser produces on the player's
 * non-seamless reconnect: `pc.close()` makes the old channel fire `close`
 * (Chromium 149, measured), the retry backoff runs, and only then is the new
 * channel created.
 */
import { act, cleanup, render } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── The player: captured, never run ─────────────────────────────────────────
interface CapturedPlayerProps {
  readonly onControlChannel?: (channel: FakeChannel) => void
}
const player: { props: CapturedPlayerProps | null } = { props: null }

vi.mock('@dominevo/ui-library', () => ({
  SystemProvider: ({ children }: { children: ReactNode }) => children,
  trpc: { Provider: ({ children }: { children: ReactNode }) => children },
  CameraStreamPlayer: (props: CapturedPlayerProps) => {
    player.props = props
    return null
  },
  useDeviceWebrtc: () => ({
    handleOffer: vi.fn(),
    getIceServers: vi.fn(),
    addIceCandidate: vi.fn(),
    getIceCandidates: vi.fn(),
    closeSession: vi.fn(),
    getSessionState: vi.fn(),
    getSessionDebug: vi.fn(),
    applyDownlinkProbe: vi.fn(),
  }),
}))

vi.mock('@dominevo/sdk', () => ({
  createSystem: () => ({
    serverUrl: 'http://hub.test',
    trpcClient: {},
    close: () => {},
    setToken: () => {},
    reconnect: () => {},
  }),
}))

const hostMessages: Array<Record<string, unknown>> = []
vi.mock('../../embed/host-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../embed/host-bridge')>()
  return {
    ...actual,
    emitHost: (msg: Record<string, unknown>) => {
      hostMessages.push(msg)
    },
    setLogDeviceTag: () => {},
    onHostCommand: () => () => {},
    useEmbedConfig: () => ({
      ok: true,
      config: {
        serverUrl: 'http://hub.test',
        token: 'token',
        deviceId: DEVICE,
        target: { kind: 'adaptive' },
        muted: true,
        stats: false,
      },
    }),
  }
})

vi.mock('../../embed/PaletteBridge', () => ({ PaletteBridge: () => null }))
vi.mock('../../embed/use-tile-highlight', () => ({
  useTileHighlight: () => null,
  highlightFallback: () => null,
}))
vi.mock('../../embed/use-exclusive-intercom', () => ({
  useExclusiveIntercom: () => ({ setActiveMic: () => {} }),
}))
vi.mock('../../embed/use-stall-watchdog', () => ({
  useStallWatchdog: () => ({ stalled: false }),
}))

import { EmbedPlayerPage } from '../EmbedPlayerPage'

const DEVICE = 7
const CURSOR = 1_763_460_000_000

// ── A data channel the way `createDataChannel` hands it over ────────────────
type Listener = (ev: { data: unknown }) => void

interface FakeChannel {
  readyState: string
  readonly sent: string[]
  send(data: string): void
  addEventListener(type: string, cb: Listener, opts?: unknown): void
  removeEventListener(type: string, cb: Listener): void
  open(): void
  close(): void
}

function fakeChannel(): FakeChannel {
  const listeners = new Map<string, Set<Listener>>()
  const fire = (type: string): void => {
    for (const cb of [...(listeners.get(type) ?? [])]) cb({ data: undefined })
  }
  const channel: FakeChannel = {
    readyState: 'connecting',
    sent: [],
    send: (d) => {
      channel.sent.push(d)
    },
    addEventListener: (type, cb) => {
      const set = listeners.get(type) ?? new Set<Listener>()
      set.add(cb)
      listeners.set(type, set)
    },
    removeEventListener: (type, cb) => {
      listeners.get(type)?.delete(cb)
    },
    open: () => {
      channel.readyState = 'open'
      fire('open')
    },
    close: () => {
      channel.readyState = 'closed'
      fire('close')
    },
  }
  return channel
}

const wire = (ch: FakeChannel): Array<Record<string, unknown>> =>
  ch.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>)

const pointerMoves = (ch: FakeChannel): Array<Record<string, unknown>> =>
  wire(ch).filter((m) => m.t === 'playRecorded' || m.t === 'playClip' || m.t === 'setRate')

const recErrors = (): number =>
  hostMessages.filter((m) => m.type === 'recState' && m.state === 'error').length

function newChannel(): FakeChannel {
  const ch = fakeChannel()
  const onControlChannel = player.props?.onControlChannel
  if (onControlChannel === undefined) throw new Error('the player was not handed onControlChannel')
  act(() => onControlChannel(ch))
  return ch
}

function host(): NonNullable<typeof window.__camstackEmbed> {
  const api = window.__camstackEmbed
  if (api === undefined) throw new Error('the page did not expose its host API')
  return api
}

beforeEach(() => {
  vi.useFakeTimers()
  hostMessages.length = 0
  player.props = null
  render(createElement(EmbedPlayerPage))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('EmbedPlayerPage carries a held move into the next channel', () => {
  it('non-seamless reconnect: old channel closes, a new one is created later — the cursor lands on it', () => {
    const a = newChannel()
    // The host's foreground re-assert, while A is still negotiating.
    act(() => {
      host().playRecorded(DEVICE, CURSOR, 'mid')
      host().setRate(0)
    })
    // ICE failed → pc.close() → A fires `close`; the backoff runs.
    act(() => a.close())
    act(() => {
      vi.advanceTimersByTime(1_800)
    })
    const b = newChannel()
    act(() => b.open())

    expect(pointerMoves(b)).toEqual([
      { t: 'playRecorded', deviceId: DEVICE, epoch: CURSOR, profile: 'mid' },
      { t: 'setRate', rate: 0 },
    ])
    expect(recErrors()).toBe(0)
  })

  it('seamless retry: a channel still negotiating is replaced — the move rides along', () => {
    const a = newChannel()
    act(() => host().playRecorded(DEVICE, CURSOR, 'mid'))
    const b = newChannel()
    act(() => a.open())
    act(() => b.open())
    expect(pointerMoves(a)).toEqual([])
    expect(pointerMoves(b)).toEqual([
      { t: 'playRecorded', deviceId: DEVICE, epoch: CURSOR, profile: 'mid' },
    ])
    expect(recErrors()).toBe(0)
  })

  it('no channel follows a close: the drop is reported once the grace runs out', () => {
    const a = newChannel()
    act(() => host().playRecorded(DEVICE, CURSOR, 'mid'))
    act(() => a.close())
    expect(recErrors()).toBe(0)
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(recErrors()).toBe(1)
  })
})

describe('EmbedPlayerPage — the newest intent wins over a waiting clip', () => {
  it('a playRecorded after a clip that found no session clears that clip', () => {
    // A clip tapped with no control channel at all is parked on the page…
    act(() => host().playClip(DEVICE, 'clip-old', 'recorder', 0))
    // …then the operator moves to a recording position. Still no channel, so
    // it is reported as a gap (play recovers it) — but it is the NEWER intent.
    act(() => host().playRecorded(DEVICE, CURSOR, 'low'))
    const a = newChannel()
    act(() => a.open())
    // The older clip must not come back and put the pointer in a file the
    // operator already left.
    expect(pointerMoves(a).filter((m) => m.t === 'playClip')).toEqual([])
  })
})
