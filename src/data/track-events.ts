/**
 * track-events — pure helpers for the track-centric events model.
 *
 * The viewer's events surfaces (timeline, reel, events page) are organised
 * around TRACKS (one tracked object across frames) rather than raw object
 * events. A track's representative "best detection" drives every surface:
 *   • the CROP (640×360 16:9 tight detection crop) is the card / reel image;
 *   • the FULL FRAME (clean, original resolution) + a "show bounding box" toggle
 *     that swaps it for the server-drawn boxed frame is the detail.
 *
 * This module is stateless and side-effect-free (no React, no `any`). It
 * normalises the server `Track` shape, selects media files by kind, and applies
 * the semantic-search thumbnail-resolution rule. Unit-tested in
 * `__tests__/track-events.spec.ts`.
 */
import { parseTrackPlacement, type TrackPlacement } from './track-placement.js'

// ─── Normalised track summary (feeds all 3 surfaces) ────────────────────────

/**
 * A track normalised for display. `bestEventId` is the id every surface resolves
 * media against (the track's representative ObjectEvent, else the trackId so the
 * event-media endpoint falls back to the track's own cadence media).
 */
export interface TrackSummary {
  readonly trackId: string
  readonly deviceId: number
  readonly cameraName: string
  readonly className: string
  /**
   * Tier-1 (COARSE) enrichment label — the classifier's family answer
   * (`Car`, `Bird`). See the tiered-label model on the server's
   * `pipeline-analytics.cap.ts`.
   */
  readonly label?: string
  /**
   * Tier-2 (FINE) enrichment label — the INSTANCE: a recognised face identity
   * (`Alice`), a plate, a species. The server's own read rule is
   * `subLabel ?? label`, and this field was simply not carried: measured live
   * on 2026-08-08, every face-recognised track had `label: undefined` and its
   * identity in `subLabel`, so the identity reached no viewer surface at all.
   */
  readonly subLabel?: string
  /** Key-event importance in [0,1] (server-computed). Absent on legacy rows. */
  readonly importance?: number
  /** Which importance sub-signal dominated (identity|dwell|proximity|…). */
  readonly importanceReason?: string
  readonly firstSeen: number
  readonly lastSeen: number
  readonly state: string
  readonly active: boolean
  /** Zone IDS the track entered. Not human text — see {@link zoneNames}. */
  readonly zonesVisited: readonly string[]
  /**
   * Human zone NAMES for {@link zonesVisited}, resolved server-side against the
   * `zones` capability.
   *
   * The stored value is a UUID (`cfeec78c-8d69-…`), which is why every search
   * surface offered "zone" and could never match one — it returned nothing
   * rather than failing. Empty on a hub that predates the resolution, and
   * SHORTER than `zonesVisited` when a zone has since been deleted: the two are
   * not positionally aligned.
   */
  readonly zoneNames: readonly string[]
  /** Distinct audio-classification labels heard during the track's life. */
  readonly audioLabels: readonly string[]
  /**
   * Every detection class on the track. A track can carry more than one
   * (`["animal","person"]` occurs in production) and `className` is only the
   * first — dropping the rest made the class filter miss those rows.
   *
   * Optional: a synthetic (sensor-linked) track genuinely has none, and a row
   * from an older server may not carry the field.
   */
  readonly classes?: readonly string[]
  /** Representative event id for media resolution (bestEventId ?? trackId). */
  readonly bestEventId: string
  /** For a SYNTHETIC (sensor-linked) track: the NAME of the device that produced
   *  the event (e.g. "Front Door Contact"). Absent on normal detection tracks. */
  readonly producingDeviceName?: string
  /**
   * Operator flag: this track is training material, and is PINNED against
   * retention while set.
   *
   * **Absent is not `false`.** A track nobody has touched omits the field; one
   * explicitly un-marked carries `false`. Every consumer must test `=== true`,
   * never `!== false`, or a legacy row renders as marked.
   */
  readonly markForTrain?: boolean
  /** Operator flag: this track wants diagnostic attention. Does NOT pin. */
  readonly debug?: boolean
  /**
   * What the operator wants CHECKED on this track, in their own words — the
   * question the {@link debug} flag alone cannot carry.
   *
   * Unlike the flags, `''` and absent mean the SAME thing here (no note), so a
   * consumer may safely read `?? ''`. What must not collapse is `''` against a
   * previous value on the WRITE side: an empty answer clears the note, an
   * absent key leaves it alone. Bound to `debug` by the hub — turning debug off
   * clears it.
   */
  readonly debugNote?: string
  /**
   * Operator flag: this track is favourited and PINNED against retention.
   *
   * **Absent is not `false`.** Test `=== true`, never `!== false`.
   */
  readonly favourited?: boolean
  /**
   * A face DETECTOR found a face on this track. It says nothing about whether
   * the face was embedded, matched or even large enough to try — a recognised
   * identity lands in {@link subLabel}, not here.
   *
   * **Absent ≠ `false`.** The field is additive and only servers on the train
   * that shipped it emit it at all, so every row from an older hub omits it.
   * Test `=== true`, never `!== false`: a server that predates the field
   * carries no answer, and "no answer" is not "no face". (The viewer no longer
   * renders a track card of its own — the hub-hosted embed decides what to
   * draw from this field — so the badge predicate that used to live here went
   * with the onboard renderer on 2026-08-18.)
   */
  readonly hasFace?: boolean
  /** Where the track's birth frame was inferred (node, device, model). Absent ⇒ unknown. */
  readonly openedPlacement?: TrackPlacement
  /** Where its last matched sighting was inferred. Absent ⇒ unknown. */
  readonly closedPlacement?: TrackPlacement
}

