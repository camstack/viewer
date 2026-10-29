/** Pure clustering helpers for the theater timeline's event overlay.
 *
 * All functions are stateless and return new arrays/objects (immutable). No
 * React, no side-effects, no `any`. Import geometry from timeline-geometry.ts.
 */

import { epochToOffset } from './timeline-geometry.js'
import type { PixelRect, ZoneRect } from './zone-filter.js'

// ─── Types ────────────────────────────────────────────────────────────

export interface ObjectEvent {
  readonly id: string
  /** Owning camera — the authorization subject of every media fetch for this
   *  event. */
  readonly deviceId: number
  readonly timestamp: number
  readonly className: string
  readonly label?: string
  /** Tier-2 INSTANCE label — a recognised face identity, a read plate, a species.
   *  A proper noun, shown verbatim (see `trackTitle`). Absent on legacy rows. */
  readonly subLabel?: string
  readonly confidence?: number
  readonly mediaUrl?: string
  /**
   * An OFFER of a still, not a still — a route that MINTS one from the camera's
   * own file on demand.
   *
   * Deliberately NOT {@link ObjectEvent.mediaUrl}: that one is handed straight
   * to `<Image src>`, and this route answers **204** when it will not produce a
   * still now. An `<Image>` cannot read a 204's headers — it fires `onerror`
   * with nothing to say — so a queued still became an anonymous broken tile.
   * A mint is asked for with `fetch`, and the `x-camstack-disposition` header
   * says whether the tile comes back (D563, D573).
   */
  readonly thumbnailMintUrl?: string
  /**
   * A still the provider ALREADY holds, at an address that answers with the
   * JPEG or with nothing — no queue, no 204.
   *
   * Deliberately NOT {@link ObjectEvent.mediaUrl}: that one is handed to
   * `<Image src>`, and this address needs the session's `Authorization`
   * header like the mint does, so it is fetched through `useClipStill` too.
   * `clipStillSource` prefers it over the mint (D580) — a still that exists
   * beats one that has to be cut.
   *
   * It was missing from this type until 2026-09-21, and that is the whole
   * reason a Reolink onboard clip had no thumbnail: those rows carry a served
   * still and NO mint, so the card reached `clipStillSource` with nothing on
   * it and not one still was ever requested.
   */
  readonly thumbnailUrl?: string
  /**
   * A DIFFERENT id to fetch media by when {@link ObjectEvent.mediaUrl} dies.
   *
   * Clip visit cards carry a `mediaUrl` the hub stamped without vouching for
   * it (35% of them 404 on a measured camera), and their own `id` is a clip id
   * that the data plane cannot answer — so an `<Image onError>` had nothing
   * left to try and the card fell to the class glyph. This is the visit's first
   * analytics event id, which the data plane does answer.
   */
  readonly mediaFallbackId?: string
  /** Track id (object across frames) — kept in the slim projection. */
  readonly trackId?: string
  /** Scene/parent frame id — kept in the slim projection. */
  readonly frameId?: string
  /** Key-event importance in [0,1] (present on track-shaped items). */
  readonly importance?: number
  /** Distinct audio-classification labels heard during the track's life —
   *  audio enrichment for the motion/audio activity filter. */
  readonly audioLabels?: readonly string[]
  /** Position bboxes in PIXELS of the detection-frame space (track-shaped
   *  items) — the client-side zone filter's geometry. */
  readonly positionBoxes?: readonly PixelRect[]
  /** The track's trajectory bounds NORMALISED 0..1 by the server against the
   *  real detection frame. Travels WITH `positionBoxes`: the pair is what lets
   *  the zone filter pin the frame size exactly instead of estimating it. */
  readonly normalizedEnvelope?: ZoneRect
  /** Track end (lastSeen) for track-shaped items — powers the fragment
   *  dedupe (sequential same-class ranges = one subject split by the
   *  tracker). Absent → treated as a point event at `timestamp`. */
  readonly endTimestamp?: number
}

