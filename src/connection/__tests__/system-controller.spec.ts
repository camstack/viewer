import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { CandidateRaceOutcome } from '../candidate-probe.js'
import { SystemController } from '../system-controller.js'

// vi.mock is hoisted above module-scope consts, so the spies must be created
// inside vi.hoisted() to be initialised before the mock factory runs.
const { switchServerUrl, reconnect, authMe, createSystem, raceFastestEndpoint } = vi.hoisted(() => {
  const switchServerUrl = vi.fn()
  const reconnect = vi.fn()
  // The resume probe's round-trip. A fake that always resolves would make the
  // "socket did not survive" branch untestable — which is the branch the whole
  // probe exists for.
  const authMe = vi.fn(async () => ({ id: 1 }))
  return {
    switchServerUrl,
    reconnect,
    authMe,
    // `serverUrl` is part of the real `System` contract and the controller reads
    // it to decide whether a race winner is actually a CHANGE. A fake without it
    // cannot exercise that branch — the omission is why the redundant-switch
    // behaviour went unmeasured for so long.
    createSystem: vi.fn(() => ({
      serverUrl: 'https://public:4443',
      switchServerUrl,
      reconnect,
      trpcClient: { auth: { me: { query: authMe } } },
      close: vi.fn(),
    })),
    raceFastestEndpoint: vi.fn(async (_urls: readonly string[], _timeoutMs: number) =>
      'https://lan:4443',
    ),
  }
})

vi.mock('@camstack/sdk', () => ({ createSystem }))


/**
 * The controller no longer calls the SDK's `raceFastestEndpoint` — that one
 * probes `/trpc/health` with a GET, which the tRPC plugin answers 404, so it
 * could never elect anything. The race is now the controller's own, against
 * `/health`, and it is injected here.
 *
 * The spy keeps its old meaning: ONE call per race. So every count below still
 * asserts what it asserted.
 */
function raceSeam(): (urls: readonly string[], timeoutMs: number) => Promise<CandidateRaceOutcome> {
  return async (urls, timeoutMs) => {
    // Args forwarded so the existing `toHaveBeenCalledWith(candidates, ms)`
    // assertions keep testing the candidate set the race was given.
    const picked = await raceFastestEndpoint([...urls], timeoutMs)
    // A race can only elect a candidate it was OFFERED. Honouring the list is
    // what makes the seam able to show a dropped candidate not winning.
    const winner = picked !== null && urls.includes(picked) ? picked : null
    return {
      winner,
      results: urls.map((url) => ({
        url,
        ok: url === winner,
        ms: url === winner ? 5 : 9,
        status: url === winner ? 200 : null,
        error: url === winner ? null : 'Error: probe failed',
      })),
    }
  }
}

beforeEach(() => {
  switchServerUrl.mockClear()
  createSystem.mockClear()
  raceFastestEndpoint.mockClear()
  reconnect.mockClear()
  authMe.mockClear()
  authMe.mockImplementation(async () => ({ id: 1 }))
})