/**
 * True when the track is under ANY of the three operator flags.
 * Absent renders OFF (`=== true` only).
 */
export function trackHasOperatorFlag(track: {
  readonly markForTrain?: boolean
  readonly debug?: boolean
  readonly favourited?: boolean
}): boolean {
  return track.favourited === true || track.debug === true || track.markForTrain === true
}

/** Discriminant for the three Events mark-filter chips. */
export type FlagFilterKey = 'debug' | 'markForTrain' | 'favourited'

/** Which of the three mark chips are on. All-off means "do not filter by flag". */
export interface FlagFilterState {
  readonly debug: boolean
  readonly markForTrain: boolean
  readonly favourited: boolean
}

/**
 * True when the track survives the selected mark chips.
 *
 * No chip on → every track passes (the filter is idle). One or more chips on →
 * OR: a track with ANY selected flag is kept. Absent renders OFF (`=== true`).
 */
export function trackMatchesFlagFilters(
  track: {
    readonly markForTrain?: boolean
    readonly debug?: boolean
    readonly favourited?: boolean
  },
  flags: FlagFilterState,
): boolean {
  const anyOn = flags.debug || flags.markForTrain || flags.favourited
  if (!anyOn) return true
  if (flags.favourited && track.favourited === true) return true
  if (flags.debug && track.debug === true) return true
  if (flags.markForTrain && track.markForTrain === true) return true
  return false
}

/**
 * Which mark-filter chips this session may see.
 *
 * Favourite is for everyone. Debug and mark-for-train stay admin, matching the
 * header toggles. Hide on a confirmed non-admin — never grey them out.
 */
export function visibleFlagFilters(isAdmin: boolean): readonly FlagFilterKey[] {
  return isAdmin ? ['debug', 'markForTrain', 'favourited'] : ['favourited']
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0)
}

/** Distinct audio-label strings from the `audioLabels` aggregate array. */
function audioLabelStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const entry of v) {
    if (isRecord(entry) && typeof entry.label === 'string' && entry.label.length > 0) {
      if (!out.includes(entry.label)) out.push(entry.label)
    }
  }
  return out
}

/**
 * Validate + normalise one raw `listTracks` / `getTrack` row into a
 * {@link TrackSummary}. Returns null for a malformed row (never throws) so the
 * caller can skip it. `cameraName` is threaded in from the camera list.
 */
