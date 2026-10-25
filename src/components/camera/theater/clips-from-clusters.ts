/**
 * clips-from-clusters — clips mode, derived from the cards the timeline is
 * ALREADY showing.
 *
 * ## The divergence this removes
 *
 * The theater had two independent answers to "what happened on this camera".
 * The normal timeline clustered `listTracks` rows client-side (`clusterByZoom`)
 * and drew the recording coverage it had already fetched. Clips mode threw all
 * of that away and asked `videoclips.listClips`, which clusters the SERVER's
 * own event log into visits with its own gap constant, its own labels, its own
 * thumbnails and its own truncation rules.
 *
 * Two sources, two clusterers, one camera: the operator opened clips mode on a
 * camera and saw a different set of cards than the one they had just been
 * looking at. That is not a bug in either clusterer — it is what two clusterers
 * over two datasets always eventually produce.
 *
 * So there is now ONE list. Clips mode takes the exact `PositionedCluster[]`
 * the normal timeline built — same function, same events, same zoom — and asks
 * one further question of the data the timeline ALSO already has: does
 * `recording.getAvailability` say there is footage under this card? A cluster
 * with footage becomes a clip; a cluster with none is dropped, because the
 * clips list answers "what can I rewatch", not "what happened".
 *
 * Label parity comes for free: the chips are `cluster.classes`, resolved by the
 * pipeline that resolves them everywhere else.
 *
 * ## Footage with nothing attached still shows up
 *
 * A camera that records on motion writes footage that no track ever explains.
 * The hub emitted those as motion-kind visits and they must not disappear with
 * the server road — so availability the clusters do not claim becomes a
 * synthetic motion card, anchored at the one instant a still can actually be
 * decoded ({@link stillInstantMs}).
 *
 * ## The trade-off, on purpose
 *
 * A derived clip's window is its cluster CLAMPED to the footage, so a card can
 * now describe a window whose footage is partial — the availability gaps ride
 * along in {@link Clip.holes}, and the recorded transport already snaps a seek
 * to the nearest footage, so a hole is a shorter play, never a dead card. The
 * `videoclips.listClips` cap itself is untouched and still serves the hub's own
 * admin surface — only this app's own direct read of it (`use-clips.ts`,
 * `TimelineClipsPanel.tsx`) is gone, deleted with the panel it fed (Task 3.1,
 * `docs/design/plans/fase-3-viewer-timeline-clip.md`).
 *
 * ## The native list, and why it does not re-open that defect
 *
 * A clip the CAMERA wrote (an SD-card file, an HKSV asset) cannot be derived
 * from availability at all: we have no footage under it. Those arrive from
 * `videoclips.listClips` through {@link nativeDerivedClips}, and the seam is a
 * BRANCH, not a merge — the operator settled that (*"La sorgente deve essere
 * selezionata … come provider di quella camera. Mai mischiate provider
 * diversi."*, and on our own recordings *"Non devono avere alcuna
 * connessione."*). One camera, one source, chosen in that camera's settings:
 * the derived list and the native list are never on screen together, so there
 * is never a second answer to "what happened on this camera" to disagree with
 * the first. That is the defect this module exists to remove, and it is what
 * makes the branch safe where a merge would not be (D569).
 *
 * Pure: no React, no i18n, no network. Geometry comes from `clip-axis.ts`.
 */

import {
  CLIP_SOURCE_ANALYTICS,
  isPlayable,
  type Clip,
  type ClipHole,
  type ClipKind,
} from '../../../clips/clip-model.js'
import { clipChipClass, clipChipClasses } from '../../../clips/clip-chip-classes.js'
import type { ClipAxis, ClipAxisClipSlot } from '../../../clips/clip-axis.js'
import { stillMediaPath } from '../../../data/still-media-url.js'
import type { ObjectEvent, PositionedCluster } from './event-cluster.js'

// ─── Types ────────────────────────────────────────────────────────────

/** One recorded stretch, exactly as `recording.getAvailability` reports it
 *  (see `use-timeline-activity.ts`, which already merges the per-profile
 *  duplicates into a coverage union). */
export interface FootageRange {
  readonly startMs: number
  readonly endMs: number
}

