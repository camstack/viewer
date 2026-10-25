import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  countChangedMsg,
  EVENTS_FEATURES,
  EVENTS_PROTOCOL_VERSION,
  eventsErrorMsg,
  eventsLog,
  eventsReadyMsg,
  eventsRefreshedMsg,
  eventsScrollMsg,
  eventsStateMsg,
  parseEventsCommand,
  postToEventsHost,
  trackClickMsg,
  trackListMsg,
  windowCommandToPatch,
} from '../events-messages'

interface RnBridge {
  ReactNativeWebView?: { postMessage: (s: string) => void }
}

afterEach(() => {
  delete (window as unknown as RnBridge).ReactNativeWebView
})

describe('events host message builders', () => {
  it('stamps the protocol version on every message', () => {
    const messages = [
      eventsReadyMsg('reel'),
      eventsErrorMsg('boom'),
      eventsStateMsg('ready'),
      countChangedMsg(1, 2, true),
      trackClickMsg({
        trackId: 't1',
        deviceId: 101,
        bestEventId: 'e1',
        className: 'person',
        firstSeen: 1,
        lastSeen: 2,
      }),
    ]
    for (const m of messages) expect(m.v).toBe(EVENTS_PROTOCOL_VERSION)
  })

  it('builds ready with the active view AND the capability list', () => {
    // `features` is how a host tells a NEW embed from a deployed old one: the
    // viewer and the embed ship on different chains, so "the command did
    // nothing" must be answerable without probing.
    expect(eventsReadyMsg('gallery')).toEqual({
      v: 1,
      type: 'ready',
      view: 'gallery',
      features: ['window', 'semantic-search', 'macro-classes', 'device-names', 'kind-labels', 'heartbeat', 'track-list', 'attr-filters', 'flag-filters', 'debug-status', 'native-pull-refresh', 'track-list-delta'],
    })
  })

  it('announces every feature the protocol documents', () => {
    expect([...EVENTS_FEATURES]).toEqual([
      'window',
      'semantic-search',
      'macro-classes',
      'device-names',
      'kind-labels',
      'heartbeat',
      'track-list',
      'attr-filters',
      'flag-filters',
      'debug-status',
      'native-pull-refresh',
      'track-list-delta',
    ])
  })

  it('scroll reports the native-refresh arming state, versioned', () => {
    // The one message that lets a NATIVE host arm its RefreshControl only when
    // the embed's own scroller is at the top — the exact knowledge the old
    // module note on use-pull-to-refresh said a host could never have.
    expect(eventsScrollMsg(true)).toEqual({ v: 1, type: 'scroll', atTop: true })
    expect(eventsScrollMsg(false)).toEqual({ v: 1, type: 'scroll', atTop: false })
  })

  it('refreshed acknowledges a host-commanded refresh, versioned', () => {
    // Without this ack a native RefreshControl has nothing to close on.
    expect(eventsRefreshedMsg()).toEqual({ v: 1, type: 'refreshed' })
  })

  it('omits the optional state detail when absent', () => {
    expect(eventsStateMsg('empty')).toEqual({ v: 1, type: 'state', state: 'empty' })
    expect(eventsStateMsg('error', 'nope')).toEqual({
      v: 1,
      type: 'state',
      state: 'error',
      message: 'nope',
    })
  })

  it('carries every field a host needs to open a detail view from a click', () => {
    expect(
      trackClickMsg({
        trackId: 't1',
        deviceId: 102,
        bestEventId: 'evt-9',
        className: 'vehicle',
        firstSeen: 100,
        lastSeen: 200,
      }),
    ).toEqual({
      v: 1,
      type: 'trackClick',
      trackId: 't1',
      deviceId: 102,
      bestEventId: 'evt-9',
      className: 'vehicle',
      firstSeen: 100,
      lastSeen: 200,
    })
  })

  it('trackList carries the ORDERED shown rows a host needs for prev/next navigation', () => {
    expect(
      trackListMsg([
        { trackId: 't1', deviceId: 101, bestEventId: 'e1', className: 'person', firstSeen: 1, lastSeen: 2 },
        { trackId: 't2', deviceId: 102, bestEventId: 'e2', className: 'vehicle', firstSeen: 3, lastSeen: 4 },
      ], 7),
    ).toEqual({
      v: 1,
      type: 'trackList',
      seq: 7,
      tracks: [
        { trackId: 't1', deviceId: 101, bestEventId: 'e1', className: 'person', firstSeen: 1, lastSeen: 2 },
        { trackId: 't2', deviceId: 102, bestEventId: 'e2', className: 'vehicle', firstSeen: 3, lastSeen: 4 },
      ],
    })
  })

  it('countChanged separates loaded from shown, and defaults to the feed mode', () => {
    expect(countChangedMsg(120, 12, false)).toEqual({
      v: 1,
      type: 'countChanged',
      loaded: 120,
      shown: 12,
      hasMore: false,
      mode: 'feed',
    })
  })

  it('countChanged reports SEMANTIC results as their own mode', () => {
    // A search result set is complete, not a page — a host must not render a
    // "load more" affordance for it.
    expect(countChangedMsg(9, 9, false, 'semantic')).toMatchObject({
      mode: 'semantic',
      hasMore: false,
    })
  })
})

describe('postToEventsHost', () => {
  it('serialises through the native bridge when present', () => {
    const postMessage = vi.fn()
    ;(window as unknown as RnBridge).ReactNativeWebView = { postMessage }
    postToEventsHost(eventsReadyMsg('reel'))
    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({
        v: 1,
        type: 'ready',
        view: 'reel',
        features: [
          'window',
          'semantic-search',
          'macro-classes',
          'device-names',
          'kind-labels',
          'heartbeat',
          'track-list',
          'attr-filters',
          'flag-filters',
          'debug-status',
          'native-pull-refresh',
          'track-list-delta',
        ],
      }),
    )
  })

  it('is a no-op with no host bridge at all', () => {
    expect(() => postToEventsHost(eventsStateMsg('ready'))).not.toThrow()
  })
})