export function toTrackSummary(row: unknown, cameraName: string): TrackSummary | null {
  if (!isRecord(row)) return null
  if (typeof row.trackId !== 'string' || row.trackId.length === 0) return null
  if (typeof row.deviceId !== 'number') return null
  if (typeof row.className !== 'string' || row.className.length === 0) return null
  if (typeof row.firstSeen !== 'number' || typeof row.lastSeen !== 'number') return null

  const bestEventId =
    typeof row.bestEventId === 'string' && row.bestEventId.length > 0
      ? row.bestEventId
      : row.trackId

  return {
    trackId: row.trackId,
    deviceId: row.deviceId,
    cameraName,
    className: row.className,
    label: typeof row.label === 'string' && row.label.length > 0 ? row.label : undefined,
    subLabel:
      typeof row.subLabel === 'string' && row.subLabel.length > 0 ? row.subLabel : undefined,
    importance: typeof row.importance === 'number' ? row.importance : undefined,
    importanceReason:
      typeof row.importanceReason === 'string' ? row.importanceReason : undefined,
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
    state: typeof row.state === 'string' ? row.state : 'idle',
    active: row.active === true,
    zonesVisited: strArray(row.zonesVisited),
    zoneNames: strArray(row.zoneNames),
    audioLabels: audioLabelStrings(row.audioLabels),
    classes: strArray(row.classes),
    bestEventId,
    ...(typeof row.producingDeviceName === 'string' && row.producingDeviceName.length > 0
      ? { producingDeviceName: row.producingDeviceName }
      : {}),
    // Spread, not defaulted: absent must stay absent so "never touched" and
    // "explicitly un-marked" remain distinguishable all the way to the toggle.
    ...(typeof row.markForTrain === 'boolean' ? { markForTrain: row.markForTrain } : {}),
    ...(typeof row.debug === 'boolean' ? { debug: row.debug } : {}),
    // Additive server field: an older hub omits it and the note simply reads
    // as "none", which is the truth about a hub that cannot store one.
    ...(typeof row.debugNote === 'string' ? { debugNote: row.debugNote } : {}),
    ...(typeof row.favourited === 'boolean' ? { favourited: row.favourited } : {}),
    // Additive server field: spread, so a server that does not send it leaves
    // the summary's `hasFace` absent and every consumer's `=== true` false.
    ...(typeof row.hasFace === 'boolean' ? { hasFace: row.hasFace } : {}),
    ...placementFields(row.openedPlacement, row.closedPlacement),
  }
}

/** The two placements, each spread only when the row names a node. */
function placementFields(
  openedRaw: unknown,
  closedRaw: unknown,
): Pick<TrackSummary, 'openedPlacement' | 'closedPlacement'> {
  const opened = parseTrackPlacement(openedRaw)
  const closed = parseTrackPlacement(closedRaw)
  return {
    ...(opened !== undefined ? { openedPlacement: opened } : {}),
    ...(closed !== undefined ? { closedPlacement: closed } : {}),
  }
}

/**
 * A {@link TrackSummary} straight from a gallery row, so a tap opens the detail
 * with everything the row already knows — labels, zones, the operator flags —
 * and "network latency must never make a valid tap appear dropped". The full
 * `getTrack` row upgrades it in place afterwards (`useOpenTrack`).
 *
 * Takes the structural fields it reads rather than the whole row type, so a
 * test builds one with a literal.
 */
export function trackSummaryFromRow(row: TrackRowFields): TrackSummary {
  return {
    trackId: row.trackId,
    deviceId: row.deviceId,
    cameraName: row.cameraName,
    className: row.className,
    ...(row.label !== undefined ? { label: row.label } : {}),
    ...(row.subLabel !== undefined ? { subLabel: row.subLabel } : {}),
    ...(row.importance !== undefined ? { importance: row.importance } : {}),
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
    state: row.state,
    active: row.active,
    zonesVisited: row.zonesVisited,
    zoneNames: row.zoneNames,
    audioLabels: row.audioLabels,
    classes: row.classes,
    bestEventId: row.bestEventId,
    ...(row.producingDeviceName !== undefined ? { producingDeviceName: row.producingDeviceName } : {}),
    ...(row.markForTrain === true ? { markForTrain: true } : {}),
    ...(row.debug === true ? { debug: true } : {}),
    ...(row.favourited === true ? { favourited: true } : {}),
  }
}