/** Recorder rolls glued into the stretch of footage they belong to. */
export interface FootageVisit {
  readonly startMs: number
  readonly endMs: number
  readonly ranges: readonly FootageRange[]
  readonly holes: readonly FootageRange[]
}

/** A clip of the derived list, and the timeline card it IS. */
export interface DerivedClip {
  readonly clip: Clip
  /** The normal-mode cluster this clip was derived from — `null` for a
   *  footage-only visit, which has no cluster by definition. */
  readonly cluster: PositionedCluster | null
  /** The instant a still can be decoded inside the clip's window. */
  readonly stillAtMs: number | undefined
}

export interface DeriveClipsInput {
  /** The cards the NORMAL timeline drew: `clusterByZoom`'s output, verbatim. */
  readonly clusters: readonly PositionedCluster[]
  /** Recording availability over the same window the clusters were built from. */
  readonly recording: readonly FootageRange[]
  readonly deviceId: number
  /** Override for tests; defaults to {@link VISIT_MERGE_GAP_MS}. */
  readonly mergeGapMs?: number
}

// ─── Constants ────────────────────────────────────────────────────────

/**
 * Gap up to which two recorder rolls are the SAME stretch of footage.
 *
 * Deliberately the same 30 s the hub's own visit clusterer uses, and
 * deliberately RE-DECLARED here rather than imported: the viewer must not gain
 * a build dependency on an addon's internals to draw a card. If the hub ever
 * changes its grain, this diverging is a visible difference between the two
 * roads, which is the honest failure mode — a shared import would hide it
 * behind a version skew instead.
 */
export const VISIT_MERGE_GAP_MS = 30_000

/**
 * Shortest window a card may describe.
 *
 * A subject the tracker saw for an instant (an audio event, a single-frame
 * detection) has a zero-length span, and a zero-length clip is dropped by
 * `normalizeClips` — the card would vanish from clips mode while staying on the
 * normal timeline, which is the exact divergence this module exists to remove.
 * Five seconds is under one recorder roll (~8–12 s), so the padding is served
 * by footage that already exists rather than inventing a seek into a hole.
 */
export const MIN_CLIP_WINDOW_MS = 5_000

/** Ceiling on the ids carried for thumbnail recovery. One busy visit on the hub
 *  once carried 2 345 of them and was 99% of the camera-day payload. */
const MAX_DERIVED_EVENT_IDS = 8

// ─── Footage visits ───────────────────────────────────────────────────

function ascending(ranges: readonly FootageRange[]): readonly FootageRange[] {
  return [...ranges]
    .filter((r) => Number.isFinite(r.startMs) && Number.isFinite(r.endMs) && r.endMs > r.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
}

/** Gaps between consecutive (already ascending, already clipped) ranges. */
function holesBetween(ranges: readonly FootageRange[]): readonly FootageRange[] {
  const holes: FootageRange[] = []
  for (let i = 1; i < ranges.length; i++) {
    const prevEnd = ranges[i - 1]!.endMs
    const nextStart = ranges[i]!.startMs
    if (nextStart > prevEnd) holes.push({ startMs: prevEnd, endMs: nextStart })
  }
  return holes
}

/**
 * Glue recorder rolls into visits.
 *
 * Disk writes one fMP4 per ffmpeg roll and the recorder calendar merges only
 * the sub-5 s seams, so one walk past the camera arrives here as several ranges
 * with GOP-sized holes between them. Without this, a single visit would become
 * a dozen cards.
 */
export function clusterFootageVisits(
  ranges: readonly FootageRange[],
  gapMs: number = VISIT_MERGE_GAP_MS,
): readonly FootageVisit[] {
  const sorted = ascending(ranges)
  if (sorted.length === 0) return []

  const visits: FootageVisit[] = []
  let pieces: FootageRange[] = [sorted[0]!]
  let endMs = sorted[0]!.endMs

  function close(): void {
    visits.push({
      startMs: pieces[0]!.startMs,
      endMs,
      ranges: pieces,
      holes: holesBetween(pieces),
    })
  }

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!
    if (next.startMs <= endMs + gapMs) {
      pieces.push(next)
      endMs = Math.max(endMs, next.endMs)
      continue
    }
    close()
    pieces = [next]
    endMs = next.endMs
  }
  close()
  return visits
}

