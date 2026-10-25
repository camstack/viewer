/**
 * snapshot-file-cache — how a camera's last good frame is NAMED on disk, and
 * when asking the hub for a new one is worth a request.
 *
 * ## Why a file cache exists at all
 *
 * `expo-image` is URL-keyed and does not revalidate: its own docs define the
 * disk policy as "queried from the disk cache if exists, otherwise downloaded".
 * `Cache-Control` and `ETag` never enter into it. So on native the ONLY lever
 * the client had was the URL, and three separate incidents came out of pulling
 * that lever (see the docblock of `snapshot-media-url.ts`): a frozen thumbnail
 * from a stable URL, a two-week-old JPEG repainted by a second outage reusing a
 * first outage's cache keys, and a cold start painting last week's frame. In
 * every one of them the pixels on screen were bytes NOBODY COULD DATE.
 *
 * This module is the other half of the fix. Instead of guessing what is in a
 * cache we cannot inspect, the client downloads the frame itself and stores it
 * under a name that STATES what is inside:
 *
 *     <deviceId>_<widthKey>_<etagToken>.jpg
 *     101_w320_101-1786203296350-w320.jpg
 *
 * `etagToken` is the server's own ETag —
 * `"<deviceId>-<capturedAt>[-s<stream>][-w<width>][-v<variant>]"`, built in
 * `snapshot-media-handler.ts`. Three consequences, and they are the entire
 * point:
 *
 *  1. **The age badge is honest with no live socket.** `capturedAt` is stated by
 *     the server inside the file name, so a cold start with the hub unreachable
 *     can paint the frame AND say how old it is. Previously the age came from a
 *     WebSocket-gated RPC, so exactly when a frame was most likely to be stale
 *     was exactly when we could not say so.
 *  2. **No sidecar metadata file.** Bytes and provenance land in ONE atomic
 *     rename, so they cannot desync. A sidecar would add a second write that can
 *     fail on its own, and a `capturedAt` that describes different bytes is the
 *     bug this cache exists to remove.
 *  3. **Native finally revalidates.** Holding the ETag lets the downloader send
 *     `If-None-Match`, so an unchanged frame costs a ~200-byte 304 and the file
 *     we keep is one whose age we know — instead of `expo-image` silently
 *     serving something else.
 *
 * ## One file per (device, WIDTH)
 *
 * Not per device. The same camera is painted at several widths (a card at
 * ~180 pt, a grid tile, a full-bleed poster at the 960 rung) and the server
 * serves a different variant for each. One path per device would have two
 * surfaces overwrite each other and paint a 180 px thumbnail into a full-bleed
 * poster. One file per (device, width) is still tiny: every surface asks for a
 * width (`snapshot-surfaces-width.spec.ts` enforces it), so the largest rung is
 * 960 px and a typical camera holds 1–3 files of 9–80 KB.
 *
 * Pure + side-effect-free (no React, no `expo-file-system`). The effects live in
 * `snapshot-file-store.ts`; this file is unit-tested in
 * `__tests__/snapshot-file-cache.spec.ts`.
 */

/** Subdirectory of the app's document directory that this cache owns outright. */
export const SNAPSHOT_CACHE_DIR_NAME = 'snapshots'

/** The only extension a paintable cached frame may have. */
const CACHE_FILE_EXT = '.jpg'

/** Extension of the in-progress download. Deliberately unparseable as a frame. */
const CACHE_TMP_EXT = '.tmp'

/** Field separator in a cache file name. Never appears in a sanitised ETag. */
const FIELD_SEPARATOR = '_'

/**
 * Past this, a cached frame is disk we are not using.
 *
 * Generous on purpose. A frame that is merely STALE is exactly what this cache
 * is for — the freshness contract is "paint always, the badge communicates
 * staleness", and blanking a tile because its camera has been unreachable for a
 * day is the defect the operator reported. This bound is disk hygiene (a camera
 * that was removed from the install, a width rung a redesign stopped using),
 * not a paint gate.
 */
export const SNAPSHOT_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** What the server's ETag states about the bytes it just served. */
export interface SnapshotEtagIdentity {
  readonly deviceId: number
  /** Epoch ms of the capture inside those bytes. */
  readonly capturedAt: number
}

/** One cached frame on disk. The name carries every field. */
export interface SnapshotCacheEntry {
  readonly fileName: string
  readonly deviceId: number
  /** `w320` | `w960` | `full` — see {@link snapshotCacheWidthKey}. */
  readonly widthKey: string
  /** The server ETag, sanitised for a file name (quotes and `W/` removed). */
  readonly etagToken: string
  readonly capturedAt: number
}

function isPositiveIntegerToken(raw: string): boolean {
  return /^\d+$/.test(raw) && Number(raw) > 0
}