/** What {@link trackSummaryFromRow} reads of a feed row. */
export type TrackRowFields = Pick<
  TrackSummary,
  | 'trackId' | 'deviceId' | 'cameraName' | 'className' | 'label' | 'subLabel' | 'importance'
  | 'firstSeen' | 'lastSeen' | 'state' | 'active' | 'zonesVisited' | 'zoneNames' | 'audioLabels'
  | 'bestEventId' | 'producingDeviceName' | 'markForTrain' | 'debug' | 'favourited'
> & { readonly classes: readonly string[] }

// ─── Display labels ─────────────────────────────────────────────────────────

/**
 * The track's display LABELS: its detection class plus every enrichment label —
 * the recognized identity / plate text (`label`) and any audio classifications
 * heard during the track. Class-first, de-duplicated. Pure — drives the label
 * chips on the events-page track tiles.
 */
export function trackLabels(track: TrackSummary): string[] {
  const out: string[] = [track.className]
  if (track.label !== undefined && !out.includes(track.label)) out.push(track.label)
  if (track.subLabel !== undefined && !out.includes(track.subLabel)) out.push(track.subLabel)
  for (const audio of track.audioLabels) {
    if (!out.includes(audio)) out.push(audio)
  }
  return out
}

/** The minimal camera-directory row {@link trackCameraName} resolves against. */
export interface CameraNameRef {
  readonly id: number
  readonly name: string
}

/**
 * The CAMERA name the track detail shows for a track.
 *
 * A summary's own `cameraName` is unreliable there: one built from a cluster
 * event or an embed click carries `''`, and the enrichment fetch
 * (`useTrackById`) passes `''` too — which is exactly how the detail modal
 * ended up naming no camera at all. The camera directory (`useCameras`) is the
 * one source that covers every context AND carries the operator's client-side
 * renames; the summary field is only a fallback for a device the directory no
 * longer lists. Returns null (never `''`) when nothing names the camera, so
 * callers can omit the row instead of rendering a blank. Pure — unit-tested.
 */
export function trackCameraName(
  track: Pick<TrackSummary, 'deviceId' | 'cameraName'>,
  cameras: readonly CameraNameRef[],
): string | null {
  const listed = cameras.find((camera) => camera.id === track.deviceId)
  if (listed !== undefined && listed.name.length > 0) return listed.name
  return track.cameraName.length > 0 ? track.cameraName : null
}

/**
 * The track's display TITLE — the prominent heading every titled surface renders
 * (reel caption, detail header). Precedence:
 *   • the producing DEVICE name for a SYNTHETIC (sensor-linked) track — the only
 *     meaningful identifier for a sensor event (e.g. "Front Door Contact"),
 *     shown INSTEAD of the bare device-type label ("Switch"). This is the
 *     surface with ROOM for it, and it is deliberately the only one: the embed
 *     TILE shows the type instead (`resolveRowTitle`), because a whole device
 *     name over a 106 px thumbnail covers the picture. Two surfaces, one fact,
 *     told at the granularity each has room for — never the name twice;
 *   • else the tier-2 IDENTITY (`subLabel`) — a recognised face name or a read
 *     plate. **Shown VERBATIM, never resolved**: it is a proper noun, not a
 *     taxonomy id, and running it through the class-translation resolver would
 *     mangle a person's name;
 *   • else the tier-1 sub-class (`label`, e.g. `van`, `dog`) — TAXONOMY, so it
 *     is RESOLVED like the class id below;
 *   • else the detection class (`className`), also resolved.
 * The tier distinction (`label-tier.ts` on the server: tier 1 is a sub-class,
 * tier 2 is an identity) is why `label` and `className` share one resolver call
 * while `subLabel` never reaches it — conflating the two mistranslated an
 * ArcFace-assigned name the one time this shipped without the split.
 * Pure — unit-tested. `resolveLabel` is threaded in because class translation is
 * a React-hook resolver (not pure), so it is resolved by the caller.
 */
