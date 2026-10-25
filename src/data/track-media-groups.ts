/**
 * track-media-groups — fold a track's flat media-file list into ONE tile per
 * LOGICAL kind for the detail modal.
 *
 * The pipeline persists several media variants that are really TWO resolutions
 * of the SAME logical image:
 *   • `thumbnail` (native uncapped best crop) + `thumbnailSmall` (480 square) →
 *     ONE logical "best shot";
 *   • `keyFrame` (native clean frame) + `keyFrameSmall` (960) → ONE logical
 *     "key frame".
 * The old strip rendered one tile PER stored row, so the operator saw "two best
 * shots" and "two key frames". {@link groupTrackMedia} collapses each
 * native+small pair into a single {@link MediaGroup} whose `display` is the SMALL
 * variant (fast to decode) and whose `full` is the native variant (opened on
 * demand). Every other kind stays its own tile; snapshots can repeat, so each
 * distinct snapshot is its own group.
 *
 * {@link readJpegSize} recovers the ACTUAL pixel dimensions of a base-64 JPEG by
 * parsing its SOF marker (no decode, bounded prefix) so each tile can badge its
 * real resolution. All pure — no React, no `any`, unit-tested.
 */

import { mediaFileId, type MediaFileLite } from './track-events.js'

/** The logical media kinds the detail groups media into (one tile each, except
 *  `snapshot`/`other` which stay per-file). */
export type LogicalMediaKind =
  | 'bestShot'
  | 'keyFrame'
  | 'objectCrop'
  | 'face'
  | 'plate'
  | 'frame'
  | 'frameBoxed'
  | 'firstFrame'
  | 'lastFrame'
  | 'snapshot'
  | 'other'

/** A resolved media tile: the small display variant + the (maybe identical)
 *  native full-resolution variant. */
export interface MediaGroup {
  readonly id: string
  readonly logicalKind: LogicalMediaKind
  /** The variant shown by default — the SMALL one when a pair exists (cheap to
   *  decode), else the only file. */
  readonly display: MediaFileLite
  /** The native / highest-resolution variant — opened on demand. Equals
   *  {@link display} when the group has no separate full-res file. */
  readonly full: MediaFileLite
  /** True when {@link full} is a genuinely higher-resolution file than
   *  {@link display} (the tile offers a "view full resolution" affordance). */
  readonly hasFullVariant: boolean
  readonly timestamp: number
}

interface KindRule {
  readonly logicalKind: LogicalMediaKind
  /** 'small' variants are preferred for display; 'full' for the native open. */
  readonly role: 'full' | 'small'
  /** When true, all files of this logicalKind collapse into ONE group; else each
   *  file is its own group (snapshots / unknown kinds can repeat). */
  readonly mergeable: boolean
}

/** Raw stored kind → its logical grouping rule. Kinds absent here fall through
 *  to a per-file `other` group (never merged, labelled by raw kind). */
const KIND_RULES: Readonly<Record<string, KindRule>> = {
  thumbnail: { logicalKind: 'bestShot', role: 'full', mergeable: true },
  thumbnailSmall: { logicalKind: 'bestShot', role: 'small', mergeable: true },
  keyFrame: { logicalKind: 'keyFrame', role: 'full', mergeable: true },
  keyFrameSmall: { logicalKind: 'keyFrame', role: 'small', mergeable: true },
  crop: { logicalKind: 'objectCrop', role: 'full', mergeable: false },
  faceCrop: { logicalKind: 'face', role: 'full', mergeable: false },
  plateCrop: { logicalKind: 'plate', role: 'full', mergeable: false },
  fullFrame: { logicalKind: 'frame', role: 'full', mergeable: false },
  fullFrameBoxed: { logicalKind: 'frameBoxed', role: 'full', mergeable: false },
  firstFrame: { logicalKind: 'firstFrame', role: 'full', mergeable: false },
  lastFrame: { logicalKind: 'lastFrame', role: 'full', mergeable: false },
  snapshot: { logicalKind: 'snapshot', role: 'full', mergeable: false },
}

/**
 * Ordering priority of a logical group. The strip reads:
 *   [ best shot, key frame, face crop, plate crop, …CHRONOLOGICAL rest… ]
 * i.e. the four identity/subject tiles are PINNED to the front (in that order,
 * face/plate present only when the pipeline stored them), then every other group
 * (first frame, each snapshot, last frame, plus any legacy crop/frame kinds)
 * falls in ascending media-timestamp order after them. A group whose media the
 * pipeline never stored is simply absent — no placeholder.
 */
