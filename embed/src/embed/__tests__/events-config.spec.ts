import { afterEach, describe, expect, it } from 'vitest'
import {
  applyEventsConfigPatch,
  cardEdgePx,
  DEFAULT_EVENTS_FIELDS,
  DEFAULT_EVENTS_MAX_ROWS,
  DEFAULT_EVENTS_PAGE_SIZE,
  type EventsConfig,
  parseEventsConfig,
  readEventsConfig,
  REEL_EVENTS_MAX_ROWS,
  resolveMaxRows,
  thumbEdgePx,
} from '../events-config'

const MINIMAL = { serverUrl: 'https://hub:4443', token: 'jwt' }

function parsed(raw: unknown): EventsConfig {
  const result = parseEventsConfig(raw)
  if (!result.ok) throw new Error(result.error)
  return result.config
}

afterEach(() => {
  delete (window as unknown as { __CAMSTACK_EVENTS__?: unknown }).__CAMSTACK_EVENTS__
})

describe('parseEventsConfig', () => {
  it('fills every optional field so a two-field host still gets a working reel', () => {
    const config = parsed(MINIMAL)
    expect(config.view).toBe('reel')
    expect(config.rows).toBe(1)
    expect(config.columns).toBe('auto')
    expect(config.thumbSize).toBe('medium')
    expect(config.fields).toEqual(DEFAULT_EVENTS_FIELDS)
    expect(config.deviceIds).toEqual([])
    expect(config.classes).toEqual([])
    expect(config.pageSize).toBe(DEFAULT_EVENTS_PAGE_SIZE)
    expect(config.maxRows).toBe(DEFAULT_EVENTS_MAX_ROWS)
    expect(config.theme).toBe('auto')
    expect(config.refreshMs).toBe(0)
  })

  it('the ROW CEILING is resolved per view — the two are not one bound', () => {
    // The gallery is virtualized, so its bound is memory. The reel mounts
    // every card it holds, so its bound is still the DOM — and a host that
    // simply inherits the default must not hand a strip 5 000 live nodes.
    expect(resolveMaxRows({ view: 'gallery', maxRows: DEFAULT_EVENTS_MAX_ROWS })).toBe(
      DEFAULT_EVENTS_MAX_ROWS,
    )
    expect(resolveMaxRows({ view: 'reel', maxRows: DEFAULT_EVENTS_MAX_ROWS })).toBe(
      REEL_EVENTS_MAX_ROWS,
    )
    // A host asking for LESS is never talked up.
    expect(resolveMaxRows({ view: 'reel', maxRows: 120 })).toBe(120)
    expect(resolveMaxRows({ view: 'gallery', maxRows: 120 })).toBe(120)
  })

  it('requires the two identity fields', () => {
    expect(parseEventsConfig({ token: 'jwt' }).ok).toBe(false)
    expect(parseEventsConfig({ serverUrl: 'https://hub' }).ok).toBe(false)
    expect(parseEventsConfig(undefined).ok).toBe(false)
    expect(parseEventsConfig(null).ok).toBe(false)
  })

  it('reports the offending path in the error', () => {
    const result = parseEventsConfig({ ...MINIMAL, view: 'carousel' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('view')
  })

  it('bounds the numeric knobs', () => {
    expect(parseEventsConfig({ ...MINIMAL, rows: 0 }).ok).toBe(false)
    expect(parseEventsConfig({ ...MINIMAL, rows: 7 }).ok).toBe(false)
    expect(parseEventsConfig({ ...MINIMAL, pageSize: 501 }).ok).toBe(false)
    expect(parseEventsConfig({ ...MINIMAL, columns: 0 }).ok).toBe(false)
    expect(parseEventsConfig({ ...MINIMAL, columns: 'auto' }).ok).toBe(true)
  })

  it('accepts refreshMs 0 — polling off is a real setting, not a missing one', () => {
    expect(parsed({ ...MINIMAL, refreshMs: 0 }).refreshMs).toBe(0)
  })

  it('carries no `entity`, and a legacy host that still sends one still parses', () => {
    // Co-moving track groups were deleted (D330). The field is gone from the
    // schema; Zod STRIPS unknown keys, so an older host — native or external
    // iframe — that still injects `entity` gets a working feed, not a rejected
    // config.
    expect(Object.keys(parsed(MINIMAL))).not.toContain('entity')
    expect(parseEventsConfig({ ...MINIMAL, entity: 'groups' }).ok).toBe(true)
    expect(Object.keys(parsed({ ...MINIMAL, entity: 'groups' }))).not.toContain('entity')
  })
})

describe('applyEventsConfigPatch', () => {
  it('is immutable', () => {
    const base = parsed(MINIMAL)
    const next = applyEventsConfigPatch(base, { view: 'gallery' })
    expect(base.view).toBe('reel')
    expect(next.view).toBe('gallery')
  })

  it('merges `fields` key-by-key so one toggle does not reset the rest', () => {
    const base = parsed(MINIMAL)
    const next = applyEventsConfigPatch(base, { fields: { time: false } })
    expect(next.fields).toEqual({ ...DEFAULT_EVENTS_FIELDS, time: false })
  })

  it('keeps the identity fields', () => {
    const base = parsed(MINIMAL)
    const next = applyEventsConfigPatch(base, { thumbSize: 'large' })
    expect(next.serverUrl).toBe('https://hub:4443')
    expect(next.token).toBe('jwt')
  })

  it('nativePullToRefresh defaults OFF and is patchable ON — the native-host gesture handoff', () => {
    const base = parsed(MINIMAL)
    expect(base.nativePullToRefresh).toBe(false)
    const next = applyEventsConfigPatch(base, { nativePullToRefresh: true })
    expect(next.nativePullToRefresh).toBe(true)
  })
})

describe('thumb sizing', () => {
  it('stays inside the media plane clamp [64, 320]', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      expect(thumbEdgePx(size)).toBeGreaterThanOrEqual(64)
      expect(thumbEdgePx(size)).toBeLessThanOrEqual(320)
    }
  })

  it('grows monotonically with the size step', () => {
    expect(thumbEdgePx('small')).toBeLessThan(thumbEdgePx('medium'))
    expect(thumbEdgePx('medium')).toBeLessThan(thumbEdgePx('large'))
    expect(cardEdgePx('small')).toBeLessThan(cardEdgePx('medium'))
    expect(cardEdgePx('medium')).toBeLessThan(cardEdgePx('large'))
  })

  it('requests a thumbnail at least as large as the card renders it', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      expect(thumbEdgePx(size)).toBeGreaterThanOrEqual(cardEdgePx(size))
    }
  })
})

describe('readEventsConfig', () => {
  it('errors clearly when the global is not set', () => {
    const result = readEventsConfig()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('__CAMSTACK_EVENTS__')
  })

  it('parses the host-injected global', () => {
    ;(window as unknown as { __CAMSTACK_EVENTS__?: unknown }).__CAMSTACK_EVENTS__ = {
      ...MINIMAL,
      view: 'gallery',
    }
    const result = readEventsConfig()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.view).toBe('gallery')
  })
})