export function trackTitle(
  track: Pick<TrackSummary, 'producingDeviceName' | 'subLabel' | 'label' | 'className'>,
  resolveLabel: (id: string) => string,
): string {
  if (track.producingDeviceName !== undefined) return track.producingDeviceName
  if (track.subLabel !== undefined) return track.subLabel
  if (track.label !== undefined) return resolveLabel(track.label)
  return resolveLabel(track.className)
}

/**
 * Resolve a track's visited-zone IDS to their display NAMES via a `zoneId→name`
 * map (from `zoneAnalytics.getCurrentSnapshot`). A zone that no longer exists (or
 * before the snapshot has loaded) gracefully falls back to its raw id, so the UI
 * never shows a blank and never throws. Pure — unit-tested.
 */
export function resolveZoneLabels(
  zonesVisited: readonly string[],
  nameById: Readonly<Record<string, string>>,
): string[] {
  // OWN keys only. A zone id is a string the hub chose, and `constructor` /
  // `toString` are ids like any other — a plain `nameById[id]` would render an
  // inherited property as a zone NAME.
  return zonesVisited.map((id) =>
    Object.prototype.hasOwnProperty.call(nameById, id) ? (nameById[id] ?? id) : id,
  )
}

// ─── Media selection (crop / fullFrame / fullFrameBoxed / keyFrame) ──────────

/**
 * A media file (base-64 JPEG) as returned by getEventMedia / getTrackMedia.
 *
 * `mediaId` is the row's OWN id (D482) — it addresses NOTHING about its owner
 * or kind, by design (see `event-media-url.ts`). `url` is the server-minted
 * address for it (`MediaFileInfo.url` / `MediaFile.url`, always present on a
 * wire row) — prefer it over reconstructing a URL from `mediaId` yourself.
 *
 * A synthetic tile merged in from another capability (the plate/face gallery
 * fallback, see `track-media-groups.ts`) may carry `url` with no `mediaId`
 * (its owner answered a `cropUrl` but not the row's numeric id), or neither
 * when only inline `base64` bytes are available — see {@link mediaFileId}.
 */
export interface MediaFileLite {
  readonly mediaId?: number
  readonly kind: string
  /** The server-minted address for this row (`/m/<mediaId>`, D482). */
  readonly url?: string
  /**
   * The bytes, when they were fetched.
   *
   * OPTIONAL because the track detail builds its strip from a MANIFEST
   * (`listTrackMedia`, which carries no bytes) and renders each tile from the
   * media data plane by URL. Downloading every variant up front cost 5.3-7.7
   * MB per track opened, blocking the whole view for a strip that shows a few
   * hundred KB of it.
   */
  readonly base64?: string
  readonly timestamp: number
  /** Stored size, from the manifest. Absent on rows parsed from a bytes fetch. */
  readonly sizeBytes?: number
  /**
   * True when the track's media MANIFEST does not list this entry.
   *
   * Absent — the normal case — means `listTrackMedia` vouched for the row, so
   * `getTrackMedia` can be asked for its bytes and an answer that omits them is
   * a read that FAILED. A tile merged in from another capability (the plate or
   * face gallery, whose crop the hub stores under its own owner) is the
   * opposite: the manifest never listed it, `getTrackMedia` answers `[]`
   * because it is not looking where that row lives, and the only honest source
   * for its pixels is its data-plane URL.
   *
   * v1.0.405 shipped that tile unmarked. The `[]` was read as a failed byte
   * read and the detail put a red triangle over a plate crop the hub was
   * holding; the strip's thumbnail kept working only because it renders by URL
   * and never asks. See {@link trackMediaEntryNeedsFetch}.
   */
  readonly offManifest?: boolean
}

/**
 * A stable per-tile identity string for React keys / effect deps / dedup —
 * NEVER sent to the server and never parsed back into an id. Prefers the
 * row's own {@link MediaFileLite.mediaId}, then its {@link MediaFileLite.url},
 * then a `kind`+`timestamp` pair for a legacy tile that carries neither (a
 * base64-only gallery fallback — see `track-media-groups.ts`).
 */
