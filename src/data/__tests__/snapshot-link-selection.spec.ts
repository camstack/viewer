import { describe, expect, it } from 'vitest'

import {
  keepNewestSnapshotLinks,
  snapshotLinksByTarget,
  type SnapshotLinkRow,
} from '../use-snapshot-links.js'

function row(capturedAt: number | null, expiresAt = 10_000): SnapshotLinkRow {
  return {
    deviceId: 101,
    url: capturedAt === null ? null : `/snapshot?v=${String(capturedAt)}`,
    capturedAt,
    ageMs: capturedAt === null ? null : 100,
    width: 320,
    neverCaptured: capturedAt === null,
    sleeping: false,
    stateReason: null,
    battery: false,
    expiresAt,
    observedAt: 0,
  }
}

describe('keepNewestSnapshotLinks', () => {
  it('never replaces a painted generation with an older response', () => {
    const current = { 101: row(3_000) }
    expect(keepNewestSnapshotLinks(current, { 101: row(2_000) }, 1_000)).toBe(current)
  })

  it('accepts a newer generation', () => {
    const newer = row(4_000)
    expect(keepNewestSnapshotLinks({ 101: row(3_000) }, { 101: newer }, 1_000)[101]).toBe(newer)
  })

  it('keeps a valid signed URL stable for the same generation', () => {
    const current = row(3_000, 30_000)
    const refreshed = { ...row(3_000), url: '/snapshot?v=3000&sig=new' }
    expect(keepNewestSnapshotLinks({ 101: current }, { 101: refreshed }, 1_000)[101]).toBe(current)
  })

  it('renews a same-generation signed URL close to expiry', () => {
    const refreshed = { ...row(3_000, 30_000), url: '/snapshot?v=3000&sig=new' }
    expect(
      keepNewestSnapshotLinks({ 101: row(3_000, 9_000) }, { 101: refreshed }, 1_000)[101],
    ).toBe(refreshed)
  })

  it('accepts fast cameras independently while retaining a slow camera generation', () => {
    const currentSlow = { ...row(3_000, 30_000), deviceId: 101 }
    const currentFast = { ...row(3_000, 30_000), deviceId: 102 }
    const staleSlow = { ...row(2_000, 30_000), deviceId: 101 }
    const newerFast = { ...row(4_000, 30_000), deviceId: 102 }

    const selected = keepNewestSnapshotLinks(
      { 101: currentSlow, 102: currentFast },
      { 101: staleSlow, 102: newerFast },
      1_000,
    )
    expect(selected[101]).toBe(currentSlow)
    expect(selected[102]).toBe(newerFast)
  })

  it('drops an expired previous link after a backend cache reset', () => {
    const empty = row(null, 20_000)
    expect(keepNewestSnapshotLinks({ 101: row(3_000, 500) }, { 101: empty }, 1_000)[101]).toBe(
      empty,
    )
  })

  it('takes the candidate when the STATE changes over the same generation', () => {
    // The 2026-08-16 "Non disponibile while sleeping" bug: a camera falls
    // asleep keeping its last frame's capturedAt, so the sleeping row looks
    // like the same generation — and keeping the old stateReason:null row hid
    // the overlay behind the 30 s paint gate until the tile blanked.
    const current = { ...row(3_000, 30_000), stateReason: null }
    const sleeping = { ...row(3_000, 30_000), stateReason: 'sleeping' as const, sleeping: true }
    expect(keepNewestSnapshotLinks({ 101: current }, { 101: sleeping }, 1_000)[101]).toBe(sleeping)
  })

  it('takes the candidate when the state CLEARS over the same generation', () => {
    const current = { ...row(3_000, 30_000), stateReason: 'sleeping' as const, sleeping: true }
    const awake = { ...row(3_000, 30_000), stateReason: null }
    expect(keepNewestSnapshotLinks({ 101: current }, { 101: awake }, 1_000)[101]).toBe(awake)
  })

  it('a state change wins even over a regressed capture identity', () => {
    // After a hub restart the rebuilt cache can be older than the painted row;
    // the state overlay is still authoritative and must not be suppressed.
    const current = { ...row(5_000, 30_000), stateReason: null }
    const sleeping = { ...row(3_000, 30_000), stateReason: 'sleeping' as const, sleeping: true }
    expect(keepNewestSnapshotLinks({ 101: current }, { 101: sleeping }, 1_000)[101]).toBe(sleeping)
  })

  it('keeps separate signed variants for two widths of the same camera', () => {
    const small = { ...row(3_000), width: 240, url: '/101.jpg?w=240' }
    const large = { ...row(3_000), width: 720, url: '/101.jpg?w=720' }
    const result = snapshotLinksByTarget(
      [small, large],
      [
        { deviceId: 101, width: 240 },
        { deviceId: 101, width: 720 },
      ],
      0,
    )
    expect(result.byTarget['101:240']).toStrictEqual(small)
    expect(result.byTarget['101:720']).toStrictEqual(large)
  })
})

/**
 * Demand shrinks whenever a tile scrolls out of the viewport
 * (`snapshot-viewport.ts`), so the next poll's `incoming` legitimately omits
 * targets whose links are still perfectly good.
 *
 * The merge used to build its result from `incoming` alone, which made "this
 * camera is no longer being asked about" indistinguishable from "this camera
 * lost its link". `useSnapshot` renders nothing without a link row on a hub
 * that supports the cap, so scrolling a tile off screen and back would blank
 * it until a fresh mint landed — up to a full poll interval of white card for a
 * frame the app already had on disk.
 */
describe('keepNewestSnapshotLinks + shrinking demand', () => {
  it('keeps an unexpired link whose target is no longer being asked about', () => {
    const current = { 101: row(3_000, 90_000) }
    const next = keepNewestSnapshotLinks(current, {}, 1_000)
    expect(next[101]).toBe(current[101])
  })

  it('drops a retained link once it has actually expired', () => {
    // An expired signed URL cannot be fetched, so holding it would freeze the
    // tile on an image that 403s rather than degrade to the unsigned path.
    const current = { 101: row(3_000, 500) }
    expect(keepNewestSnapshotLinks(current, {}, 1_000)[101]).toBeUndefined()
  })

  it('is referentially stable when nothing is dropped and nothing arrives', () => {
    const current = { 101: row(3_000, 90_000) }
    expect(keepNewestSnapshotLinks(current, {}, 1_000)).toBe(current)
  })

  it('still lets a fresh answer for a retained target win', () => {
    const current = { 101: row(3_000, 90_000) }
    const newer = row(4_000, 90_000)
    expect(keepNewestSnapshotLinks(current, { 101: newer }, 1_000)[101]).toBe(newer)
  })
})