/**
 * Strip an ETag down to something safe to put in a file name.
 *
 * Keeps `[A-Za-z0-9-]` only, which is everything the server actually emits, and
 * drops the rest. A dropped character means the reconstructed `If-None-Match`
 * will not match and the response is a plain 200 — slower, never wrong. A path
 * separator can therefore never reach the file system.
 */
export function sanitizeEtagToken(raw: string): string {
  const unwrapped = raw.trim().replace(/^W\//, '').replace(/^"/, '').replace(/"$/, '')
  return unwrapped.replace(/[^A-Za-z0-9-]/g, '')
}

/**
 * Read the device and the capture time out of a snapshot ETag.
 *
 * The tag is built by `snapshot-media-handler.ts` as
 * `"<deviceId>-<capturedAt>[-s<stream>][-w<width>][-v<variant>]"`. Anything that
 * does not begin with those two numbers is refused: an identity we cannot read
 * is an age we cannot state, and bytes whose age we cannot state must not be
 * stored (let alone painted).
 */
export function parseSnapshotEtag(raw: string | null | undefined): SnapshotEtagIdentity | null {
  if (typeof raw !== 'string') return null
  const token = sanitizeEtagToken(raw)
  const parts = token.split('-')
  if (parts.length < 2) return null
  const deviceId = parts[0] ?? ''
  const capturedAt = parts[1] ?? ''
  if (!isPositiveIntegerToken(deviceId) || !isPositiveIntegerToken(capturedAt)) return null
  return { deviceId: Number(deviceId), capturedAt: Number(capturedAt) }
}

/**
 * The width component of a cache file name.
 *
 * `full` is the honest name for "no preference", which the server answers with
 * the frame as captured. It is not expected in practice — every surface asks for
 * a width — but a cache keyed on a width that might be absent needs a name for
 * that case rather than an empty field.
 */
export function snapshotCacheWidthKey(width: number | undefined): string {
  if (width === undefined || !Number.isInteger(width) || width <= 0) return 'full'
  return `w${String(width)}`
}

/**
 * The cache entry for bytes the server just served, or null when the response
 * did not state a usable identity.
 *
 * Refusing is the whole safety property: a 200 with no ETag, an unparseable
 * ETag, or an ETag naming ANOTHER device produces no file. A mis-routed or
 * un-datable frame is dropped rather than stored under this camera's name.
 */
export function snapshotCacheEntryFor(
  deviceId: number,
  width: number | undefined,
  etag: string | null | undefined,
): SnapshotCacheEntry | null {
  if (typeof etag !== 'string') return null
  const identity = parseSnapshotEtag(etag)
  if (identity === null || identity.deviceId !== deviceId) return null
  const widthKey = snapshotCacheWidthKey(width)
  const etagToken = sanitizeEtagToken(etag)
  if (etagToken.length === 0) return null
  return {
    fileName: [String(deviceId), widthKey, etagToken].join(FIELD_SEPARATOR) + CACHE_FILE_EXT,
    deviceId,
    widthKey,
    etagToken,
    capturedAt: identity.capturedAt,
  }
}

/** Read a cache file name back. Anything unexpected is null — see the sweep. */
export function parseSnapshotCacheFileName(fileName: string): SnapshotCacheEntry | null {
  if (!fileName.endsWith(CACHE_FILE_EXT)) return null
  const base = fileName.slice(0, fileName.length - CACHE_FILE_EXT.length)
  const parts = base.split(FIELD_SEPARATOR)
  if (parts.length !== 3) return null
  const [deviceToken, widthKey, etagToken] = parts
  if (deviceToken === undefined || widthKey === undefined || etagToken === undefined) return null
  if (!isPositiveIntegerToken(deviceToken)) return null
  if (!/^(full|w\d+)$/.test(widthKey)) return null
  if (!/^[A-Za-z0-9-]+$/.test(etagToken)) return null
  const identity = parseSnapshotEtag(etagToken)
  if (identity === null || identity.deviceId !== Number(deviceToken)) return null
  return {
    fileName,
    deviceId: identity.deviceId,
    widthKey,
    etagToken,
    capturedAt: identity.capturedAt,
  }
}

/**
 * The `ETag` of a download response, whatever case the platform reported it in.
 *
 * iOS and Android hand back the header map as the server wrote it, and node
 * lower-cases; a cache that only looked for one spelling would silently lose
 * every frame's provenance on one platform.
 */
export function readEtagHeader(headers: Readonly<Record<string, string>> | undefined): string | null {
  if (headers === undefined) return null
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'etag' && value.length > 0) return value
  }
  return null
}

/** The exact `If-None-Match` value the server will compare against. */
export function snapshotCacheIfNoneMatch(entry: SnapshotCacheEntry): string {
  return `"${entry.etagToken}"`
}

/**
 * Where an in-progress download writes.
 *
 * `downloadAsync` writes straight into its target and replaces whatever is
 * there, so downloading onto the final name would leave a truncated JPEG under a
 * name that claims a good capture. The temp name carries no identity and is
 * therefore unparseable as a frame — a killed download can only ever leave
 * something the sweep deletes.
 */