describe('SystemController', () => {
  it('creates a System for the active server and races candidates on connect', async () => {
    const ctrl = new SystemController({
      serverUrl: 'https://public:4443',
      token: 'jwt',
      candidates: ['https://lan:4443', 'https://public:4443'],
      raceCandidatesImpl: raceSeam(),
    })
    await ctrl.connect()
    // `connect()` no longer waits on the route decision — the app needs A
    // route to show a picture, not the FASTEST one. Await the optimisation
    // explicitly to assert on its outcome.
    await ctrl.routeSettled()
    expect(createSystem).toHaveBeenCalledTimes(1)
    expect(raceFastestEndpoint).toHaveBeenCalledTimes(1)
    expect(switchServerUrl).toHaveBeenCalledWith('https://lan:4443')
  })

  it('races only the pinned URL when one is set', async () => {
    raceFastestEndpoint.mockImplementation(async (urls: readonly string[]) => urls[0] ?? null)
    const ctrl = new SystemController({
      serverUrl: 'https://public:4443',
      token: 'jwt',
      candidates: ['https://lan:4443', 'https://public:4443'],
      pinnedRouteUrl: 'https://public:4443',
      raceCandidatesImpl: raceSeam(),
    })
    await ctrl.connect()
    await ctrl.routeSettled()
    expect(raceFastestEndpoint).toHaveBeenCalledWith(['https://public:4443'], expect.any(Number))
    expect(switchServerUrl).toHaveBeenCalledWith('https://public:4443')
    expect(ctrl.getRoute().reason).toBe('pinned')
  })

  it('re-races onto a newly pinned URL', async () => {
    raceFastestEndpoint.mockImplementation(async (urls: readonly string[]) => urls[0] ?? null)
    const ctrl = new SystemController({
      serverUrl: 'https://public:4443',
      token: 'jwt',
      candidates: ['https://lan:4443', 'https://public:4443'],
      raceCandidatesImpl: raceSeam(),
    })
    await ctrl.connect()
    await ctrl.routeSettled()
    raceFastestEndpoint.mockClear()
    await ctrl.setPinnedRouteUrl('https://public:4443')
    await ctrl.routeSettled()
    expect(raceFastestEndpoint).toHaveBeenLastCalledWith(['https://public:4443'], expect.any(Number))
    expect(ctrl.getRoute().reason).toBe('pinned')
  })

  it('ignores a leftover IPv6 pin that is not among the candidates', async () => {
    raceFastestEndpoint.mockImplementation(async (urls: readonly string[]) => urls[0] ?? null)
    const ctrl = new SystemController({
      serverUrl: 'https://public:4443',
      token: 'jwt',
      candidates: ['http://192.0.2.10:4480', 'https://public:4443'],
      pinnedRouteUrl: 'http://[2a02:908:3614:bfa0::2]:4480',
      raceCandidatesImpl: raceSeam(),
    })
    await ctrl.connect()
    await ctrl.routeSettled()
    expect(ctrl.getPinnedRouteUrl()).toBeNull()
    expect(raceFastestEndpoint).toHaveBeenCalledWith(
      ['http://192.0.2.10:4480', 'https://public:4443'],
      expect.any(Number),
    )
  })

  it('honours an IPv6 pin when that URL is a race candidate', async () => {
    const ipv6 = 'http://[2a02:908:3614:bfa0::2]:4480'
    raceFastestEndpoint.mockImplementation(async (urls: readonly string[]) => urls[0] ?? null)
    const ctrl = new SystemController({
      serverUrl: 'https://public:4443',
      token: 'jwt',
      candidates: ['http://192.0.2.10:4480', ipv6, 'https://public:4443'],
      pinnedRouteUrl: ipv6,
      raceCandidatesImpl: raceSeam(),
    })
    await ctrl.connect()
    await ctrl.routeSettled()
    expect(ctrl.getPinnedRouteUrl()).toBe(ipv6)
    expect(raceFastestEndpoint).toHaveBeenCalledWith([ipv6], expect.any(Number))
    expect(ctrl.getRoute().reason).toBe('pinned')
  })

  it('re-races when the connection recovers (disconnected → connected)', async () => {
    const ctrl = new SystemController({
      serverUrl: 'https://public:4443',
      token: 'jwt',
      candidates: ['https://lan:4443', 'https://public:4443'],
      raceCandidatesImpl: raceSeam(),
    })
    await ctrl.connect()
    await ctrl.routeSettled()
    raceFastestEndpoint.mockClear()
    switchServerUrl.mockClear()

    await ctrl.handleStateChange('disconnected')
    await ctrl.handleStateChange('connected')
    await ctrl.routeSettled()

    expect(raceFastestEndpoint).toHaveBeenCalledTimes(1)
    expect(switchServerUrl).toHaveBeenCalledWith('https://lan:4443')
  })

  it('does not re-race while merely staying connected', async () => {
    const ctrl = new SystemController({
      serverUrl: 'https://public:4443',
      token: 'jwt',
      candidates: ['https://lan:4443'],
      raceCandidatesImpl: raceSeam(),
    })
    await ctrl.connect()
    await ctrl.routeSettled()
    raceFastestEndpoint.mockClear()
    await ctrl.handleStateChange('connected')
    await ctrl.routeSettled()
    expect(raceFastestEndpoint).not.toHaveBeenCalled()
  })

  it('notifies onStateChange observers', async () => {
    const ctrl = new SystemController({
      serverUrl: 'https://public:4443',
      candidates: [],
      raceCandidatesImpl: raceSeam(),
    })
    const seen: string[] = []
    ctrl.onStateChange = (s) => seen.push(s)
    await ctrl.connect()
    await ctrl.handleStateChange('disconnected')
    expect(seen).toContain('disconnected')
  })

  it('subscribe attaches both observers and detach silences them (teardown echo)', async () => {
    const ctrl = new SystemController({
      serverUrl: 'https://public:4443',
      candidates: [],
      raceCandidatesImpl: raceSeam(),
    })
    const seen: string[] = []
    const unauthorized: string[] = []
    const detach = ctrl.subscribe({
      onStateChange: (s) => seen.push(s),
      onUnauthorized: () => unauthorized.push('401'),
    })
    await ctrl.connect()
    await ctrl.handleStateChange('connected')
    // Let the fire-and-forget verifySession settle (the mock System rejects
    // it) so no in-flight emission lands after the snapshot below.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(seen).toContain('connected')

    // Detached BEFORE dispose: the close()-emitted 'disconnected' echo must
    // not reach the dead observer (the post-login stuck-offline regression).
    const seenBeforeDetach = seen.length
    detach()
    await ctrl.handleStateChange('disconnected')
    ctrl.dispose()
    expect(seen.length).toBe(seenBeforeDetach)
    expect(unauthorized).toEqual([])
  })

  it('detach is a no-op when a newer observer pair has been attached since', async () => {
    const ctrl = new SystemController({
      serverUrl: 'https://public:4443',
      candidates: [],
      raceCandidatesImpl: raceSeam(),
    })
    const first: string[] = []
    const second: string[] = []
    const detachFirst = ctrl.subscribe({
      onStateChange: (s) => first.push(s),
      onUnauthorized: () => {},
    })
    ctrl.subscribe({
      onStateChange: (s) => second.push(s),
      onUnauthorized: () => {},
    })
    // Stale detach must not silence the CURRENT observer (last writer wins).
    detachFirst()
    await ctrl.handleStateChange('connected')
    expect(second).toContain('connected')
    expect(first).toEqual([])
  })
})