/**
 * The instant a recorded still can actually be decoded: the midpoint of the
 * LONGEST contiguous range.
 *
 * NOT the midpoint of the visit. A visit spans its holes by construction, so
 * the naive midpoint lands in dead air roughly as often as not — the hub's
 * still route answered 204 for visits with plenty of footage until it computed
 * it this way. Re-declared here for the same reason as
 * {@link VISIT_MERGE_GAP_MS}; the rule is shared, the code is not.
 */
export function stillInstantMs(ranges: readonly FootageRange[]): number | undefined {
  let best: FootageRange | undefined
  for (const range of ranges) {
    if (best === undefined || range.endMs - range.startMs > best.endMs - best.startMs) best = range
  }
  if (best === undefined) return undefined
  return Math.floor((best.startMs + best.endMs) / 2)
}

// ─── Cluster → window ─────────────────────────────────────────────────

/**
 * The wall-clock stretch a cluster's subjects actually occupy.
 *
 * `PositionedCluster.startMs/endMs` are built from event TIMESTAMPS alone, so a
 * track that was visible for two minutes reports as a point. The clip window
 * must cover the subject's whole life, so it reads `endTimestamp` too.
 */
export function clusterSpanMs(cluster: PositionedCluster): FootageRange {
  let startMs = Number.POSITIVE_INFINITY
  let endMs = Number.NEGATIVE_INFINITY
  for (const e of cluster.events) {
    startMs = Math.min(startMs, e.timestamp)
    endMs = Math.max(endMs, e.endTimestamp ?? e.timestamp)
  }
  if (!Number.isFinite(startMs)) return { startMs: cluster.anchorMs, endMs: cluster.anchorMs }
  return { startMs, endMs: Math.max(startMs, endMs) }
}

/** Ranges cut down to `[startMs, endMs]`, empty slices dropped. */
function intersect(
  ranges: readonly FootageRange[],
  startMs: number,
  endMs: number,
): readonly FootageRange[] {
  const out: FootageRange[] = []
  for (const r of ranges) {
    const s = Math.max(r.startMs, startMs)
    const e = Math.min(r.endMs, endMs)
    if (e > s) out.push({ startMs: s, endMs: e })
  }
  return out
}

/** True when the closed spans touch — closed so a point subject sitting exactly
 *  on a boundary still finds its footage. */
function overlaps(a: FootageRange, b: FootageRange): boolean {
  return a.startMs <= b.endMs && a.endMs >= b.startMs
}

/**
 * The clip window for a span, clamped to the footage that carries it and never
 * shorter than {@link MIN_CLIP_WINDOW_MS} unless the footage itself is.
 */
function windowFor(span: FootageRange, bounds: FootageRange): FootageRange | null {
  let startMs = Math.max(span.startMs, bounds.startMs)
  let endMs = Math.min(span.endMs, bounds.endMs)
  if (endMs < startMs) return null

  if (endMs - startMs < MIN_CLIP_WINDOW_MS) {
    const mid = (startMs + endMs) / 2
    startMs = Math.max(bounds.startMs, mid - MIN_CLIP_WINDOW_MS / 2)
    endMs = Math.min(bounds.endMs, startMs + MIN_CLIP_WINDOW_MS)
    // Clipped at the older edge — take the slack back off the newer one.
    startMs = Math.max(bounds.startMs, endMs - MIN_CLIP_WINDOW_MS)
  }

  const rounded: FootageRange = { startMs: Math.round(startMs), endMs: Math.round(endMs) }
  return rounded.endMs > rounded.startMs ? rounded : null
}

function toHoles(ranges: readonly FootageRange[]): readonly ClipHole[] {
  return holesBetween(ranges).map((h) => ({ startMs: h.startMs, endMs: h.endMs }))
}

/** Classes the cluster resolved, junk removed. These ARE the card's chips. */
function clusterClasses(cluster: PositionedCluster): readonly string[] {
  return cluster.classes.filter((c) => typeof c === 'string' && c.length > 0)
}

function clusterKind(classes: readonly string[]): ClipKind {
  return classes.length > 0 ? 'object' : 'motion'
}

function clusterEventIds(cluster: PositionedCluster): readonly string[] {
  const ids: string[] = []
  for (const e of [cluster.anchorEvent, ...cluster.carouselEvents]) {
    if (e.id.length > 0 && !ids.includes(e.id)) ids.push(e.id)
    if (ids.length >= MAX_DERIVED_EVENT_IDS) break
  }
  return ids
}