describe('eventsLog', () => {
  it('rides the shared log channel with a feed scope', () => {
    const postMessage = vi.fn()
    ;(window as unknown as RnBridge).ReactNativeWebView = { postMessage }
    eventsLog('delta drain hit its page bound', { pages: 5 })
    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'log',
        scope: 'feed',
        msg: 'delta drain hit its page bound',
        data: { pages: 5 },
      }),
    )
  })
})

describe('parseEventsCommand', () => {
  it('accepts the bare verbs', () => {
    expect(parseEventsCommand({ type: 'refresh' })).toEqual({ type: 'refresh' })
    expect(parseEventsCommand({ type: 'reload' })).toEqual({ type: 'reload' })
    expect(parseEventsCommand({ type: 'loadMore' })).toEqual({ type: 'loadMore' })
    expect(parseEventsCommand({ type: 'scrollToTop' })).toEqual({ type: 'scrollToTop' })
    expect(parseEventsCommand({ type: 'ping' })).toEqual({ type: 'ping' })
  })

  it('accepts setTrackFlagPatches — a dedicated command, not a setConfig field', () => {
    // Mixing a new field into setConfig would drop the WHOLE patch on an older
    // embed (the schema rejects unknowns as one unit). A new command is ignored
    // instead, so filterDebug keeps working on a deployed build that has not
    // learned this verb yet.
    expect(
      parseEventsCommand({
        type: 'setTrackFlagPatches',
        patches: { 'trk-1': { debug: true, markForTrain: false, favourited: false } },
      }),
    ).toEqual({
      type: 'setTrackFlagPatches',
      patches: { 'trk-1': { debug: true, markForTrain: false, favourited: false } },
    })
    expect(parseEventsCommand({ type: 'setTrackFlagPatches', patches: 'nope' })).toBeNull()
  })

  it('accepts a nativePullToRefresh patch — the native-host gesture handoff', () => {
    expect(
      parseEventsCommand({ type: 'setConfig', patch: { nativePullToRefresh: true } }),
    ).toEqual({ type: 'setConfig', patch: { nativePullToRefresh: true } })
  })

  it('validates a setConfig patch', () => {
    const cmd = parseEventsCommand({
      type: 'setConfig',
      patch: { view: 'gallery', thumbSize: 'large', deviceIds: [101, 102] },
    })
    expect(cmd).toEqual({
      type: 'setConfig',
      patch: { view: 'gallery', thumbSize: 'large', deviceIds: [101, 102] },
    })
  })

  it('rejects an invalid patch WHOLE — never partially applied', () => {
    expect(parseEventsCommand({ type: 'setConfig', patch: { view: 'carousel' } })).toBeNull()
    expect(
      parseEventsCommand({ type: 'setConfig', patch: { rows: 99, thumbSize: 'large' } }),
    ).toBeNull()
  })

  it('ignores anything unrecognised rather than crashing', () => {
    expect(parseEventsCommand(null)).toBeNull()
    expect(parseEventsCommand('refresh')).toBeNull()
    expect(parseEventsCommand({ type: 'selfDestruct' })).toBeNull()
    expect(parseEventsCommand({})).toBeNull()
  })

  it('accepts setWindow, and keeps CLEAR distinct from LEAVE ALONE', () => {
    // `null` clears a bound (back to the rolling feed); an omitted bound leaves
    // it untouched. A day-navigation host needs both and they are not the same.
    expect(parseEventsCommand({ type: 'setWindow', sinceMs: 1000, untilMs: 2000 })).toEqual({
      type: 'setWindow',
      sinceMs: 1000,
      untilMs: 2000,
    })
    expect(parseEventsCommand({ type: 'setWindow', untilMs: null })).toEqual({
      type: 'setWindow',
      untilMs: null,
    })
    expect(parseEventsCommand({ type: 'setWindow' })).toEqual({ type: 'setWindow' })
  })

  it('rejects a malformed window rather than half-applying it', () => {
    expect(parseEventsCommand({ type: 'setWindow', sinceMs: -1 })).toBeNull()
    expect(parseEventsCommand({ type: 'setWindow', untilMs: 'yesterday' })).toBeNull()
  })

  it('setWindow and setConfig mean the SAME patch', () => {
    expect(windowCommandToPatch({ sinceMs: 10, untilMs: 20 })).toEqual({ sinceMs: 10, untilMs: 20 })
    expect(windowCommandToPatch({ untilMs: null })).toEqual({ untilMs: null })
    expect(windowCommandToPatch({})).toEqual({})
  })

  it('accepts the new config knobs', () => {
    expect(parseEventsCommand({ type: 'setConfig', patch: { searchMode: 'semantic' } })).toEqual({
      type: 'setConfig',
      patch: { searchMode: 'semantic' },
    })
  })

  it('an older host still sending an order is not refused — the order is dropped', () => {
    // The feed is newest first, always. A host built before the order was
    // removed must keep working; its `sort` is simply not a knob any more.
    expect(parseEventsCommand({ type: 'setConfig', patch: { sort: 'importance' } })).toEqual({
      type: 'setConfig',
      patch: {},
    })
  })

  it('refuses to patch the embed identity', () => {
    const cmd = parseEventsCommand({
      type: 'setConfig',
      patch: { token: 'other', serverUrl: 'https://evil', view: 'reel' },
    })
    expect(cmd).toEqual({ type: 'setConfig', patch: { view: 'reel' } })
  })
})