export interface PositionedCluster {
  readonly id: string
  readonly events: readonly ObjectEvent[]
  /** One item per DISTINCT subject: `events` minus tracker fragments (see
   *  {@link dedupeFragmentItems}) — what the card carousel pages over, so a
   *  subject split into several track rows shows ONE image, not N. */
  readonly carouselEvents: readonly ObjectEvent[]
  readonly representative: ObjectEvent
  /** The first carousel item shown by the card. Its timestamp is the card's
   *  temporal anchor, so the image, label, seek target, and timeline position
   *  all describe the same moment. */
  readonly anchorEvent: ObjectEvent
  readonly anchorMs: number
  /** The cluster's most IMPORTANT subject — highest server-computed
   *  `importance` among `carouselEvents`, tie broken by the later-ending track,
   *  falling back to `representative` when nothing is scored (see
   *  {@link pickImportantEvent}). Semantic importance never changes temporal
   *  placement, which is owned by `anchorEvent`. */
  readonly importantEvent: ObjectEvent
  readonly classes: readonly string[]
  readonly labels: readonly string[]
  readonly startMs: number
  readonly endMs: number
  readonly topPx: number
  readonly heightPx: number
}

// ─── Constants ────────────────────────────────────────────────────────

const DEFAULT_PRIORITY: readonly string[] = ['label', 'person', 'vehicle', 'animal']

/**
 * Synonym map: abstract priority token → concrete className values.
 * 'label' and exact classNames are handled directly in pickRepresentative.
 */
const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  vehicle: ['car', 'truck', 'bus', 'motorcycle'],
  animal: ['dog', 'cat', 'bird'],
}

// ─── Internal helpers ─────────────────────────────────────────────────

/** Resolve a priority token to the set of classNames it matches. */
function resolveToken(token: string): readonly string[] {
  if (token === 'label') return [] // handled separately
  if (SYNONYMS[token] !== undefined) return SYNONYMS[token]
  return [token]
}

/** True when the event matches the given priority token. */
function eventMatchesToken(event: ObjectEvent, token: string): boolean {
  if (token === 'label') {
    return typeof event.label === 'string' && event.label.length > 0
  }
  const classNames = resolveToken(token)
  return classNames.includes(event.className)
}

// ─── Fragment dedupe ──────────────────────────────────────────────────

/** Max gap between one fragment's end and the next one's start to still be
 *  the SAME subject re-acquired by the tracker (resurrection misses etc.). */
const FRAGMENT_GAP_MS = 45_000
/** Small overlap tolerance: fragments can briefly coexist during a tracker
 *  hand-off. CONCURRENT tracks (two people walking together) overlap for
 *  most of their life and must never be merged. */
const FRAGMENT_OVERLAP_TOLERANCE_MS = 2_000

interface FragmentGroup {
  best: ObjectEvent
  endMs: number
}

function rangeOf(e: ObjectEvent): { start: number; end: number } {
  return { start: e.timestamp, end: e.endTimestamp ?? e.timestamp }
}

/** True when `b` (starting after `a` ends, within tolerance/gap) looks like a
 *  tracker FRAGMENT of the same subject rather than a distinct concurrent one. */
function isSequentialFragment(aEndMs: number, b: ObjectEvent): boolean {
  const { start } = rangeOf(b)
  return start >= aEndMs - FRAGMENT_OVERLAP_TOLERANCE_MS && start <= aEndMs + FRAGMENT_GAP_MS
}

/** Prefer the higher-importance item; tie → the longer/later one. */
function betterFragment(a: ObjectEvent, b: ObjectEvent): ObjectEvent {
  const ia = a.importance ?? 0
  const ib = b.importance ?? 0
  if (ib > ia) return b
  if (ia > ib) return a
  return rangeOf(b).end >= rangeOf(a).end ? b : a
}

/**
 * Collapse tracker FRAGMENTS to one item per subject: same-class items whose
 * time ranges are SEQUENTIAL (end→start gap ≤ 45 s, overlap ≤ 2 s) chain into
 * one group and only the best item (importance, then recency) survives.
 * Genuinely concurrent same-class tracks (two people crossing together)
 * overlap for most of their span and are never merged. Items keep the input's
 * newest→oldest relative order via re-sort on the survivors.
 */