// ─── Derivation ───────────────────────────────────────────────────────

/**
 * The clips-mode list: every timeline cluster that has footage under it, plus
 * every stretch of footage no cluster claims.
 *
 * Returned newest-first, matching the cluster list and the theater's live-edge
 * -at-the-top convention. `buildClipAxis` re-sorts anyway; the order is for the
 * benefit of humans reading a log line.
 */
export function deriveClipsFromClusters(input: DeriveClipsInput): readonly DerivedClip[] {
  const visits = clusterFootageVisits(input.recording, input.mergeGapMs)
  if (visits.length === 0) return []

  const claimed = new Set<FootageVisit>()
  const derived: DerivedClip[] = []

  for (const cluster of input.clusters) {
    const span = clusterSpanMs(cluster)
    const touched = visits.filter((v) => overlaps(span, v))
    // No footage under the card. It stays on the normal timeline — it happened —
    // but it is not something the operator can rewatch, so it is not a clip.
    if (touched.length === 0) continue
    for (const v of touched) claimed.add(v)

    const bounds: FootageRange = {
      startMs: touched[0]!.startMs,
      endMs: touched[touched.length - 1]!.endMs,
    }
    const win = windowFor(span, bounds)
    if (win === null) continue

    const pieces = intersect(
      touched.flatMap((v) => v.ranges),
      win.startMs,
      win.endMs,
    )
    const classes = clusterClasses(cluster)
    const thumbnailUrl = cluster.anchorEvent.mediaUrl

    derived.push({
      cluster,
      stillAtMs: stillInstantMs(pieces),
      clip: {
        clipId: `cluster:${cluster.id}`,
        deviceId: input.deviceId,
        startMs: win.startMs,
        endMs: win.endMs,
        sourceId: CLIP_SOURCE_ANALYTICS,
        kind: clusterKind(classes),
        playback: { kind: 'recorded', deviceId: input.deviceId },
        ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
        eventIds: clusterEventIds(cluster),
        ...(classes.length > 0 ? { labels: classes } : {}),
        holes: toHoles(pieces),
      },
    })
  }

  for (const visit of visits) {
    if (claimed.has(visit)) continue
    derived.push({
      cluster: null,
      stillAtMs: stillInstantMs(visit.ranges),
      clip: {
        clipId: `footage:${visit.startMs}:${visit.endMs}`,
        deviceId: input.deviceId,
        startMs: visit.startMs,
        endMs: visit.endMs,
        sourceId: CLIP_SOURCE_ANALYTICS,
        // Footage with nothing attached is exactly what the hub called a
        // motion visit. No labels field at all — an empty array would be a
        // property every consumer then has to length-check.
        kind: 'motion',
        playback: { kind: 'recorded', deviceId: input.deviceId },
        holes: toHoles(visit.ranges),
      },
    })
  }

  return derived.sort((a, b) => b.clip.startMs - a.clip.startMs)
}

// ─── Card ⇄ clip ──────────────────────────────────────────────────────

/**
 * The card id a derived clip is DRAWN under.
 *
 * NOT the clip id. A cluster-backed card IS the cluster (spread whole by
 * {@link positionDerivedClips}), so it keeps the cluster's id while its clip is
 * keyed `cluster:<id>`; only a footage-only card is its own clip. The two were
 * treated as interchangeable and the clips-mode advance sequencer went looking
 * for an EVENT id in a list of clip ids, found nothing, and held forever — so
 * the one thing clips mode exists to do (play visits back to back, no dead air)
 * never happened after a tap.
 */
export function cardIdForClip(entry: DerivedClip): string {
  return entry.cluster !== null ? entry.cluster.id : entry.clip.clipId
}

/**
 * Every drawn card id → the instant tapping it plays from.
 *
 * The card's TIME LABEL reads this, so the label and the tap come from one
 * derivation instead of two ends of the same cluster. They used to disagree by
 * construction: the label was `anchorEvent.timestamp` (the NEWEST subject) and
 * the tap is `clip.startMs` (the OLDEST subject, clamped to footage) — 128 s
 * apart on the card the operator reported, and clamped the other way on the
 * card below it.
 *
 * Keyed by {@link cardIdForClip}, which is what the scroller draws under; a
 * cluster-backed card is keyed by its CLUSTER, not by `clip.clipId`.
 */
