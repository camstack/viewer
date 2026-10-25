/**
 * The theater timeline's `listTracks` REQUEST — the shape that decides how many
 * megabytes cross the socket.
 *
 * ## What these tests are protecting
 *
 * On 2026-08-14 the camera "Camera hall" (deviceId 104) showed an EMPTY
 * timeline for the whole day while the hub held 380 tracks for it. Measured
 * against the live hub, the request the timeline sent —
 * `listTracks { deviceId: 104, since: <today 00:00>, until: <midnight>,
 * limit: 500 }`, i.e. the DEFAULT `full` projection — answered with
 * **7 955 866 bytes**: 380 rows carrying 31 667 `positions[]` entries and 1 066
 * `snapshots[]` references. The same request with `projection: 'slim'`
 * answered with **374 343 bytes** — 21× smaller — and kept every field the
 * timeline renders, `envelope` included.
 *
 * That payload does not deserialize on a phone inside `CAP_QUERY_DEADLINE_MS`,
 * so `capQuery` returned null and the timeline drew an empty day. The
 * operator's own device shipped the proof:
 *
 *   [app:warn:cap] "pipelineAnalytics.listTracks" hit its deadline
 *                  { deviceId: 104, deadlineMs: 6000 }
 *   [app:info:theater:clusters] render state
 *                  { deviceId: 104, objectEvents: 0, clusters: 0, zone: null }
 *
 * five minutes before the same screen logged `objectEvents: 380, clusters: 19`.
 *
 * So: the timeline must ask for `slim` unless something on screen actually
 * needs `positions[]`, and the ONLY thing that does is the drawn zone filter's
 * per-position test. These tests pin that rule.
 */
import { describe, it, expect } from 'vitest'
import {
  buildDeviceTracksRequest,
  buildScopeTracksRequest,
  toServerTrackZone,
  TRACKS_LIMIT,
} from '../use-device-tracks.js'
import type { ZoneShape } from '../../components/camera/theater/zone-filter.js'

const FROM = 1_786_658_400_000
const UNTIL = 1_786_744_800_000

describe('toServerTrackZone — the viewer rect → the server MaskShape vocabulary', () => {
  it('renames w/h to width/height (the server schema spells them out)', () => {
    // A silent mismatch here is not a type error at the wire — Zod STRIPS
    // unknown keys — so `{w,h}` would arrive as a zero-sized zone and the
    // server would answer with nothing at all.
    const zone: ZoneShape = { kind: 'rect', rect: { x: 0.5, y: 0, w: 0.5, h: 1 } }
    expect(toServerTrackZone(zone)).toEqual({
      kind: 'rect',
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 1,
    })
  })

  it('passes a polygon through as its ordered points', () => {
    const points = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.2 },
      { x: 0.5, y: 0.8 },
    ]
    expect(toServerTrackZone({ kind: 'polygon', points })).toEqual({ kind: 'polygon', points })
  })

  it('has nothing to send when no zone is drawn', () => {
    expect(toServerTrackZone(null)).toBeNull()
  })
})