export function mediaFileId(file: MediaFileLite): string {
  if (file.mediaId !== undefined) return `id:${file.mediaId}`
  if (file.url !== undefined && file.url.length > 0) return `url:${file.url}`
  return `legacy:${file.kind}:${file.timestamp}`
}

/** Parse a raw `getEventMedia` / `getTrackMedia` array into typed files. Tolerant:
 *  skips malformed rows, returns [] for a non-array. Never throws. */
export function parseMediaFiles(raw: unknown): MediaFileLite[] {
  if (!Array.isArray(raw)) return []
  const out: MediaFileLite[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const mediaId = typeof entry.mediaId === 'number' ? entry.mediaId : null
    const kind = typeof entry.kind === 'string' && entry.kind.length > 0 ? entry.kind : null
    const url = typeof entry.url === 'string' && entry.url.length > 0 ? entry.url : null
    const base64 = typeof entry.base64 === 'string' && entry.base64.length > 0 ? entry.base64 : null
    const timestamp = typeof entry.timestamp === 'number' ? entry.timestamp : 0
    if (mediaId === null || kind === null || base64 === null) continue
    out.push({ mediaId, kind, base64, timestamp, ...(url !== null ? { url } : {}) })
  }
  return out
}

/**
 * Parse a `listTrackMedia` manifest — the same rows WITHOUT bytes.
 *
 * Separate from {@link parseMediaFiles} rather than a relaxed version of it:
 * that one REQUIRES `base64` and skipping the check there would let a
 * byte-fetch silently yield byte-less rows, which render as nothing.
 */
export function parseMediaManifest(raw: unknown): MediaFileLite[] {
  if (!Array.isArray(raw)) return []
  const out: MediaFileLite[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const mediaId = typeof entry.mediaId === 'number' ? entry.mediaId : null
    const kind = typeof entry.kind === 'string' && entry.kind.length > 0 ? entry.kind : null
    if (mediaId === null || kind === null) continue
    out.push({
      mediaId,
      kind,
      timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : 0,
      ...(typeof entry.url === 'string' && entry.url.length > 0 ? { url: entry.url } : {}),
      ...(typeof entry.sizeBytes === 'number' ? { sizeBytes: entry.sizeBytes } : {}),
    })
  }
  return out
}

/** First media file matching `kind`, or undefined. */
export function pickMediaByKind(
  files: readonly MediaFileLite[],
  kind: string,
): MediaFileLite | undefined {
  return files.find((f) => f.kind === kind)
}

// `mediaDataUri` / `resolveTrackDetailImages` lived here until 2026-08-20.
// They pre-dated the manifest: they folded a track's media into three `data:`
// URIs (crop / clean frame / boxed frame) built from `base64`. Once the strip
// moved to URL-backed tiles nothing read those three fields — the detail view
// takes `gallery` and `loading` only — and under a byte-less manifest the
// resolver would have produced `data:image/jpeg;base64,undefined` for every
// one of them. Deleted rather than left as a tested-but-unused helper, which
// is the shape a future reader mistakes for a working code path.
// The kind PREFERENCES it encoded are not lost: `cleanFrameId` below still
// ranks keyFrame → keyFrameSmall → fullFrame → firstFrame → lastFrame.

// ─── Full media gallery (ALL existing media for a track) ─────────────────────

/**
 * Kind ordering for the per-track media gallery — the representative crop first,
 * then identity/plate crops, then the clean + boxed frames, then the cadence
 * frames, then anything else. Unknown kinds sort last. This governs ONLY display
 * order; the gallery never fabricates a kind that the pipeline did not capture.
 */
const GALLERY_KIND_ORDER: readonly string[] = [
  'crop', 'thumbnail', 'thumbnailSmall', 'faceCrop', 'plateCrop',
  'fullFrame', 'fullFrameBoxed', 'keyFrame', 'keyFrameSmall', 'firstFrame', 'lastFrame', 'snapshot',
]

/**
 * Fold a track's event-owned + track-owned media into ONE deduplicated, ordered
 * list of every file that ACTUALLY EXISTS — the source for the detail's "all
 * media below the best shot" strip. Deduped by {@link mediaFileId} (an
 * event-owned file wins a clash); ordered by {@link GALLERY_KIND_ORDER} then
 * timestamp then id for total determinism. Pure — no placeholders are ever
 * synthesised for absent kinds, so the UI shows exactly what the server
 * stored. Unit-tested.
 */
