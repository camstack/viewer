/**
 * @vitest-environment jsdom
 *
 * A clip tile whose still is QUEUED, painted (D573).
 *
 * This is the assertion the whole change exists for: on a real first paint 43
 * of 60 tiles answer 204 `deferred queue-full`, and before this they drew the
 * class glyph and waited for the next refetch — a tile blank with no
 * explanation, for a still that was 16 seconds away.
 *
 * Every state here is asserted with NOTHING warmed beyond the tick the answer
 * lands on, and the fetch is stubbed with a REAL `Response` carrying the real
 * headers the hub sends, prose and all — a fixture that hand-feeds the bare
 * token is exactly how the classification defect shipped green.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

import {
  EXPO_IMAGE_AUTHORIZED,
  EXPO_IMAGE_TESTID_PREFIX,
} from '../../../../testing/native-stubs/expo-image.js'
import type { ObjectEvent } from '../event-cluster.js'
import { forgetClipStills } from '../../../../clips/clip-still-memory.js'

vi.mock('../../../../app/ServerProvider.js', () => ({
  useServer: (): { token: string | null } => ({ token: 'tok' }),
}))
vi.mock('../../../../connection/ConnectionProvider.js', () => ({
  useConnection: (): { controller: { getSystem: () => { serverUrl: string } }; state: string } => ({
    controller: { getSystem: () => ({ serverUrl: 'https://hub' }) },
    state: 'connected',
  }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: (): { t: (key: string) => string } => ({ t: (key: string) => key }),
}))

const { EventThumb } = await import('../EventThumb.js')

const MINT = '/addon/provider-reolink/clip-thumb/592/687d6b38'

const CLIP_EVENT: ObjectEvent = {
  id: 'native:592:687d6b38',
  deviceId: 107,
  timestamp: 1789939024515,
  className: 'native',
  thumbnailMintUrl: MINT,
}

/** The hub's real 204, headers and prose exactly as captured on 2026-09-20. */
function deferredResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'x-camstack-disposition': 'deferred',
      'x-camstack-reason-code': 'queue-full',
      'x-camstack-reason': 'queue-full: 16 thumbnail mints already waiting for host 192.0.2.80',
      'retry-after': '16',
    },
  })
}

function finalResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'x-camstack-disposition': 'final',
      'x-camstack-reason-code': 'no-keyframe',
      'x-camstack-reason': 'no-keyframe: nothing decodable in this window',
    },
  })
}


/**
 * Module-level state outlives a test file's mounts (D574): a still held from
 * one case, or a request still in the air when its tile unmounted, would be
 * handed to the next case and the ladder assertions below would count zero
 * requests. Every spec that drives `useClipStill` must start from an empty
 * memory.
 */
beforeEach(() => {
  forgetClipStills()
})

