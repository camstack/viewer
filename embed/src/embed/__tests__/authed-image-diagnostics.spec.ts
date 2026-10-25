import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What the loader SAYS when a thumbnail does not arrive.
 *
 * On 2026-08-20 every embed thumbnail in the native app stopped rendering and
 * the only line in the hub's logs was `thumbnail transient failure {ms,
 * attempts}` — a payload that cannot tell a thrown fetch from a 502, and names
 * neither the base URL the embed was handed nor the error. Hours went into
 * guessing between "the native bridge injected no base URL" and "the plane is
 * answering 5xx", and the log could not settle it either way.
 *
 * So the catch is no longer mute: the final failure carries the REAL error
 * (name + message), the last non-ok status when there was one, and a redacted
 * description of the URL — origin and query, with the media id removed.
 */

const eventsLog = vi.fn()
vi.mock('../events-messages', () => ({ eventsLog }))

const { describeAuthedImageUrl, loadAuthedImage, resetAuthedImageCache } = await import(
  '../use-authed-image'
)

describe('describeAuthedImageUrl — enough to debug, nothing to leak', () => {
  it('keeps the origin and the query, and REDACTS the media id', () => {
    expect(
      describeAuthedImageUrl(
        'https://hub.example:4443/addon/pipeline-analytics/event-media/6269658b-c2aa-4eda-ba15-c7fc18be747a?kind=thumbnailSmall&variant=thumb&size=192',
      ),
    ).toEqual({
      origin: 'https://hub.example:4443',
      path: '/addon/pipeline-analytics/event-media/<id>',
      query: '?kind=thumbnailSmall&variant=thumb&size=192',
    })
  })

  it('says so when the URL does not parse — the exact shape a missing base URL takes', () => {
    // `${undefined}${EVENT_MEDIA_PATH}/…` and a bare relative path both land
    // here, and both are host-bridge faults rather than server faults.
    expect(describeAuthedImageUrl('undefined/addon/pipeline-analytics/event-media/x')).toEqual({
      origin: '(unparseable)',
      path: 'undefined/addon/pipeline-analyti…',
      query: '',
    })
  })
})

describe('the failure log names the cause', () => {
  beforeEach(() => {
    eventsLog.mockClear()
    resetAuthedImageCache()
    vi.useFakeTimers()
    if (typeof URL.createObjectURL !== 'function') {
      URL.createObjectURL = () => `blob:${Math.random()}`
      URL.revokeObjectURL = () => {}
    }
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    resetAuthedImageCache()
  })

  it('reports the THROWN error — the case a mute catch turned into a guess', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Load failed'))),
    )
    const pending = loadAuthedImage(
      'https://hub:4443/addon/pipeline-analytics/event-media/evt-1?variant=thumb&size=192',
      'jwt',
    )
    await vi.runAllTimersAsync()
    expect(await pending).toBeNull()

    const failure = eventsLog.mock.calls.find((c) => c[0] === 'thumbnail transient failure')
    expect(failure).toBeDefined()
    expect(failure?.[1]).toMatchObject({
      errorName: 'TypeError',
      errorMessage: 'Load failed',
      lastStatus: null,
      origin: 'https://hub:4443',
    })
  })

  it('reports the STATUS of a non-ok response that is not 401/403/404', async () => {
    // A 502 from the reverse proxy and a thrown fetch produced the SAME line
    // before this. They need completely different fixes.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 502 })),
    )
    const pending = loadAuthedImage(
      'https://hub:4443/addon/pipeline-analytics/event-media/evt-2?variant=thumb&size=192',
      'jwt',
    )
    await vi.runAllTimersAsync()
    expect(await pending).toBeNull()

    const failure = eventsLog.mock.calls.find((c) => c[0] === 'thumbnail transient failure')
    expect(failure?.[1]).toMatchObject({
      lastStatus: 502,
      errorName: null,
      errorMessage: null,
    })
  })

  it('names the origin on a deterministic miss too — 401 vs 404 is not the whole question', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 401 })),
    )
    const pending = loadAuthedImage(
      'https://hub:4443/addon/pipeline-analytics/event-media/evt-3?variant=thumb&size=192',
      'jwt',
    )
    await vi.runAllTimersAsync()
    expect(await pending).toBeNull()

    const missing = eventsLog.mock.calls.find((c) => c[0] === 'thumbnail missing')
    expect(missing?.[1]).toMatchObject({ status: 401, origin: 'https://hub:4443' })
  })
})