export function clipStartByCardId(derived: readonly DerivedClip[]): ReadonlyMap<string, number> {
  const starts = new Map<string, number>()
  for (const entry of derived) starts.set(cardIdForClip(entry), entry.clip.startMs)
  return starts
}

/**
 * Every drawn card id → the instant its clip's footage ends — the OTHER end of
 * the window {@link clipStartByCardId} already exposes.
 *
 * Reads `entry.clip.endMs`, the availability-CLAMPED end (what
 * `resolveClipAdvance` actually advances off of), never `entry.cluster.endMs`
 * (the cluster's raw last-subject timestamp, which a cluster-backed card keeps
 * unclamped — see `positionDerivedClips`). Showing the cluster's own end next
 * to the clip's own start would label one card with two different clips'
 * windows.
 */
export function clipEndByCardId(derived: readonly DerivedClip[]): ReadonlyMap<string, number> {
  const ends = new Map<string, number>()
  for (const entry of derived) ends.set(cardIdForClip(entry), entry.clip.endMs)
  return ends
}

/** The clip a tapped card stands for, or null when nothing draws that id. */
export function clipForCardId(
  derived: readonly DerivedClip[],
  cardId: string,
): Clip | null {
  for (const entry of derived) {
    if (cardIdForClip(entry) === cardId) return entry.clip
  }
  return null
}

// ─── Positioning ──────────────────────────────────────────────────────

/**
 * The native clips of ONE source, as clips-mode entries.
 *
 * `cluster: null` because there is no cluster — no track of ours explains a
 * file the camera wrote — and `stillAtMs` undefined because there is no instant
 * of OUR footage to decode: the picture is the provider's mint (see
 * {@link nativeClipCard}).
 *
 * A row the provider REFUSES (`playable: false`) is dropped. A card whose tap
 * is guaranteed to fail is worse than a shorter list, and the reason travels
 * with the source's own state on the surface above.
 */
export function nativeDerivedClips(clips: readonly Clip[]): readonly DerivedClip[] {
  const out: DerivedClip[] = []
  for (const clip of clips) {
    if (!isPlayable(clip)) continue
    out.push({ clip, cluster: null, stillAtMs: undefined })
  }
  return out
}

/**
 * The card for a clip that lives on the CAMERA.
 *
 * Its picture is the provider's MINT path and nothing else. {@link
 * footageOnlyCard} stamps `stillMediaPath` — the recorder's own frame route —
 * and on a clip held on an SD card that address resolves into footage we do not
 * have: the card would draw whatever OUR recording held at that instant, a
 * picture of the right moment from the wrong source. No picture is better.
 *
 * The chip is `labels` — the hub's resolved vocabulary, the same one every
 * other card on this timeline is chipped with — falling back to `motion`, via
 * `clip-chip-classes.ts`. It used to fall back to `Clip.kind`, whose `native`
 * value means "this row has no kind of its own, read the labels": printing it
 * answered the question it was told not to ask, and put an internal identifier
 * on the operator's screen.
 *
 * `nativeTypes` (`md`, `dog_cat`) is the CAMERA's word for the same event and
 * has no translation in this app; the two are different claims and only one of
 * them is ours to render.
 */
function nativeClipCard(entry: DerivedClip, slot: ClipAxisClipSlot): PositionedCluster {
  const { clip } = entry
  const event: ObjectEvent = {
    id: clip.clipId,
    deviceId: clip.deviceId,
    timestamp: clip.startMs,
    endTimestamp: clip.endMs,
    className: clipChipClass(clip),
    // BOTH still addresses, never `mediaUrl`: these need the session's
    // `Authorization` header and are fetched through `useClipStill`, and the
    // mint answers 204 far more often than it answers a JPEG (43 of 60 tiles
    // on a measured first paint) — only a `fetch` can read WHY.
    //
    // The served one used to be dropped here, and the Reolink onboard rows
    // carry ONLY that: a `thumbnail` the provider already holds, no mint. So
    // the card arrived at `clipStillSource` empty and no still was ever asked
    // for — zero asks in the telemetry, which is how it was found. Both are
    // carried now and the picker prefers the served one (D580).
    ...(clip.thumbnailUrl !== undefined ? { thumbnailUrl: clip.thumbnailUrl } : {}),
    ...(clip.thumbnailMintUrl !== undefined ? { thumbnailMintUrl: clip.thumbnailMintUrl } : {}),
  }
  const classes = clipChipClasses(clip)
  return {
    id: clip.clipId,
    events: [event],
    carouselEvents: [event],
    representative: event,
    anchorEvent: event,
    anchorMs: clip.startMs,
    importantEvent: event,
    classes,
    labels: [],
    startMs: clip.startMs,
    endMs: clip.endMs,
    topPx: slot.topPx,
    heightPx: slot.heightPx,
  }
}