export function snapshotCacheTmpFileName(deviceId: number, widthKey: string): string {
  return [String(deviceId), widthKey].join(FIELD_SEPARATOR) + CACHE_TMP_EXT
}

/** The newest cached frame for one surface, or null when there is none. */
export function pickCachedSnapshot(
  fileNames: readonly string[],
  deviceId: number,
  widthKey: string,
): SnapshotCacheEntry | null {
  let best: SnapshotCacheEntry | null = null
  for (const name of fileNames) {
    const entry = parseSnapshotCacheFileName(name)
    if (entry === null || entry.deviceId !== deviceId || entry.widthKey !== widthKey) continue
    if (best === null || entry.capturedAt > best.capturedAt) best = entry
  }
  return best
}

export interface SnapshotCacheSweep {
  /** The newest frame per (device, width) — everything a surface can paint. */
  readonly keep: readonly string[]
  /** Superseded frames, temp leftovers, ancient frames and unreadable names. */
  readonly remove: readonly string[]
}

/**
 * What the cache directory should contain, given what it does contain.
 *
 * Removes rather than ignores: this directory belongs to this cache alone, so a
 * name it cannot read is a name nothing will ever paint, and leaving it is
 * unbounded disk. No LRU and no size accounting — one file per (device, width)
 * is already the bound.
 */
export function planSnapshotCacheSweep(
  fileNames: readonly string[],
  now: number,
  maxAgeMs: number = SNAPSHOT_CACHE_MAX_AGE_MS,
): SnapshotCacheSweep {
  const parsed = fileNames.map((name) => ({ name, entry: parseSnapshotCacheFileName(name) }))
  const winners = new Map<string, SnapshotCacheEntry>()
  for (const { entry } of parsed) {
    if (entry === null || now - entry.capturedAt > maxAgeMs) continue
    const key = `${String(entry.deviceId)}${FIELD_SEPARATOR}${entry.widthKey}`
    const current = winners.get(key)
    if (current === undefined || entry.capturedAt > current.capturedAt) winners.set(key, entry)
  }
  const keep: string[] = []
  const remove: string[] = []
  for (const { name, entry } of parsed) {
    const key =
      entry === null ? null : `${String(entry.deviceId)}${FIELD_SEPARATOR}${entry.widthKey}`
    if (key !== null && winners.get(key)?.fileName === name) keep.push(name)
    else remove.push(name)
  }
  return { keep, remove }
}

export interface SnapshotFetchDecisionParams {
  /** False for a surface that is off screen, disabled, or a sleeping battery cam. */
  readonly enabled: boolean
  /** The identity-versioned hub URL for this surface, or null when there is
   *  nowhere to ask (no server, or the cold-start guard withheld it). */
  readonly remoteUrl: string | null
  /** The frame already on disk for this surface. */
  readonly cached: SnapshotCacheEntry | null
  /** The URL whose request already SETTLED in this process, for this surface. */
  readonly settledUrl: string | null
  /** A download for this surface is running right now. */
  readonly inFlight: boolean
}

export type SnapshotFetchDecision =
  /** Nothing to ask for. */
  | { readonly kind: 'skip' }
  /** Whatever is on disk is what this identity would give us. */
  | { readonly kind: 'keep' }
  | { readonly kind: 'fetch'; readonly url: string; readonly ifNoneMatch: string | null }

/**
 * Whether this surface should download, right now.
 *
 * **The budget rule: one download per frame, and no timer of its own.** The URL
 * already changes when — and only when — the frame identity changes (see
 * `snapshot-media-url.ts`), driven by the 5 s overview poll that costs ~40 bytes
 * per device. So "has this exact URL already settled?" is the complete question,
 * and a tile that re-renders on every poll asks for nothing.
 *
 * A settled request includes a FAILED one. Retrying on a schedule of our own
 * would be a second refresh mechanism competing with the identity, and the
 * identity is already the retry driver: the overview moves it every 5 s for a
 * watched camera and the unknown-identity fallback moves it every 30 s. What we
 * do while a fetch is failing is keep painting the last good file — which is the
 * behaviour the operator asked for.
 */
export function decideSnapshotFetch(params: SnapshotFetchDecisionParams): SnapshotFetchDecision {
  const { enabled, remoteUrl, cached, settledUrl, inFlight } = params
  if (!enabled || remoteUrl === null || remoteUrl.length === 0) return { kind: 'skip' }
  if (inFlight) return { kind: 'keep' }
  if (settledUrl === remoteUrl) return { kind: 'keep' }
  return {
    kind: 'fetch',
    url: remoteUrl,
    ifNoneMatch: cached === null ? null : snapshotCacheIfNoneMatch(cached),
  }
}
