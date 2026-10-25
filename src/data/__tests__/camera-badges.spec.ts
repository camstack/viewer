import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BADGE_CAPS, parseBadgeBatch, resolveBadgeSlice } from '../use-camera-badges.js'

/**
 * The badge aggregate collapses N per-card procedures into one — and must
 * degrade to those N when the hub does not have it.
 *
 * The batch is a FRAMEWORK change, so it is not live until a `@camstack/server`
 * containing it is installed. Every hub in the field answers NOT_FOUND today,
 * which makes the fallback the path that actually runs — not a defensive
 * flourish. The two properties worth pinning are therefore: the payload is
 * narrowed rather than trusted, and the per-camera queries are genuinely
 * DISABLED when the aggregate answers (ignoring their result would replace one
 * request with two).
 */
describe('badge batch parsing', () => {
  it('keys by number, from the string keys the wire carries', () => {
    // A JSON object cannot key by number, so the procedure returns strings and
    // this is where they become ids again.
    const byId = parseBadgeBatch({
      '101': { battery: { percentage: 80, charging: 'dc', sleeping: false }, 'recording-archive': null },
      '102': { battery: null, 'recording-archive': { activeMode: 'continuous' } },
    })
    expect(byId).not.toBeNull()
    expect(byId?.[101]?.battery?.percentage).toBe(80)
    expect(byId?.[102]?.recordingMode).toBe('continuous')
    expect(byId?.[101]?.recordingMode).toBeNull()
  })

  it('carries an UNKNOWN power source through instead of calling it none', () => {
    // 'none' on the card is "on battery alone" — a hub that has not read the
    // adapter yet must not be drawn as that.
    const byId = parseBadgeBatch({
      '101': { battery: { percentage: 80, charging: 'unknown', sleeping: false }, 'recording-archive': null },
    })
    expect(byId?.[101]?.battery?.charging).toBe('unknown')
  })

  it('reads the ACTIVE recording mode, not an authored one', () => {
    // The badge claims "this camera is recording". `activeMode` is what the
    // recorder is doing; a config `mode` is what someone asked for, and the two
    // differ exactly when the badge matters.
    const byId = parseBadgeBatch({ '1': { 'recording-archive': { mode: 'continuous', activeMode: 'off' } } })
    expect(byId?.[1]?.recordingMode).toBe('off')
  })

  it('reads the status under the cap that DECLARES it, not the collection', () => {
    // D625 split `recording` into a device COLLECTION (no status block at all)
    // and the `recording-archive` singleton that kept it. A row under the old
    // key must not be read, or a stale hub would paint a badge from a cap that
    // no longer answers — and a row under the new key must be.
    expect(BADGE_CAPS).toContain('recording-archive')
    expect(BADGE_CAPS).not.toContain('recording')
    expect(
      parseBadgeBatch({ '1': { recording: { activeMode: 'continuous' } } })?.[1]?.recordingMode,
    ).toBeNull()
    expect(
      parseBadgeBatch({ '1': { 'recording-archive': { activeMode: 'continuous' } } })?.[1]
        ?.recordingMode,
    ).toBe('continuous')
  })

  it('keeps an unavailable recording cap distinct from recording off', () => {
    expect(parseBadgeBatch({ '1': { 'recording-archive': null } })?.[1]?.recordingMode).toBeNull()
    expect(
      parseBadgeBatch({ '1': { 'recording-archive': { activeMode: 'off' } } })?.[1]?.recordingMode,
    ).toBe('off')
  })

  it('carries the network link on the same row, and keeps unknown as unknown', () => {
    const rows = parseBadgeBatch({
      '101': {
        battery: null,
        'recording-archive': null,
        'network-link': { type: 'wifi', signalPercent: 75, ssid: 'casa', lastUpdated: 1 },
      },
      '102': { battery: null, 'recording-archive': null, 'network-link': { type: 'unknown', signalPercent: null } },
      '618': { battery: null, 'recording-archive': null },
    })
    expect(rows?.[101]?.networkLink).toEqual({ type: 'wifi', signalPercent: 75, ssid: 'casa' })
    expect(rows?.[102]?.networkLink).toEqual({ type: 'unknown', signalPercent: null })
    expect(rows?.[618]?.networkLink).toBeNull()
  })

  it('an absent procedure is null — distinct from "no battery"', () => {
    // Both arrive as an absent value at the call site, and they must not lead
    // to the same decision: one means keep polling, the other means this camera
    // has no battery.
    expect(parseBadgeBatch(null)).toBeNull()
    expect(parseBadgeBatch('NOT_FOUND')).toBeNull()
    expect(parseBadgeBatch({ '1': { battery: null } })?.[1]?.battery).toBeNull()
  })

  it('a malformed row is dropped without taking the batch with it', () => {
    const byId = parseBadgeBatch({
      'not-a-number': { battery: { percentage: 5 } },
      '2': { battery: { percentage: 'lots' } },
      '3': { battery: { percentage: 30, charging: 'solar', sleeping: true } },
    })
    expect(Object.keys(byId ?? {})).toEqual(['2', '3'])
    expect(byId?.[2]?.battery).toBeNull()
    expect(byId?.[3]?.battery).toMatchObject({ charging: 'solar', sleeping: true })
  })

  it('asks for only the caps the badges read', () => {
    // Omitting `caps` sweeps every status-carrying cap × every device — the
    // aggregate would then cost more than the calls it replaced.
    expect([...BADGE_CAPS].sort()).toEqual(['battery', 'network-link', 'recording-archive'])
  })
})

describe('the fallback is a real disable, not a discard', () => {
  const read = (p: string): string => readFileSync(join(process.cwd(), 'src', p), 'utf8')

  it('the card disables its own battery query when the aggregate answers', () => {
    expect(read('components/CameraCard.tsx')).toContain('!badges.supported')
  })

  it('the status dot disables its own recording query the same way', () => {
    expect(read('components/camera/CameraStatusDot.tsx')).toContain('batchMode === null')
  })
})

/**
 * Not-yet-known must never look like not-installed (D315). The provider used
 * to report `supported: false` while its ONE aggregate was still in flight,
 * and every card read that as "old hub, ask yourself": 27 cameras × battery +
 * link + recording mode = the thousand-query burst measured at every boot
 * (`[app:info:cold-query]`, 998 lines in the boot minute, 2026-09-06), and a
 * `network-link` warning per camera without the cap.
 */
describe('resolveBadgeSlice — an unanswered aggregate is pending, not unsupported', () => {
  const row = { battery: null, networkLink: null, recordingMode: null, occupancy: null }
  it('is pending while the aggregate has not answered', () => {
    const slice = resolveBadgeSlice({ pending: true, supported: false, byId: {} }, 5)
    expect(slice).toEqual({ supported: false, row: null, pending: true })
  })
  it('is unsupported once the aggregate answered without this device', () => {
    const slice = resolveBadgeSlice({ pending: false, supported: true, byId: {} }, 5)
    expect(slice).toEqual({ supported: false, row: null, pending: false })
  })
  it('is unsupported, not pending, with no provider at all', () => {
    expect(resolveBadgeSlice(null, 5)).toEqual({ supported: false, row: null, pending: false })
  })
  it('hands over the row when the aggregate has one', () => {
    const slice = resolveBadgeSlice({ pending: false, supported: true, byId: { 5: row } }, 5)
    expect(slice.supported).toBe(true)
    expect(slice.row).toBe(row)
  })
})
