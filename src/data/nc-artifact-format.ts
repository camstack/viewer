/**
 * Pure presentational helpers for the artifacts gallery (list + detail). Kept
 * framework-free so they can be unit-tested in the repo's node environment;
 * localised strings are produced through an injected translate fn (i18next
 * `t`-compatible), never a hardcoded literal.
 *
 * `formatBytes` is NOT re-implemented here — it is imported from
 * `export-format.ts`, which already renders exactly the sizes this screen shows.
 */
import type { Translate } from './export-format.js'
import type { NcArtifactKind, NcArtifactRecord } from './nc-artifacts.js'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** i18n key for a kind badge / filter chip. */
export function artifactKindLabelKey(kind: NcArtifactKind): string {
  return `v2.artifacts.kind.${kind}`
}

/** Localised kind label. */
export function artifactKindLabel(kind: NcArtifactKind, t: Translate): string {
  return t(artifactKindLabelKey(kind))
}

/**
 * WHAT TO CALL THIS TILE. The operator's own words win: an explicit `title`,
 * else the rule that produced it, else the kind. Never an id — an id names the
 * row for a developer and nothing for the person looking at the picture.
 */
export function artifactTitle(record: NcArtifactRecord, t: Translate): string {
  if (record.title !== undefined && record.title.length > 0) return record.title
  if (record.ruleName !== undefined && record.ruleName.length > 0) return record.ruleName
  return artifactKindLabel(record.kind, t)
}

/**
 * "how long ago is this ABOUT" — on `capturedAt`, never `createdAt`. A timelapse
 * of yesterday rendered at 03:00 today is a picture of YESTERDAY, and dating it
 * by the render is how a gallery starts lying about what it shows.
 *
 * Beyond a week the relative form stops meaning anything ("9d ago"), so it
 * becomes a date.
 */
export function capturedLabel(capturedAt: number, now: number, t: Translate): string {
  const age = now - capturedAt
  if (age < 0) return t('v2.artifacts.time.now')
  if (age < MINUTE_MS) return t('v2.artifacts.time.now')
  if (age < HOUR_MS) return t('v2.artifacts.time.minutesAgo', { count: Math.floor(age / MINUTE_MS) })
  if (age < DAY_MS) return t('v2.artifacts.time.hoursAgo', { count: Math.floor(age / HOUR_MS) })
  if (age < 7 * DAY_MS) return t('v2.artifacts.time.daysAgo', { count: Math.floor(age / DAY_MS) })
  return new Date(capturedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Full "12 Jul 2026, 14:30" stamp for the detail sheet. */
export function capturedStamp(capturedAt: number): string {
  const d = new Date(capturedAt)
  const day = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${day}, ${time}`
}

/**
 * Countdown to the moment the bytes are gone. An artifact whose window has
 * passed is reported EXPIRED rather than shown with a plausible "in 0m" — the
 * operator must be able to tell "about to go" from "already gone".
 */
export function artifactExpiryLabel(expiresAt: number, now: number, t: Translate): string {
  const remaining = expiresAt - now
  if (remaining <= 0) return t('v2.artifacts.expired')
  if (remaining >= DAY_MS) return t('v2.artifacts.expiresInDays', { count: Math.floor(remaining / DAY_MS) })
  if (remaining >= HOUR_MS) return t('v2.artifacts.expiresInHours', { count: Math.floor(remaining / HOUR_MS) })
  return t('v2.artifacts.expiresInMinutes', { count: Math.max(1, Math.floor(remaining / MINUTE_MS)) })
}

/** True once the hub's retention window has closed on this artifact. */
export function isArtifactExpired(record: NcArtifactRecord, now: number): boolean {
  return record.expiresAt <= now
}

/** A camera the gallery can name. */
export interface NamedCamera {
  readonly id: number
  readonly name: string
}

/**
 * The camera line for a tile.
 *
 * `deviceIds` is the authority (a mosaic covers many and `deviceId` names only
 * its primary), and a cluster-wide artifact that covers NO single camera says
 * so rather than rendering an empty line. Beyond two names it collapses to
 * "<first> +N" — the tile has one line, and three truncated names read as none.
 */
export function artifactCameraLabel(
  record: NcArtifactRecord,
  cameras: readonly NamedCamera[],
  t: Translate,
): string {
  const ids = record.deviceIds.length > 0
    ? record.deviceIds
    : record.deviceId !== null
      ? [record.deviceId]
      : []
  if (ids.length === 0) return t('v2.artifacts.allCameras')
  const byId = new Map(cameras.map((c) => [c.id, c.name]))
  const names = ids.map((id) => byId.get(id) ?? t('v2.cameraDetail.fallbackName', { id }))
  if (names.length <= 2) return names.join(' · ')
  return t('v2.artifacts.cameraPlus', { name: names[0], count: names.length - 1 })
}

/** The cache-file extension for a downloaded artifact, from its media type. */
export function artifactFileExtension(record: NcArtifactRecord): string {
  if (record.mediaType === 'video') return 'mp4'
  if (record.mediaType === 'gif') return 'gif'
  return 'jpg'
}
