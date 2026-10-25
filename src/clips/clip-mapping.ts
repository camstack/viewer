/**
 * clip-mapping — the boundary between the hub's `videoclips` rows and the
 * ribbon's {@link Clip}.
 *
 * Structural, not typed, on purpose: `@camstack/sdk` lags the hub (the same
 * reason `use-recording.ts` and `use-children-states.ts` reach through
 * `capQuery`), so an unknown field must degrade rather than throw. A row the
 * viewer cannot understand is DROPPED, never rendered half-parsed — a segment
 * with a nonsense time range is worse than a missing one, because the operator
 * taps it.
 *
 * ## Why playback is not resolved here
 *
 * A clip from the hub's own recording needs no address at all: it is a time
 * WINDOW the embed player's recorded transport already knows how to reach
 * (`seek(epochMs)`), which is exactly what the cap says such a clip is ("a
 * time-WINDOW over existing footage, never a separate file").
 *
 * A clip from a camera's own storage is a FILE, and its address does not exist
 * until somebody asks for it: `videoclips.getClipPlayback` mints an entry in a
 * bounded per-device scratch and answers `{playbackUrl, format:'mp4', served}`.
 * Resolving that at LIST time would mint one per card and evict the first on
 * the eleventh. So such a row parses to a `native` ref carrying the identity to
 * ask WITH, and the ask happens on the tap.
 *
 * (This header used to say `getClipPlayback` "returns an HLS master URL". It
 * gained `format: 'hls' | 'mp4'` and `served` on 2026-09-20 — D555, D559.)
 */

import { isRecord } from '../data/cap-query.js'
import {
  CLIP_SOURCE_ANALYTICS,
  type Clip,
  type ClipHole,
  type ClipKind,
  type ClipStream,
  type ClipStreams,
} from './clip-model.js'

const CLIP_KINDS: readonly ClipKind[] = ['motion', 'object', 'audio', 'native']

function toClipKind(raw: unknown): ClipKind {
  return CLIP_KINDS.includes(raw as ClipKind) ? (raw as ClipKind) : 'motion'
}

/**
 * The event ids the hub attached to this visit, junk removed.
 *
 * Null rather than `[]` when nothing usable is there: an absent field and an
 * empty array both mean "no event to recover a dead thumbnail from", and
 * storing the empty array would put a property on the clip that every consumer
 * then has to length-check.
 */
function toEventIds(raw: unknown): readonly string[] | null {
  if (!Array.isArray(raw)) return null
  const ids = raw.filter((v): v is string => typeof v === 'string' && v.length > 0)
  return ids.length > 0 ? ids : null
}


/** The hub-aggregated class labels, junk removed; null when nothing usable. */
function toLabels(raw: unknown): readonly string[] | null {
  if (!Array.isArray(raw)) return null
  const labels = raw.filter((v): v is string => typeof v === 'string' && v.length > 0)
  return labels.length > 0 ? labels : null
}

/** The intra-visit holes, dropping any whose bounds are not readable. */
function toHoles(raw: unknown): readonly ClipHole[] | null {
  if (!Array.isArray(raw)) return null
  const holes: ClipHole[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const { startMs, endMs } = entry
    if (typeof startMs !== 'number' || typeof endMs !== 'number') continue
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue
    holes.push({ startMs, endMs })
  }
  return holes.length > 0 ? holes : null
}


/** One resolved twin, or null when the row does not describe a usable one.
 *
 *  A twin with no byte count is dropped rather than stored as zero: the size is
 *  the whole reason the surface can warn before it spends 20 MB of somebody's
 *  cellular data on a main-only clip, and a measurement that FAILED is never 0
 *  (D393). */
function toStream(raw: unknown): ClipStream | null {
  if (!isRecord(raw)) return null
  const { id, bytes } = raw
  if (typeof id !== 'string' || id.length === 0) return null
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null
  return { id, bytes }
}

/** The resolved copies, or null when neither twin is readable. */
function toStreams(raw: unknown): ClipStreams | null {
  if (!isRecord(raw)) return null
  const sub = toStream(raw['sub'])
  const main = toStream(raw['main'])
  if (sub === null && main === null) return null
  return { ...(sub !== null ? { sub } : {}), ...(main !== null ? { main } : {}) }
}

/** A list of non-empty strings, or null — never `[]`, for `toLabels`' reason. */
function toStringList(raw: unknown): readonly string[] | null {
  if (!Array.isArray(raw)) return null
  const out = raw.filter((v): v is string => typeof v === 'string' && v.length > 0)
  return out.length > 0 ? out : null
}