export function dedupeFragmentItems(events: readonly ObjectEvent[]): readonly ObjectEvent[] {
  if (events.length <= 1) return [...events]

  // TRACK FIRST. A track IS the subject; its events are that subject's moments,
  // so six events of one person are one tile, not six. The chaining below only
  // ever INFERRED this from class plus a time gap, which is a guess the data
  // already answers whenever `trackId` is present.
  //
  // This is why it matters beyond correctness: the carousel renders one
  // `EventThumb` per item into a React Native ScrollView, which mounts every
  // child — it does not virtualise — and each thumb starts its own image fetch.
  // The cost was `visible cards × EVENTS per cluster`, in images, at once.
  // Collapsing to tracks cuts the multiplier at the source.
  //
  // Events WITHOUT a trackId keep the heuristic: audio events and some
  // synthesised items have no track, and dropping them would be a regression.
  const byTrack = new Map<string, ObjectEvent>()
  const untracked: ObjectEvent[] = []
  for (const e of events) {
    const id = e.trackId
    if (id === undefined || id.length === 0) {
      untracked.push(e)
      continue
    }
    const held = byTrack.get(id)
    byTrack.set(id, held === undefined ? e : betterFragment(held, e))
  }
  if (byTrack.size > 0) {
    const survivors = new Set<ObjectEvent>(byTrack.values())
    for (const e of chainUntrackedFragments(untracked)) survivors.add(e)
    // Preserve the cluster's newest→oldest presentation order.
    return events.filter((e) => survivors.has(e))
  }
  return chainUntrackedFragments(events)
}

/**
 * The pre-track heuristic, kept for events that carry no `trackId`: same-class
 * items whose ranges are sequential chain into one, and the best of each chain
 * survives.
 */
function chainUntrackedFragments(events: readonly ObjectEvent[]): readonly ObjectEvent[] {
  if (events.length <= 1) return [...events]
  // Chain chronologically per class.
  const byClass = new Map<string, FragmentGroup[]>()
  const chronological = [...events].sort((a, b) => a.timestamp - b.timestamp)
  for (const e of chronological) {
    const groups = byClass.get(e.className) ?? []
    // Attach to the group whose END this item most plausibly continues —
    // among all sequential candidates pick the latest-ending one, so a
    // concurrent track's group (still far from its end) never captures a
    // fragment that actually continues a different, just-ended track.
    let target: FragmentGroup | undefined
    for (const g of groups) {
      if (isSequentialFragment(g.endMs, e) && (target === undefined || g.endMs > target.endMs)) {
        target = g
      }
    }
    if (target !== undefined) {
      target.best = betterFragment(target.best, e)
      target.endMs = Math.max(target.endMs, rangeOf(e).end)
    } else {
      groups.push({ best: e, endMs: rangeOf(e).end })
    }
    byClass.set(e.className, groups)
  }
  const survivors = new Set<ObjectEvent>()
  for (const groups of byClass.values()) {
    for (const g of groups) survivors.add(g.best)
  }
  // Preserve the cluster's newest→oldest presentation order.
  return events.filter((e) => survivors.has(e))
}

// ─── Exported functions ───────────────────────────────────────────────

/**
 * Pick the most "important" representative from a list of events according to
 * a priority list.
 *
 * Priority evaluation order (first match wins):
 *  - `'label'` → any event with a non-empty `label` string
 *  - `'person'` → className === 'person'
 *  - `'vehicle'` → className in {car, truck, bus, motorcycle}
 *  - `'animal'` → className in {dog, cat, bird}
 *  - Fallback: newest event (highest timestamp)
 *
 * A custom `priority` list replaces the default. The same synonym and label
 * semantics apply.
 */
export function pickRepresentative(
  events: readonly ObjectEvent[],
  priority: readonly string[] = DEFAULT_PRIORITY,
): ObjectEvent {
  for (const token of priority) {
    const match = events.find((e) => eventMatchesToken(e, token))
    if (match !== undefined) return match
  }
  // Fallback: newest
  return events.reduce((best, e) => (e.timestamp > best.timestamp ? e : best), events[0])
}

/**
 * The cluster's most IMPORTANT subject — the chip the expanded card
 * highlights.
 *
 * Ranking reuses the notions this file already has, it does not invent a new
 * one: the server-computed `importance` in [0,1] decides (the same score the
 * minimum-importance filter and `betterFragment` read); a tie goes to the
 * later-ending subject (the `betterFragment` convention); and when NO subject
 * carries a score at all the class-priority `representative` stands in — the
 * pre-importance definition of "the item that matters".
 */
export function pickImportantEvent(
  subjects: readonly ObjectEvent[],
  representative: ObjectEvent,
): ObjectEvent {
  let best: ObjectEvent | null = null
  let bestScore = 0
  for (const e of subjects) {
    const score = e.importance
    if (typeof score !== 'number') continue
    if (best === null || score > bestScore) {
      best = e
      bestScore = score
      continue
    }
    if (score === bestScore && rangeOf(e).end > rangeOf(best).end) best = e
  }
  return best ?? representative
}