describe('a clip tile whose still was queued', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('says it is waiting for the camera — it does not go blank', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => deferredResponse()),
    )
    render(React.createElement(EventThumb, { event: CLIP_EVENT, width: 96, height: 96 }))
    await act(async () => {})
    expect(screen.getByLabelText('v2.clips.still.queueFull')).toBeTruthy()
  })

  it('asks the mint route itself, with the session token, and only once per paint', async () => {
    const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
      deferredResponse(),
    )
    vi.stubGlobal('fetch', fetcher)
    render(React.createElement(EventThumb, { event: CLIP_EVENT, width: 96, height: 96 }))
    await act(async () => {})
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[0]).toBe(`https://hub${MINT}`)
    const init = fetcher.mock.calls[0]?.[1]
    // The session token and nothing else to the server; the signal is the
    // tile's own lifetime (a tile that leaves withdraws its request).
    expect(init?.headers).toEqual({ Authorization: 'Bearer tok' })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('draws the still once the camera produced it, from the bytes it already has', async () => {
    const jpeg = new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), {
      status: 200,
    })
    const fetcher = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(deferredResponse())
      .mockResolvedValue(jpeg)
    vi.stubGlobal('fetch', fetcher)
    render(React.createElement(EventThumb, { event: CLIP_EVENT, width: 96, height: 96 }))
    await act(async () => {})
    expect(screen.getByLabelText('v2.clips.still.queueFull')).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(21_000)
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    // The stub carries the source it was handed out as its testID. What is
    // asserted is that the tile paints from the bytes it ALREADY HAS — a
    // `data:` URI, not a third request at the mint route, which has no cache
    // and would simply rejoin the queue.
    //
    // The MIME half is deliberately not asserted: jsdom's `FileReader` does
    // not recognise undici's `Blob` and stringifies it, so the type here is
    // the environment's, not the app's. The two requests below are the real
    // contract.
    const painted = document.querySelector(`[data-testid^="${EXPO_IMAGE_TESTID_PREFIX}data:"]`)
    expect(painted).not.toBeNull()
  })

  it('latches a FINAL refusal and names it — one request, no ladder', async () => {
    const fetcher = vi.fn(async () => finalResponse())
    vi.stubGlobal('fetch', fetcher)
    render(React.createElement(EventThumb, { event: CLIP_EVENT, width: 96, height: 96 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000)
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('v2.clips.still.noKeyframe')).toBeTruthy()
  })

  it('says when it gave up, rather than spinning for ever', async () => {
    const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
      deferredResponse(),
    )
    vi.stubGlobal('fetch', fetcher)
    render(React.createElement(EventThumb, { event: CLIP_EVENT, width: 96, height: 96 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000)
    })
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(screen.getByLabelText('v2.clips.still.gaveUp')).toBeTruthy()
  })
})

/**
 * A SERVED still is rendered by the image cache — WITH the session credential.
 *
 * ## The failure this pins
 *
 * The served address answers 200 to a request carrying the token and 401 to
 * one that does not, and expo-image reports a 401 as a plain `onError`: a
 * black tile with nothing to read. On 2026-09-21 the credential was taken
 * from a variable that is additionally gated on the event-media `uri` — which
 * a native clip card does not have — so every served still went out bare.
 * The counters said it plainly: 61 asks, 61 failures, on an address that
 * answers 200 from a terminal.
 *
 * The stub carries the `Authorization` header out as an accessibility label
 * precisely so this is observable: watching the tile point at the right URL
 * was never enough.
 */
describe('EventThumb — a served still', () => {
  // The cleanup above is scoped to the mint describe; this one owns its own.
  afterEach(() => {
    cleanup()
  })

  const SERVED = '/addon/provider-reolink/clip-thumb/3628/c325d136'
  const SERVED_EVENT: ObjectEvent = {
    id: 'native:3628:c325d136',
    deviceId: 3628,
    timestamp: 1789997977000,
    className: 'native',
    thumbnailUrl: SERVED,
  }

  it('renders it through expo-image at the absolute hub address', () => {
    render(React.createElement(EventThumb, { event: SERVED_EVENT, width: 120, height: 76 }))
    expect(screen.getByTestId(`${EXPO_IMAGE_TESTID_PREFIX}https://hub${SERVED}`)).toBeTruthy()
  })

  it('carries the session token — without it the hub answers 401 and the tile is black', () => {
    render(React.createElement(EventThumb, { event: SERVED_EVENT, width: 120, height: 76 }))
    const tile = screen.getByTestId(`${EXPO_IMAGE_TESTID_PREFIX}https://hub${SERVED}`)
    expect(tile.getAttribute('aria-label')).toBe(EXPO_IMAGE_AUTHORIZED)
  })

  it('never asks the mint for a row that already has a still', () => {
    // The whole point of preferring the served one (D580): a fetch here would
    // cost a request and the disk cache both.
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(React.createElement(EventThumb, { event: SERVED_EVENT, width: 120, height: 76 }))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