export function buildTrackGallery(
  eventFiles: readonly MediaFileLite[],
  trackFiles: readonly MediaFileLite[],
): MediaFileLite[] {
  const byId = new Map<string, MediaFileLite>()
  for (const f of [...eventFiles, ...trackFiles]) {
    const id = mediaFileId(f)
    if (!byId.has(id)) byId.set(id, f)
  }
  const rank = (kind: string): number => {
    const i = GALLERY_KIND_ORDER.indexOf(kind)
    return i === -1 ? GALLERY_KIND_ORDER.length : i
  }
  return [...byId.values()].sort((a, b) => {
    const ra = rank(a.kind)
    const rb = rank(b.kind)
    if (ra !== rb) return ra - rb
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
    const ia = mediaFileId(a)
    const ib = mediaFileId(b)
    return ia < ib ? -1 : ia > ib ? 1 : 0
  })
}

/** The {@link mediaFileId} of the CLEAN full frame in a gallery (the one the
 *  client-side bbox overlay is computed for): native `keyFrame` →
 *  `keyFrameSmall` → legacy `fullFrame` → `firstFrame` → `lastFrame`. Native
 *  clean frames win over the legacy 640 `fullFrame`. Null when the track
 *  carries no clean frame. */
export function cleanFrameId(gallery: readonly MediaFileLite[]): string | null {
  const clean =
    pickMediaByKind(gallery, 'keyFrame') ??
    pickMediaByKind(gallery, 'keyFrameSmall') ??
    pickMediaByKind(gallery, 'fullFrame') ??
    pickMediaByKind(gallery, 'firstFrame') ??
    pickMediaByKind(gallery, 'lastFrame')
  return clean !== undefined ? mediaFileId(clean) : null
}

// ─── Media kind display ──────────────────────────────────────────────────────

/**
 * Media kinds that ARE a clean full frame — the only ones the client-side bbox
 * overlay (the "show bounding box" toggle) may apply to. Includes the native
 * `keyFrame` and its 960 downscaled sibling `keyFrameSmall` (both clean, no
 * server-burned box). The cadence frames (`firstFrame`/`lastFrame`/`snapshot`)
 * carry a server-burned target box already, so they are NOT here — the toggle
 * would double-draw. Pure — unit-tested.
 */
export const FRAME_KINDS: ReadonlySet<string> = new Set<string>([
  'fullFrame', 'fullFrameBoxed', 'keyFrame', 'keyFrameSmall',
])

/** Minimal i18next translate signature (matches `export-format.ts`). */
export type Translate = (key: string, opts?: Record<string, unknown>) => string

/**
 * Human label for a media kind (falls back to the raw kind). Each kind gets a
 * DISTINCT label so the media strip never renders two identically-labelled tiles
 * — in particular the event-owned subject `crop` ("Object crop") and the
 * track-owned best `thumbnail` ("Best shot") no longer both read "Crop". The
 * native `keyFrame` and its 960 `keyFrameSmall` variant share the "Key frame"
 * label; the best-shot `thumbnail` and its 480 `thumbnailSmall` variant share
 * the "Best shot" label (same subject crop, two resolutions). Localised via an injected i18next
 * `t` (the pure-module convention); unknown kinds fall back to the raw kind.
 * Pure — unit-tested.
 */
export function mediaKindLabel(kind: string, t: Translate): string {
  const key = MEDIA_KIND_I18N_KEY[kind]
  if (key === undefined) return kind
  return t(key)
}

