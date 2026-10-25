import { describe, it, expect } from 'vitest'
import {
  artifactCameraLabel,
  artifactExpiryLabel,
  artifactFileExtension,
  artifactKindLabelKey,
  artifactTitle,
  capturedLabel,
  isArtifactExpired,
} from '../nc-artifact-format.js'
import type { NcArtifactRecord } from '../nc-artifacts.js'

/** Echo the key + its interpolation so a test asserts on the KEY, never on a
 *  translated literal that a locale edit would break. */
const t = (key: string, opts?: Record<string, unknown>): string =>
  opts === undefined ? key : `${key}(${JSON.stringify(opts)})`

function record(over: Partial<NcArtifactRecord> = {}): NcArtifactRecord {
  return {
    id: 'a1',
    kind: 'summary-mosaic',
    mediaType: 'image',
    mime: 'image/jpeg',
    sizeBytes: 1,
    createdAt: 0,
    capturedAt: 0,
    expiresAt: 0,
    deviceId: 102,
    deviceIds: [102],
    downloadPath: '/addon/pipeline-analytics/nc-artifact-read/a1',
    ...over,
  }
}

const CAMERAS = [
  { id: 101, name: 'Garden' },
  { id: 102, name: 'Driveway' },
]

describe('artifactKindLabelKey', () => {
  it('namespaces under v2.artifacts.kind', () => {
    expect(artifactKindLabelKey('summary-mosaic')).toBe('v2.artifacts.kind.summary-mosaic')
  })
})

describe('artifactTitle', () => {
  it("prefers the operator's own title", () => {
    expect(artifactTitle(record({ title: 'Front door', ruleName: 'R' }), t)).toBe('Front door')
  })

  it('falls back to the producing rule', () => {
    expect(artifactTitle(record({ ruleName: 'Package delivered' }), t)).toBe('Package delivered')
  })

  it('falls back to the kind — never the id', () => {
    expect(artifactTitle(record(), t)).toBe('v2.artifacts.kind.summary-mosaic')
  })

  it('treats an empty title as absent', () => {
    expect(artifactTitle(record({ title: '', ruleName: 'R' }), t)).toBe('R')
  })
})

describe('capturedLabel — on capturedAt, never createdAt', () => {
  const now = 1_000_000_000_000

  it('reads under a minute as "now"', () => {
    expect(capturedLabel(now - 30_000, now, t)).toBe('v2.artifacts.time.now')
  })

  it('reads minutes, hours and days', () => {
    expect(capturedLabel(now - 5 * 60_000, now, t)).toBe('v2.artifacts.time.minutesAgo({"count":5})')
    expect(capturedLabel(now - 3 * 3_600_000, now, t)).toBe('v2.artifacts.time.hoursAgo({"count":3})')
    expect(capturedLabel(now - 2 * 86_400_000, now, t)).toBe('v2.artifacts.time.daysAgo({"count":2})')
  })

  it('becomes a date past a week, where "9d ago" stops meaning anything', () => {
    const label = capturedLabel(now - 30 * 86_400_000, now, t)
    expect(label.startsWith('v2.artifacts.time.')).toBe(false)
  })

  it('never renders a negative age from a skewed clock', () => {
    expect(capturedLabel(now + 60_000, now, t)).toBe('v2.artifacts.time.now')
  })
})

describe('artifactExpiryLabel', () => {
  const now = 1_000_000_000_000

  it('reports an elapsed window as EXPIRED, not "in 0m"', () => {
    expect(artifactExpiryLabel(now, now, t)).toBe('v2.artifacts.expired')
    expect(artifactExpiryLabel(now - 1, now, t)).toBe('v2.artifacts.expired')
  })

  it('counts down in days / hours / minutes', () => {
    expect(artifactExpiryLabel(now + 3 * 86_400_000, now, t)).toBe('v2.artifacts.expiresInDays({"count":3})')
    expect(artifactExpiryLabel(now + 5 * 3_600_000, now, t)).toBe('v2.artifacts.expiresInHours({"count":5})')
    expect(artifactExpiryLabel(now + 90_000, now, t)).toBe('v2.artifacts.expiresInMinutes({"count":1})')
  })

  it('floors a sub-minute remainder to 1m rather than 0m', () => {
    expect(artifactExpiryLabel(now + 5_000, now, t)).toBe('v2.artifacts.expiresInMinutes({"count":1})')
  })

  it('isArtifactExpired agrees with the label', () => {
    expect(isArtifactExpired(record({ expiresAt: now }), now)).toBe(true)
    expect(isArtifactExpired(record({ expiresAt: now + 1 }), now)).toBe(false)
  })
})

describe('artifactCameraLabel', () => {
  it('names one camera', () => {
    expect(artifactCameraLabel(record(), CAMERAS, t)).toBe('Driveway')
  })

  it('joins two', () => {
    expect(artifactCameraLabel(record({ deviceIds: [101, 102] }), CAMERAS, t)).toBe('Garden · Driveway')
  })

  it('collapses three or more to "<first> +N"', () => {
    expect(artifactCameraLabel(record({ deviceIds: [101, 102, 999] }), CAMERAS, t)).toBe(
      'v2.artifacts.cameraPlus({"name":"Garden","count":2})',
    )
  })

  it('falls back to the numbered name for a camera the app does not know', () => {
    expect(artifactCameraLabel(record({ deviceIds: [999] }), CAMERAS, t)).toBe(
      'v2.cameraDetail.fallbackName({"id":999})',
    )
  })

  it('says "all cameras" for a cluster-wide artifact rather than an empty line', () => {
    expect(artifactCameraLabel(record({ deviceId: null, deviceIds: [] }), CAMERAS, t)).toBe(
      'v2.artifacts.allCameras',
    )
  })

  it('falls back to the primary deviceId when deviceIds is empty', () => {
    expect(artifactCameraLabel(record({ deviceIds: [] }), CAMERAS, t)).toBe('Driveway')
  })
})

describe('artifactFileExtension', () => {
  it('maps the media type, not the mime', () => {
    expect(artifactFileExtension(record({ mediaType: 'video' }))).toBe('mp4')
    expect(artifactFileExtension(record({ mediaType: 'gif' }))).toBe('gif')
    expect(artifactFileExtension(record({ mediaType: 'image' }))).toBe('jpg')
  })
})