function orderPriority(kind: LogicalMediaKind): number {
  if (kind === 'bestShot') return 0
  if (kind === 'keyFrame') return 1
  if (kind === 'face') return 2
  if (kind === 'plate') return 3
  return 4
}

function ruleFor(kind: string): KindRule {
  return KIND_RULES[kind] ?? { logicalKind: 'other', role: 'full', mergeable: false }
}

interface Bucket {
  readonly logicalKind: LogicalMediaKind
  readonly files: MediaFileLite[]
  readonly roles: Map<string, 'full' | 'small'>
}

/**
 * Fold a flat, deduped media list (as produced by `buildTrackGallery`) into ONE
 * {@link MediaGroup} per logical kind. Pure + deterministic — mergeable pairs
 * collapse (small = display, native = full); everything else stays a distinct
 * tile. Never synthesises a kind the pipeline did not store.
 *
 * ORDERING CONTRACT (the strip reads left→right):
 *   1. best shot  (the `thumbnail`/`thumbnailSmall` group)   — pinned first;
 *   2. key frame  (the `keyFrame`/`keyFrameSmall` group)     — pinned second;
 *   3. face crop  (`faceCrop`, present only when detected)   — pinned third;
 *   4. plate crop (`plateCrop`, present only when detected)  — pinned fourth;
 *   5. everything else in ascending media-`timestamp` order — so a normal track
 *      reads `firstFrame → snapshot… → lastFrame`. Ties break by id (stable).
 * A group whose media the pipeline never stored is simply absent.
 */