/** Media-kind → `v2.mediaKind.*` i18n key. Kinds absent here fall back raw. */
const MEDIA_KIND_I18N_KEY: Readonly<Record<string, string>> = {
  crop: 'v2.mediaKind.crop',
  thumbnail: 'v2.mediaKind.thumbnail',
  thumbnailSmall: 'v2.mediaKind.thumbnail',
  faceCrop: 'v2.mediaKind.faceCrop',
  plateCrop: 'v2.mediaKind.plateCrop',
  fullFrame: 'v2.mediaKind.fullFrame',
  fullFrameBoxed: 'v2.mediaKind.fullFrameBoxed',
  keyFrame: 'v2.mediaKind.keyFrame',
  keyFrameSmall: 'v2.mediaKind.keyFrame',
  firstFrame: 'v2.mediaKind.firstFrame',
  lastFrame: 'v2.mediaKind.lastFrame',
  snapshot: 'v2.mediaKind.snapshot',
}

// ─── Face-section gating ─────────────────────────────────────────────────────

/**
 * Whether the detail should render the face / identity section for a track. TRUE
 * only when the track actually carries a detected face — a `getFaceByTrack` hit
 * (`face !== null`). Tracks with no face media render NO face UI at all (never an
 * empty "No face enrolled" panel). Pure — unit-tested.
 */
export function shouldRenderFaceSection(
  face: { readonly base64?: string } | null | undefined,
): boolean {
  return face !== null && face !== undefined
}

// ─── Semantic search thumbnail resolution ───────────────────────────────────

/**
 * A scored object event from `searchObjectEvents` normalised for display.
 *
 * `id` is the object event's OWN id (D474: a number on the wire, kept as its
 * decimal string form here — this module's ids are all strings). The scored
 * event may carry no media of its own; {@link scoredToTrackSummary} resolves
 * an explicit owner for it rather than guessing from a folded id (D482) — see
 * that function.
 */
export interface ScoredResult {
  readonly id: string
  readonly deviceId: number
  readonly timestamp: number
  readonly className: string
  readonly label?: string
  readonly score: number
  /** The event's own media row id, when it has one of its own (D482). */
  readonly mediaId?: number
  /** Track id (for opening the track detail), when present. */
  readonly trackId?: string
}

/** Validate + normalise one `searchObjectEvents` row. Null on malformed. */
export function toScoredResult(row: unknown): ScoredResult | null {
  if (!isRecord(row)) return null
  const id =
    typeof row.id === 'string' && row.id.length > 0
      ? row.id
      : typeof row.id === 'number'
        ? String(row.id)
        : null
  if (id === null) return null
  if (typeof row.deviceId !== 'number') return null
  if (typeof row.className !== 'string' || row.className.length === 0) return null
  if (typeof row.timestamp !== 'number') return null
  if (typeof row.score !== 'number') return null

  const mediaId = typeof row.mediaId === 'number' ? row.mediaId : null
  const trackId = typeof row.trackId === 'string' && row.trackId.length > 0 ? row.trackId : null

  return {
    id,
    deviceId: row.deviceId,
    timestamp: row.timestamp,
    className: row.className,
    label: typeof row.label === 'string' && row.label.length > 0 ? row.label : undefined,
    score: row.score,
    ...(mediaId !== null ? { mediaId } : {}),
    ...(trackId !== null ? { trackId } : {}),
  }
}

/**
 * Build a minimal {@link TrackSummary} from a scored search result so the shared
 * track detail can open on a search hit.
 *
 * `bestEventId` follows the same rule every other track-derived view model
 * does: prefer the TRACK when one exists (`trackId`), since every media
 * surface can address a track by its own owner form (D482) — falling back to
 * the object event's own id only when the hit carries no track at all. Never
 * a folded `mediaId ?? trackId ?? id` string: `bestEventId` stays a
 * `Track.bestEventId`-shaped opaque pointer, and the caller that builds an
 * actual media address from it (`EventThumb`) resolves it against `trackId`
 * first, exactly as it does for every other track.
 */
export function scoredToTrackSummary(r: ScoredResult, cameraName: string): TrackSummary {
  return {
    trackId: r.trackId ?? r.id,
    deviceId: r.deviceId,
    cameraName,
    className: r.className,
    label: r.label,
    firstSeen: r.timestamp,
    lastSeen: r.timestamp,
    state: 'idle',
    active: false,
    zonesVisited: [],
    zoneNames: [],
    audioLabels: [],
    classes: [],
    bestEventId: r.trackId ?? r.id,
  }
}