/** A clip that came from a camera's own storage rather than from our footage. */
function isNativeClip(clip: Clip): boolean {
  return clip.sourceId !== CLIP_SOURCE_ANALYTICS
}

/** The card for a stretch of footage nothing explains. */
function footageOnlyCard(entry: DerivedClip, slot: ClipAxisClipSlot): PositionedCluster {
  const { clip } = entry
  const anchorMs = entry.stillAtMs ?? clip.startMs
  const event: ObjectEvent = {
    id: clip.clipId,
    deviceId: clip.deviceId,
    timestamp: anchorMs,
    endTimestamp: clip.endMs,
    // The LABELS, not the kind. This read `clip.kind` unconditionally with the
    // resolved vocabulary sitting right beside it, so a row the server had
    // classed `person` was chipped `native` — the internal "read the labels"
    // value, printed instead of reading them (`clip-chip-classes.ts`).
    className: clipChipClass(clip),
    // The RECORDED still, which is the only picture this card can ever have.
    //
    // Its `id` is a synthetic `footage:` key no media plane can resolve and it
    // has no analytics event to fall back on, so without this every motion-only
    // visit drew the question-mark glyph — on cameras that record on motion,
    // most of the clips list. {@link stillInstantMs} was already computed for
    // exactly this and was reaching nothing but the anchor.
    //
    // Server-RELATIVE on purpose: this module is pure, and `EventThumb`
    // resolves a relative media URL against the connected hub.
    ...(entry.stillAtMs !== undefined
      ? { mediaUrl: stillMediaPath(clip.deviceId, entry.stillAtMs) }
      : {}),
  }
  return {
    id: clip.clipId,
    events: [event],
    carouselEvents: [event],
    representative: event,
    anchorEvent: event,
    anchorMs,
    importantEvent: event,
    classes: clipChipClasses(clip),
    labels: [],
    startMs: clip.startMs,
    endMs: clip.endMs,
    topPx: slot.topPx,
    heightPx: slot.heightPx,
  }
}

/**
 * Lay the derived clips out on the compressed axis.
 *
 * A cluster-backed slot re-uses its cluster WHOLE — same events, same carousel,
 * same representative, same classes — and replaces only the geometry. That
 * spread is the guarantee: there is no second place where a clips-mode card's
 * content is decided, so it cannot drift from the normal timeline's.
 *
 * A slot whose clip is not in `derived` is skipped rather than synthesised.
 *
 * Three kinds of card, and the cluster-less two are told apart by the clip's
 * SOURCE, never by what the entry happens to be missing: a footage-only visit
 * is ours and has a recorded still, a native clip is the camera's and has only
 * the provider's mint. Branching on "no `stillAtMs`" would have given every
 * native card the recorder's frame route for an instant we never recorded.
 */
export function positionDerivedClips(
  axis: ClipAxis,
  derived: readonly DerivedClip[],
): readonly PositionedCluster[] {
  if (derived.length === 0) return []
  const byId = new Map<string, DerivedClip>(derived.map((d) => [d.clip.clipId, d]))
  const cards: PositionedCluster[] = []
  for (const slot of axis.slots) {
    if (slot.kind !== 'clip') continue
    const entry = byId.get(slot.clip.clipId)
    if (entry === undefined) continue
    cards.push(
      entry.cluster !== null
        ? { ...entry.cluster, topPx: slot.topPx, heightPx: slot.heightPx }
        : isNativeClip(entry.clip)
          ? nativeClipCard(entry, slot)
          : footageOnlyCard(entry, slot),
    )
  }
  return cards
}