/** A finite number, or null. */
function toFiniteNumber(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

/** A non-empty string, or null. */
function toText(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

/**
 * Sources whose clips play through the RECORDED transport (a time window over
 * the hub's own footage) rather than from a file of their own.
 */
export function playsFromRecording(sourceId: string): boolean {
  return sourceId === CLIP_SOURCE_ANALYTICS
}

/** Parse one `videoclips.listClips` row. Null when the row cannot be drawn. */
export function parseClip(raw: unknown, deviceId: number): Clip | null {
  if (!isRecord(raw)) return null
  const { id, source, timeRange, thumbnail } = raw
  if (typeof id !== 'string' || id.length === 0) return null
  if (typeof source !== 'string' || source.length === 0) return null
  if (!isRecord(timeRange)) return null
  const { startMs, endMs } = timeRange
  if (typeof startMs !== 'number' || typeof endMs !== 'number') return null
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null

  // Kept, not dropped. `thumbnail` is stamped on every clip and is NOT vouched
  // for (35% of them 404 on a measured camera), and `eventIds[0]` is the only
  // id `getEventMedia` can still answer with — dropping it here is what left
  // the card with a question mark and nothing to retry.
  const eventIds = toEventIds(raw.eventIds)
  const holes = toHoles(raw.holes)
  const labels = toLabels(raw.labels)

  // The file half. All optional, all degrading: a hub that predates any of
  // these still draws a card, which is the rule this module was written under
  // and the reason it parses structurally at all.
  const streams = toStreams(raw.streams)
  const nativeTypes = toStringList(raw.nativeTypes)
  const catalogAsOf = toFiniteNumber(raw.catalogAsOf)
  const thumbnailMint = toText(raw.thumbnailMint)
  const thumbnailUnavailable = toText(raw.thumbnailUnavailable)
  const unplayableReason = toText(raw.unplayableReason)

  return {
    clipId: id,
    deviceId,
    startMs,
    endMs,
    sourceId: source,
    kind: toClipKind(raw.kind),
    // Two kinds, not three. A `url` clip was unreachable BY CONSTRUCTION:
    // `playbackUrl` lives in `ClipPlaybackSchema` — the output of
    // `getClipPlayback` — and never in `ClipSchema`, the row `listClips`
    // returns, so this read could only ever be `null`. Measured on the live
    // hub before deleting it: 786 rows across all three sources, none
    // carrying one. A branch nothing can enter reads as a supported case
    // (D586).
    playback: playsFromRecording(source)
      ? { kind: 'recorded', deviceId }
      : { kind: 'native', deviceId, clipId: id },
    ...(typeof thumbnail === 'string' && thumbnail.length > 0 ? { thumbnailUrl: thumbnail } : {}),
    ...(thumbnailMint !== null ? { thumbnailMintUrl: thumbnailMint } : {}),
    ...(thumbnailUnavailable !== null ? { thumbnailUnavailable } : {}),
    ...(eventIds !== null ? { eventIds } : {}),
    ...(holes !== null ? { holes } : {}),
    ...(labels !== null ? { labels } : {}),
    ...(streams !== null ? { streams } : {}),
    ...(nativeTypes !== null ? { nativeTypes } : {}),
    ...(catalogAsOf !== null ? { catalogAsOf } : {}),
    // `playable` is read ONLY as an explicit false. Absence is not a refusal:
    // not one onboard row measured on 592 carries the field.
    ...(raw.playable === false ? { playable: false } : {}),
    ...(unplayableReason !== null ? { unplayableReason } : {}),
    ...(typeof raw.supportSub === 'boolean' ? { supportSub: raw.supportSub } : {}),
    // Like `playable`, read ONLY as an explicit true. Absence is "the row is
    // closed", which is what every measured row is, and it must stay
    // distinguishable from a hub that does not send the field at all.
    ...(raw.inProgress === true ? { inProgress: true } : {}),
  }
}

/** Parse a whole `listClips` response, dropping rows that cannot be drawn. */
export function parseClips(raw: unknown, deviceId: number): readonly Clip[] {
  if (!Array.isArray(raw)) return []
  const out: Clip[] = []
  for (const row of raw) {
    const clip = parseClip(row, deviceId)
    if (clip !== null) out.push(clip)
  }
  return out
}
