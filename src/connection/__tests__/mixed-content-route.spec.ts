import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { CandidateRaceOutcome } from '../candidate-probe.js'
import { dropMixedContentUrls, isMixedContentUrl } from '../endpoint-discovery.js'
import { SystemController } from '../system-controller.js'

const { switchServerUrl, createSystem } = vi.hoisted(() => {
  const switchServerUrl = vi.fn()
  return {
    switchServerUrl,
    createSystem: vi.fn(() => ({
      serverUrl: 'https://camstack.example.top',
      switchServerUrl,
      reconnect: vi.fn(),
      trpcClient: { auth: { me: { query: vi.fn(async () => ({ id: 1 })) } } },
      close: vi.fn(),
    })),
  }
})

vi.mock('@camstack/sdk', () => ({ createSystem }))

const LAN_HTTP = 'http://192.0.2.10:4480'
const TUNNEL = 'https://camstack.example.top'

/** A race that elects the FIRST url it is offered — the stored order puts LAN first. */
function firstWins(offered: string[][]): (urls: readonly string[]) => Promise<CandidateRaceOutcome> {
  return async (urls) => {
    offered.push([...urls])
    const winner = urls[0] ?? null
    return {
      winner,
      results: urls.map((url) => ({ url, ok: url === winner, ms: 5, status: 200, error: null })),
    }
  }
}

beforeEach(() => {
  switchServerUrl.mockClear()
  createSystem.mockClear()
})

describe('isMixedContentUrl / dropMixedContentUrls', () => {
  it('an http:// URL from an https page is mixed content', () => {
    expect(isMixedContentUrl(LAN_HTTP, 'https:')).toBe(true)
    expect(isMixedContentUrl(TUNNEL, 'https:')).toBe(false)
  })

  it('native (no page) and an http page keep every URL', () => {
    expect(isMixedContentUrl(LAN_HTTP, null)).toBe(false)
    expect(isMixedContentUrl(LAN_HTTP, 'http:')).toBe(false)
    expect(dropMixedContentUrls([LAN_HTTP, TUNNEL], null)).toEqual([LAN_HTTP, TUNNEL])
  })

  it('drops only the http:// candidates from an https page, keeping order', () => {
    expect(dropMixedContentUrls([LAN_HTTP, TUNNEL, 'https://192.0.2.10:4443'], 'https:')).toEqual([
      TUNNEL,
      'https://192.0.2.10:4443',
    ])
  })
})

describe('SystemController on an https page', () => {
  // Operator report 2026-10-06: the stored endpoint list put the LAN plain-HTTP
  // endpoint (priority 0) ahead of the tunnel, and on the hosted PWA the race
  // could elect it — mixed content that only some Chrome builds let through.
  it('never offers a plain-http candidate to the race', async () => {
    const offered: string[][] = []
    const ctrl = new SystemController({
      serverUrl: TUNNEL,
      token: 'jwt',
      candidates: [LAN_HTTP, TUNNEL],
      pageProtocol: 'https:',
      raceCandidatesImpl: firstWins(offered),
    })
    await ctrl.connect()
    await ctrl.routeSettled()
    expect(offered.flat()).not.toContain(LAN_HTTP)
    expect(switchServerUrl).not.toHaveBeenCalledWith(LAN_HTTP)
  })

  it('ignores a stored plain-http pin', async () => {
    const offered: string[][] = []
    const ctrl = new SystemController({
      serverUrl: TUNNEL,
      token: 'jwt',
      candidates: [TUNNEL],
      pinnedRouteUrl: LAN_HTTP,
      pageProtocol: 'https:',
      raceCandidatesImpl: firstWins(offered),
    })
    expect(ctrl.getPinnedRouteUrl()).toBeNull()
    await ctrl.connect()
    await ctrl.routeSettled()
    expect(offered.flat()).not.toContain(LAN_HTTP)
  })

  it('native (no page protocol) still races the LAN http endpoint first', async () => {
    const offered: string[][] = []
    const ctrl = new SystemController({
      serverUrl: TUNNEL,
      token: 'jwt',
      candidates: [LAN_HTTP, TUNNEL],
      pageProtocol: null,
      raceCandidatesImpl: firstWins(offered),
    })
    await ctrl.connect()
    await ctrl.routeSettled()
    expect(offered[0]).toEqual([LAN_HTTP, TUNNEL])
    expect(switchServerUrl).toHaveBeenCalledWith(LAN_HTTP)
  })
})