describe('buildDeviceTracksRequest — projection is chosen, never defaulted', () => {
  it('asks for SLIM when no zone is drawn — the 21× payload cut', () => {
    // This is the request that was 7.9 MB and is now 374 KB. `full` is the
    // server's DEFAULT, so omitting `projection` is not neutral: it is the
    // expensive choice, made by accident.
    const req = buildDeviceTracksRequest(104, FROM, UNTIL, null)
    expect(req.projection).toBe('slim')
    expect(req.zone).toBeUndefined()
    expect(req).toMatchObject({ deviceId: 104, since: FROM, until: UNTIL, limit: TRACKS_LIMIT })
  })

  it('asks for FULL only when a drawn zone needs the per-position boxes', () => {
    // `slim` returns `positions: []`, which would drop the zone filter to its
    // envelope fallback — the generous trajectory-bounds test the module doc
    // calls a fallback for legacy rows. A zone the operator drew deserves the
    // exact test, so this is the one case that pays for `positions[]`.
    const req = buildDeviceTracksRequest(104, FROM, UNTIL, {
      kind: 'rect',
      rect: { x: 0.5, y: 0, w: 0.5, h: 1 },
    })
    expect(req.projection).toBe('full')
  })

  it('sends the zone to the SERVER too, so `full` never means "all of it"', () => {
    // The server prefilters on the persisted envelope columns and then tests
    // per position — the same answer the client computes, minus the rows.
    // Measured on 104/today: 380 rows unfiltered, 305 for the right half, 45
    // for a left strip. Without this, drawing a zone on a busy camera puts the
    // full 7.9 MB back on the wire and the deadline fires again.
    const req = buildDeviceTracksRequest(104, FROM, UNTIL, {
      kind: 'rect',
      rect: { x: 0, y: 0, w: 0.2, h: 1 },
    })
    expect(req.zone).toEqual({ kind: 'rect', x: 0, y: 0, width: 0.2, height: 1 })
  })
})

describe('the request is the query key', () => {
  it('a zone change produces a DIFFERENT request, so the cache cannot serve the old one', () => {
    // The zone used to be applied purely client-side, so it was correctly
    // absent from the key. Now that it rides the request, a key that ignored
    // it would hand back the previous zone's rows forever.
    const none = buildDeviceTracksRequest(104, FROM, UNTIL, null)
    const left = buildDeviceTracksRequest(104, FROM, UNTIL, {
      kind: 'rect',
      rect: { x: 0, y: 0, w: 0.2, h: 1 },
    })
    const right = buildDeviceTracksRequest(104, FROM, UNTIL, {
      kind: 'rect',
      rect: { x: 0.5, y: 0, w: 0.5, h: 1 },
    })
    expect(JSON.stringify(none)).not.toBe(JSON.stringify(left))
    expect(JSON.stringify(left)).not.toBe(JSON.stringify(right))
  })
})

/**
 * The class chips ride the request, like the zone already did.
 *
 * They used to narrow a day of rows already downloaded — the same shape of
 * waste the projection fix above was written for, left behind when the zone
 * moved server-side.
 */
describe('buildDeviceTracksRequest — the class filter', () => {
  it('puts the expanded classes on the request', () => {
    const req = buildDeviceTracksRequest(101, 0, 1_000, null, ['car', 'truck', 'vehicle'])
    expect(req.classes).toEqual(['car', 'truck', 'vehicle'])
  })

  it('omits the field entirely when nothing is selected', () => {
    // Not `classes: []` — an empty list is a value the server has to interpret,
    // and "no filter" is better said by not saying anything.
    expect('classes' in buildDeviceTracksRequest(101, 0, 1_000, null, null)).toBe(false)
    expect('classes' in buildDeviceTracksRequest(101, 0, 1_000, null, [])).toBe(false)
  })

  it('keeps the cheap projection — a class filter is not a reason to send positions', () => {
    // Only the drawn zone's per-position test needs `full`. A class selection
    // reads nothing from `positions[]`, so it must not drag 7.9 MB back.
    expect(buildDeviceTracksRequest(101, 0, 1_000, null, ['car']).projection).toBe('slim')
  })
})

/**
 * The SCOPED request takes the same filter — one chip, one cost, whether the
 * timeline shows one camera or twelve.
 */
describe('buildScopeTracksRequest — the class filter', () => {
  it('puts the expanded classes on the scoped request too', () => {
    const req = buildScopeTracksRequest([1, 2], 0, 1_000, null, ['car', 'vehicle'])
    expect(req.classes).toEqual(['car', 'vehicle'])
  })

  it('omits the field when nothing is selected', () => {
    expect('classes' in buildScopeTracksRequest([1, 2], 0, 1_000, null, null)).toBe(false)
    expect('classes' in buildScopeTracksRequest([1, 2], 0, 1_000, null, [])).toBe(false)
  })
})