export function groupTrackMedia(files: readonly MediaFileLite[]): MediaGroup[] {
  const buckets = new Map<string, Bucket>()
  for (const f of files) {
    const rule = ruleFor(f.kind)
    const bucketId = rule.mergeable ? `L:${rule.logicalKind}` : `K:${mediaFileId(f)}`
    let bucket = buckets.get(bucketId)
    if (bucket === undefined) {
      bucket = { logicalKind: rule.logicalKind, files: [], roles: new Map() }
      buckets.set(bucketId, bucket)
    }
    bucket.files.push(f)
    bucket.roles.set(mediaFileId(f), rule.role)
  }

  const groups: MediaGroup[] = []
  for (const [bucketId, bucket] of buckets) {
    const small = bucket.files.find((f) => bucket.roles.get(mediaFileId(f)) === 'small')
    const full = bucket.files.find((f) => bucket.roles.get(mediaFileId(f)) === 'full')
    const display = small ?? full ?? bucket.files[0]
    const fullFile = full ?? display
    if (display === undefined) continue
    groups.push({
      id: bucketId,
      logicalKind: bucket.logicalKind,
      display,
      full: fullFile,
      hasFullVariant: mediaFileId(fullFile) !== mediaFileId(display),
      timestamp: Math.min(...bucket.files.map((f) => f.timestamp)),
    })
  }

  // Pinned front (best shot → key frame → face → plate), then every other group
  // in ascending media-timestamp order (first frame → snapshots by ts → last
  // frame). Ties break by id for a total, stable order.
  return groups.sort((a, b) => {
    const pa = orderPriority(a.logicalKind)
    const pb = orderPriority(b.logicalKind)
    if (pa !== pb) return pa - pb
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** The group a given {@link mediaFileId} belongs to (either its display or
 *  full variant), or null when no group matches. */
export function groupForKey(
  groups: readonly MediaGroup[],
  id: string | null,
): MediaGroup | null {
  if (id === null) return null
  return groups.find((g) => mediaFileId(g.display) === id || mediaFileId(g.full) === id) ?? null
}

// ─── Logical-kind labels ─────────────────────────────────────────────────────

/** Minimal i18next translate signature (matches `track-events.ts`). */
export type Translate = (key: string, opts?: Record<string, unknown>) => string

/** logicalKind → `v2.mediaKind.*` i18n key (reuses the existing kind labels). */
const LOGICAL_I18N_KEY: Readonly<Record<LogicalMediaKind, string>> = {
  bestShot: 'v2.mediaKind.thumbnail',
  keyFrame: 'v2.mediaKind.keyFrame',
  objectCrop: 'v2.mediaKind.crop',
  face: 'v2.mediaKind.faceCrop',
  plate: 'v2.mediaKind.plateCrop',
  frame: 'v2.mediaKind.fullFrame',
  frameBoxed: 'v2.mediaKind.fullFrameBoxed',
  firstFrame: 'v2.mediaKind.firstFrame',
  lastFrame: 'v2.mediaKind.lastFrame',
  snapshot: 'v2.mediaKind.snapshot',
  other: '',
}

/** Human label for a {@link MediaGroup}. `other` groups fall back to the raw
 *  stored kind of their display file. Pure — unit-tested. */
export function logicalMediaKindLabel(group: MediaGroup, t: Translate): string {
  const key = LOGICAL_I18N_KEY[group.logicalKind]
  if (key === '') return group.display.kind
  return t(key)
}

// ─── JPEG dimension parsing (badge the ACTUAL resolution) ────────────────────

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_LOOKUP: Int16Array = (() => {
  const table = new Int16Array(128).fill(-1)
  for (let i = 0; i < B64_ALPHABET.length; i += 1) {
    table[B64_ALPHABET.charCodeAt(i)] = i
  }
  return table
})()

/**
 * Decode at most the first `maxBytes` bytes of a standard base-64 string into a
 * Uint8Array. Ignores whitespace and stops at padding. Pure — no `atob`/`Buffer`
 * dependency, so it runs identically under Hermes, the browser, and vitest.
 */
export function base64PrefixToBytes(b64: string, maxBytes: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, maxBytes))
  let outLen = 0
  let acc = 0
  let accBits = 0
  for (let i = 0; i < b64.length && outLen < out.length; i += 1) {
    const code = b64.charCodeAt(i)
    if (code === 61) break // '=' padding
    const val = code < 128 ? B64_LOOKUP[code] : -1
    if (val === undefined || val < 0) continue // skip whitespace / stray chars
    acc = (acc << 6) | val
    accBits += 6
    if (accBits >= 8) {
      accBits -= 8
      out[outLen] = (acc >> accBits) & 0xff
      outLen += 1
    }
  }
  return outLen === out.length ? out : out.subarray(0, outLen)
}

export interface PixelSize {
  readonly width: number
  readonly height: number
}

/**
 * Recover the pixel dimensions of a base-64 JPEG by walking its segment markers
 * to the Start-Of-Frame (SOF0/1/2/…), WITHOUT decoding the image. Only a bounded
 * prefix is base-64-decoded (default 64 KiB — real pipeline frames carry the SOF
 * at ~byte 140, right after the app/quantization segments), so the parse is a
 * sub-millisecond, allocation-bounded operation on the JS thread. Returns null
 * for a non-JPEG, a truncated header, or a malformed stream. Pure — unit-tested.
 */
export function readJpegSize(base64: string, maxBytes: number = 65536): PixelSize | null {
  if (typeof base64 !== 'string' || base64.length === 0) return null
  const bytes = base64PrefixToBytes(base64, maxBytes)
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null // SOI
  let pos = 2
  while (pos + 3 < bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos += 1 // resync past fill / stray bytes
      continue
    }
    let marker = bytes[pos + 1]
    // Collapse marker fill bytes (0xFF 0xFF … 0xFFxx).
    let cursor = pos + 1
    while (marker === 0xff && cursor + 1 < bytes.length) {
      cursor += 1
      marker = bytes[cursor]
    }
    if (marker === undefined) return null
    // Standalone markers with no length payload.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos = cursor + 1
      continue
    }
    if (marker === 0xda) return null // Start-Of-Scan — image data begins, no dims
    const lenHi = bytes[cursor + 1]
    const lenLo = bytes[cursor + 2]
    if (lenHi === undefined || lenLo === undefined) return null
    const segLen = (lenHi << 8) | lenLo
    // SOF markers carry the frame dimensions (skip DHT C4, JPG C8, DAC CC).
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      const h = (bytes[cursor + 4] << 8) | bytes[cursor + 5]
      const w = (bytes[cursor + 6] << 8) | bytes[cursor + 7]
      if (w > 0 && h > 0) return { width: w, height: h }
      return null
    }
    pos = cursor + 1 + segLen
  }
  return null
}

/** `"1920×1080"` (real multiplication sign) for a size, or null. Pure. */
export function formatResolution(size: PixelSize | null): string | null {
  if (size === null) return null
  return `${size.width}×${size.height}`
}

