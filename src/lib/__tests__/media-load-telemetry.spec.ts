/**
 * A reel of broken thumbnails must leave ONE line on the hub, with enough to
 * tell a refused request from an unreachable host — and never a credential.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { log } from '../logger.js'
import { MEDIA_LOAD_QUIET_MS, noteMediaLoad, resetMediaLoadTelemetry } from '../media-load-telemetry.js'

interface Line { level: 'info' | 'warn'; data: Record<string, unknown> }
const lines: Line[] = []
const URI = 'https://hub.example:4443/event-media/o/track/8841?kind=thumb&token=SECRETTOKEN&w=320'
const base = { surface: 'reel', uri: URI, hasBearer: true, deviceId: 7, pageOrigin: 'https://hub.example:4443' } as const

beforeEach(() => {
  vi.useFakeTimers()
  lines.length = 0
  resetMediaLoadTelemetry()
  for (const level of ['info', 'warn'] as const) {
    vi.spyOn(log, level).mockImplementation((_s: string, _m: string, data?: unknown) => {
      lines.push({ level, data: (data ?? {}) as Record<string, unknown> })
    })
  }
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const fail = (error = 'HTTP 401') => noteMediaLoad({ ...base, ok: false, error })

describe('media load telemetry', () => {
  it('reports 11 failures as ONE line with failed: 11', () => {
    for (let i = 0; i < 11; i++) fail()
    expect(lines).toHaveLength(0)
    vi.advanceTimersByTime(MEDIA_LOAD_QUIET_MS)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.data).toMatchObject({
      surface: 'reel', failed: 11, ok: 0, host: 'hub.example:4443', sameOrigin: true,
      bearer: true, kind: 'thumb', path: '/event-media/o/track/:id', deviceId: 7, errors: ['HTTP 401'],
    })
  })

  it('never carries the token, the bearer or the full URL', () => {
    noteMediaLoad({ ...base, ok: false, error: `failed ${URI} with Bearer abc` })
    vi.advanceTimersByTime(MEDIA_LOAD_QUIET_MS)
    const text = JSON.stringify(lines[0]?.data)
    expect(text).not.toContain('SECRETTOKEN')
    expect(text).not.toContain('8841')
    expect(text).not.toContain('token=')
    expect(text).not.toContain('https://')
  })

  it('is info for a mix, warn when every one failed', () => {
    fail()
    noteMediaLoad({ ...base, ok: true })
    vi.advanceTimersByTime(MEDIA_LOAD_QUIET_MS)
    fail()
    vi.advanceTimersByTime(MEDIA_LOAD_QUIET_MS)
    expect(lines.map((l) => l.level)).toEqual(['info', 'warn'])
  })

  it('keeps cumulative totals since launch across bursts', () => {
    fail(); fail()
    vi.advanceTimersByTime(MEDIA_LOAD_QUIET_MS)
    noteMediaLoad({ ...base, ok: true })
    fail()
    vi.advanceTimersByTime(MEDIA_LOAD_QUIET_MS)
    expect(lines[1]?.data).toMatchObject({ ok: 1, failed: 1, sinceLaunch: { ok: 1, failed: 3 } })
  })
})

describe('wiring', () => {
  const read = (p: string): string => readFileSync(resolve(__dirname, '../../components/events', p), 'utf8')

  it('TileHero reports both outcomes of the picture, tagged with its surface', () => {
    const src = read('gallery/TileHero.tsx')
    expect(src).toMatch(/onLoad=\{[^}]*noteMediaLoad\(\{ surface, ok: true/)
    expect(src).toMatch(/onError=\{[\s\S]*?noteMediaLoad\(\{ surface, ok: false/)
  })

  it('the reel and the gallery each name their surface', () => {
    expect(read('track/TrackReel.tsx')).toContain('surface="reel"')
    expect(read('gallery/EventTile.tsx')).toContain('surface="gallery"')
  })
})