/**
 * The distinct cameras that contributed events to a cluster, in the cluster's
 * own newest → oldest order.
 *
 * ## Why this is DERIVED and not a field
 *
 * Clustering groups by TIME and by nothing else — `clusterByZoom` never reads
 * `deviceId`. With a multi-camera scope (the whole view on camera-detail, the
 * whole wall on the grid page) one card therefore routinely holds subjects from
 * several cameras, and the card said nothing about it: the operator could not
 * tell one busy camera from three cameras that all saw something at once.
 *
 * The answer was already in the data — every {@link ObjectEvent} carries the
 * camera that owns it, because that id is the authorization subject of its
 * media fetch. So nothing has to be brought from the wire, and a second copy
 * stored on the cluster is a copy that can DISAGREE with the events it counts.
 * A fixture that seeds both would then prove nothing, which is the exact way
 * this repo has had a green test over a live defect before.
 *
 * Counted over `events`, not `carouselEvents`: the question is which cameras
 * had events in this group, and the carousel is the deduped SUBJECT list —
 * `chainUntrackedFragments` chains on class and time alone, so a camera whose
 * only untracked event was folded into another camera's chain would vanish from
 * a count taken there.
 */
export function clusterDeviceIds(cluster: PositionedCluster): readonly number[] {
  return [...new Set(cluster.events.map((e) => e.deviceId))]
}

// ─── clusterByZoom ────────────────────────────────────────────────────

export interface ClusterByZoomInput {
  readonly topMs: number
  readonly zoomIndex: number
  readonly sizePx: number
  readonly gapPx: number
}

/**
 * Group events into non-overlapping positioned clusters in pixel space.
 *
 * ## The card's TOP edge sits on its NEWEST displayed event and it extends DOWN
 *
 * Time runs DOWNWARD (larger px = older). A cluster absorbs events OLDER than
 * the one that opened it, so those members lie BELOW the anchor. A card hung
 * upward from its anchor (bottom edge on the event) left every older member
 * outside its own rectangle — inside the NEXT card's — so a tap on a member
 * landed the cursor in a neighbour ("it took me to the next cluster"). With
 * the top on the anchor the card covers exactly the window it absorbed, and
 * every member's time is inside its own band.
 *
 * Algorithm (greedy, O(n log n) for the sort):
 *  1. Sort events newest → oldest (descending timestamp); pixel offsets ascend.
 *  2. Open a cluster at an event's offset — its `anchorPx`, and its first event.
 *  3. Absorb older events while `px - anchorPx < sizePx + gapPx` — `sizePx` is
 *     the card height, i.e. the time span the card covers at this zoom, and the
 *     gap below it belongs to the card too (see below). There is NO member cap.
 *  4. Otherwise close the cluster and open a new one.
 *  5. Position from the first carousel event; a card whose neighbour would
 *     overlap it (dedupe moved its anchor) is merged when the union still fits
 *     one card, else the OLDER card is pushed down. A card is never moved above
 *     its own newest event.
 *
 * ## Why neither a member cap nor a short window (the 2026-10-29 report)
 *
 * Cards were drawn up to ~10 minutes (and on a busy camera over 30) away from
 * their events. A card cannot overlap its neighbour, so every card the layout
 * had to push down moved ALL the cards after it, and the displacement
 * compounded down the list. Two rules manufactured pushes on every busy camera:
 *  - a cap of six subjects per card split one busy minute across several cards,
 *    each pushed a whole card below the last (a 16th card sat 32 minutes below
 *    its event);
 *  - a card absorbed only events inside `sizePx`, so the next card's raw anchor
 *    was always `gapPx` short of clear of it and was pushed by the gap, again
 *    and again.
 * Absorbing through the gap makes the cut itself leave the room, so the greedy
 * pass never needs to push; only a dedupe-shifted anchor can. A card holding
 * many subjects pages them in a virtualised strip (`ClusterCard`), so the number
 * of members costs nothing until they are scrolled to.
 *
 * Guarantees:
 *  - `topPx === epochToOffset(anchorMs)` unless the card was pushed down.
 *  - No two clusters overlap (`prev.topPx + prev.heightPx + gapPx <= curr.topPx`).
 *  - `topPx >= 0`: a card never starts above the live line, by construction.
 *  - `heightPx === sizePx` for every cluster.
 *  - `id === representative.id`.
 *  - `importantEvent` is the most important subject ({@link pickImportantEvent}); it
 *    never moves `topPx` — position comes from `anchorEvent` alone.
 *  - `events` stay newest → oldest inside a cluster and clusters are returned
 *    newest → oldest.
 *  - `classes` / `labels` are deduplicated, stable-ordered arrays.
 *
 * @param priority - forwarded to `pickRepresentative`; default priority used if omitted.
 */