// ─── Detail-crop gallery fallback (plate / face) ─────────────────────────

/**
 * A subject detail crop as the FACE / PLATE GALLERY reports it.
 *
 * Used as a tile source when the track's media listing carries no `plateCrop` /
 * `faceCrop` row of its own. That is the normal case on a hub whose
 * `listTrackMedia` reads `('track', trackId)` only: the crop is stored under
 * `('plate', 'plate-<trackId>')` / `('face', 'face-<trackId>')` with the stored
 * `kind: 'crop'`, so the track's own listing never sees it. Newer hubs merge
 * those owners in and publish the rows as `plateCrop` / `faceCrop`; this
 * fallback is what keeps the tile on every hub that does not.
 */
export interface DetailCropFallback {
  readonly timestamp: number
  readonly base64?: string
  readonly cropUrl?: string
  /**
   * The row's own id, parsed off {@link cropUrl} when it points at `/m/<id>`
   * (D482) — see `mediaIdFromCropUrl` in `use-track-plate.ts`. Purely an
   * identity aid for {@link mediaFileId}; rendering uses `cropUrl` itself
   * (via the synthesised tile's `url`), never a URL rebuilt from this.
   * Undefined when the URL cannot be parsed this way — never 0.
   */
  readonly mediaId?: number
}

/** The plate-gallery shape (`plateGallery.getPlateByTrack`). */
export interface PlateFallback extends DetailCropFallback {
  readonly plateId: string
}

/** The face-gallery shape (`faceGallery.getFaceByTrack`). */
export interface FaceFallback extends DetailCropFallback {
  readonly faceId: string
}

/**
 * Ensure the modal gallery carries a tile of `kind`, appending a synthetic
 * {@link MediaFileLite} from the gallery row when the fetched `gallery` has
 * none. A no-op when a REAL row already exists (the track's own media wins) or
 * when the gallery row has no image at all. Pure + immutable.
 *
 * The synthetic tile is stamped `offManifest` — the manifest never listed it,
 * so `getTrackMedia` must not be asked for its bytes. Without that stamp the
 * cap answers `[]` (wrong owner, wrong kind) and the detail reports a working
 * crop as a failed read: exactly what v1.0.405 shipped for plates, with faces
 * one merged tile away from the same thing.
 *
 * A hub that serves `cropUrl` supplies the tile's `url` directly — the same
 * server-minted address {@link mediaFileUri} in `track-media-uri.ts` prefers
 * for every other row, never rebuilt from an id. Older hubs that still inline
 * the bytes fall back to `base64`, with no `url`/`mediaId` at all — see
 * {@link mediaFileId} for how that tile still gets a stable identity.
 */
function mergeDetailCropFallback(
  gallery: readonly MediaFileLite[],
  fallback: DetailCropFallback | null,
  kind: 'faceCrop' | 'plateCrop',
): MediaFileLite[] {
  if (fallback === null) return [...gallery]
  if (gallery.some((f) => f.kind === kind)) return [...gallery]
  if (fallback.cropUrl !== undefined && fallback.cropUrl.length > 0) {
    return [
      ...gallery,
      {
        ...(fallback.mediaId !== undefined ? { mediaId: fallback.mediaId } : {}),
        url: fallback.cropUrl,
        kind,
        timestamp: fallback.timestamp,
        offManifest: true,
      },
    ]
  }
  if (fallback.base64 !== undefined && fallback.base64.length > 0) {
    return [
      ...gallery,
      {
        kind,
        base64: fallback.base64,
        timestamp: fallback.timestamp,
        offManifest: true,
      },
    ]
  }
  return [...gallery]
}

/** {@link mergeDetailCropFallback} for the PLATE tile. */
export function mergePlateFallback(
  gallery: readonly MediaFileLite[],
  plate: PlateFallback | null,
): MediaFileLite[] {
  return mergeDetailCropFallback(gallery, plate, 'plateCrop')
}

/** {@link mergeDetailCropFallback} for the FACE tile — the same defect, the
 *  same shape, the same guard. */
export function mergeFaceFallback(
  gallery: readonly MediaFileLite[],
  face: FaceFallback | null,
): MediaFileLite[] {
  return mergeDetailCropFallback(gallery, face, 'faceCrop')
}