describe('SystemController.verifyAfterResume', () => {
  /** A controller whose transport the SDK reports as up. */
  async function connected(): Promise<SystemController> {
    const ctrl = new SystemController({
      serverUrl: 'https://public:4443',
      candidates: [],
      raceCandidatesImpl: raceSeam(),
    })
    await ctrl.connect()
    await ctrl.routeSettled()
    return ctrl
  }

  it('leaves a healthy socket alone', async () => {
    const ctrl = await connected()
    expect(await ctrl.verifyAfterResume(8 * 3_600_000)).toBe('healthy')
    expect(reconnect).not.toHaveBeenCalled()
  })

  it('rebuilds the transport when the socket does not answer', async () => {
    // A suspended socket does not reject — it says nothing at all, which is why
    // the probe is bounded rather than gated on an error.
    const ctrl = await connected()
    authMe.mockImplementation(() => new Promise(() => undefined))
    const outcome = await ctrl.verifyAfterResume(8 * 3_600_000)
    expect(outcome).toBe('rebuilt')
    expect(reconnect).toHaveBeenCalledTimes(1)
  })

  it('asks nothing for a glance away', async () => {
    const ctrl = await connected()
    expect(await ctrl.verifyAfterResume(2_000)).toBe('brief-away')
    expect(authMe).not.toHaveBeenCalled()
    expect(reconnect).not.toHaveBeenCalled()
  })

  it('asks nothing when the transport already reported itself down', async () => {
    const ctrl = await connected()
    await ctrl.handleStateChange('disconnected')
    authMe.mockClear()
    expect(await ctrl.verifyAfterResume(60_000)).toBe('already-down')
    expect(authMe).not.toHaveBeenCalled()
    expect(reconnect).not.toHaveBeenCalled()
  })

  it('hands an expired session to the sign-out path instead of redialling it', async () => {
    const ctrl = await connected()
    const unauthorized: string[] = []
    ctrl.onUnauthorized = () => unauthorized.push('401')
    authMe.mockImplementation(() => Promise.reject(new Error('UNAUTHORIZED')))
    expect(await ctrl.verifyAfterResume(60_000)).toBe('unauthorized')
    expect(unauthorized).toEqual(['401'])
    expect(reconnect).not.toHaveBeenCalled()
  })
})