export function clusterByZoom(
  events: readonly ObjectEvent[],
  { topMs, zoomIndex, sizePx, gapPx }: ClusterByZoomInput,
  priority?: readonly string[],
): PositionedCluster[] {
  if (events.length === 0) return []

  // Match the carousel: the event opening a cluster is page zero.
  const sorted = [...events].sort((a, b) => b.timestamp - a.timestamp)

  const result: PositionedCluster[] = []
  let clusterEvents: ObjectEvent[] = []
  /** Offset of the raw event opening the greedy absorption group. */
  let anchorPx = 0

  function positionCluster(eventsToPosition: readonly ObjectEvent[]): PositionedCluster {
    const orderedEvents = [...eventsToPosition].sort((a, b) => b.timestamp - a.timestamp)
    const rep = pickRepresentative(orderedEvents, priority)
    const classes = [...new Set(orderedEvents.map((e) => e.className))]
    const labels = [
      ...new Set(
        orderedEvents
          .map((e) => e.label)
          .filter((l): l is string => typeof l === 'string' && l.length > 0),
      ),
    ]
    const timestamps = orderedEvents.map((e) => e.timestamp)
    const carouselEvents = dedupeFragmentItems(orderedEvents)
    const anchorEvent = carouselEvents[0] ?? orderedEvents[0]
    const anchorMs = anchorEvent.timestamp
    return {
      id: rep.id,
      events: orderedEvents,
      carouselEvents,
      representative: rep,
      anchorEvent,
      anchorMs,
      importantEvent: pickImportantEvent(carouselEvents, rep),
      classes,
      labels,
      startMs: Math.min(...timestamps),
      endMs: Math.max(...timestamps),
      // TOP edge on the newest displayed event; the card extends down over
      // the window it absorbed (see the function's docblock).
      topPx: epochToOffset(anchorMs, topMs, zoomIndex),
      heightPx: sizePx,
    }
  }

  function flushCluster(): void {
    if (clusterEvents.length === 0) return
    result.push(positionCluster(clusterEvents))
    clusterEvents = []
  }

  for (const event of sorted) {
    const px = epochToOffset(event.timestamp, topMs, zoomIndex)

    if (clusterEvents.length === 0) {
      // Open a cluster: this event is its first, so its offset is the anchor.
      anchorPx = px
      clusterEvents.push(event)
    } else if (
      px - anchorPx < sizePx + gapPx
    ) {
      // Older than the anchor by less than a card plus its gap → same cluster:
      // its time lies inside the card's own band, or in the gap just under it.
      clusterEvents.push(event)
    } else {
      flushCluster()
      anchorPx = px
      clusterEvents.push(event)
    }
  }

  flushCluster()

  // Dedupe can choose an older, higher-quality fragment as the first displayed
  // page, moving a card down onto its neighbour, and the greedy cut leaves no
  // room for the gap between two cards a card apart. Where a card would crowd
  // the previous one it is merged back when the union still fits one card, and
  // otherwise PUSHED DOWN — never up, so a card never leaves its newest event.
  const fitsOneCard = (c: PositionedCluster): boolean =>
    c.carouselEvents.every(
      (e) => epochToOffset(e.timestamp, topMs, zoomIndex) - c.topPx < sizePx + gapPx,
    )
  const coalesced: PositionedCluster[] = []
  for (const cluster of result) {
    let candidate = cluster
    let previous = coalesced.at(-1)
    while (
      previous !== undefined &&
      candidate.topPx - (previous.topPx + previous.heightPx) < gapPx
    ) {
      const merged = [...previous.events, ...candidate.events]
      const union = positionCluster(merged)
      if (!fitsOneCard(union)) {
        candidate = { ...candidate, topPx: previous.topPx + previous.heightPx + gapPx }
        break
      }
      coalesced.pop()
      candidate = union
      previous = coalesced.at(-1)
    }
    coalesced.push(candidate)
  }

  return coalesced
}
