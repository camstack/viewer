/**
 * clip-model — the vocabulary of the CLIP TIMELINE.
 *
 * ## What a clip is
 *
 * A clip is a bounded stretch of footage a camera can hand back as one playable
 * unit. Today the only real producer is the hub's own recorder: a clip is a
 * *cut-out* of the recording around something that happened. Tomorrow the same
 * shape must carry a clip the CAMERA recorded onboard, or one HomeKit Secure
 * Video kept — which is why nothing in this module knows how a clip is fetched.
 *
 * That is the whole reason `ClipSourceId` is an OPEN string and the playback
 * reference is a discriminated union rather than a URL: the surface must be
 * able to show two producers side by side, in one ordered ribbon, with the
 * operator choosing which of them count — and it must be able to gain a third
 * without every consumer learning about it.
 *
 * ## What is deliberately NOT here
 *
 * No React, no i18n, no theme lookup, no network. Every decision the clip
 * timeline makes about time and layout is a pure function over these types
 * (`clip-timeline.ts`), because the geometry is exactly the part that cannot be
 * asserted by mounting a component in the test environment — the lesson the
 * theater timeline already paid for once, when a transport pill overlapped the
 * activity strip through a full redesign without a single test noticing.
 */

/**
 * Identity of a clip-producing source.
 *
 * Open vocabulary on purpose: the viewer must not have to ship a release to
 * display a source the hub grew. An id it does not recognise still renders —
 * with a fallback descriptor — rather than vanishing.
 */
export type ClipSourceId = string

/**
 * The one source that exists today.
 *
 * The hub's default `videoclips` provider reports `source: 'analytics'`: an
 * analytics event, widened into a window, cut out of the recording. Naming it
 * after what the hub actually says — rather than the friendlier "recording" —
 * is deliberate; an id the viewer invented would stop matching the day a second
 * provider appeared.
 */
export const CLIP_SOURCE_ANALYTICS: ClipSourceId = 'analytics'

/** Prefix the hub reserves for a camera's own onboard catalog (`native:<vendor>`). */
export const CLIP_SOURCE_NATIVE_PREFIX = 'native:'

/** A HomeKit Secure Video clip. Produced by the HKSV tee since 2026-09-20. */
export const CLIP_SOURCE_HKSV: ClipSourceId = 'hksv'

/**
 * How a source presents itself on the ribbon: a stable colour for its segments
 * and a translation key for its chip.
 *
 * The colour is a literal rather than a theme key because the ribbon's segments
 * must stay distinguishable from each other in BOTH themes; these are picked
 * against the dark and light surfaces alike, exactly like `BAND` in the theme
 * tokens.
 */
export interface ClipSourceDescriptor {
  readonly id: ClipSourceId
  /** i18n key for the chip label. */
  readonly labelKey: string
  /** Segment colour on the ribbon. */
  readonly color: string
}

/**
 * How a clip is played.
 *
 * `recorded` is the hub's recorded read path. The embed player already speaks
 * it — the app seeks by EPOCH and the transport resolves which profile's
 * segments cover that moment — so a recording-derived clip needs no new player
 * and no profile of its own: it is a time range the transport already knows how
 * to reach. Carrying a profile here would be a constant the app never uses,
 * which is how a decorative field starts being trusted.
 *
 * `url` is a file whose address the LIST already carried. Nothing serves one
 * today; the arm stays because a provider that does needs no new one.
 *
 * `native` is the shape the first real file provider actually landed in
 * (`native:reolink:onboard`, 2026-09-20). Its row carries no url at all: the
 * bytes live behind `videoclips.getClipPlayback`, which mints a per-clip entry
 * in a bounded scratch on demand and answers `{playbackUrl, format:'mp4',
 * served}`. So the address cannot be resolved at LIST time — a listing that
 * minted one would evict its own first card off a 10-file LRU on the eleventh
 * — and the ref carries the identity to ask with instead of a URL it would
 * have had to invent.
 */
export type ClipPlaybackRef =
  | { readonly kind: 'recorded'; readonly deviceId: number }
  | { readonly kind: 'native'; readonly deviceId: number; readonly clipId: string }

/** What caused the clip to exist. Mirrors the hub's `videoclips` vocabulary. */
export type ClipKind = 'motion' | 'object' | 'audio' | 'native'

/** A stretch inside a visit with no footage — a GOP roll or a discarded
 *  segment, short enough that the provider kept the visit whole. */
export interface ClipHole {
  readonly startMs: number
  readonly endMs: number
}

/** One playable stretch of footage. Half-open in time: `[startMs, endMs)`. */
export interface Clip {
  /** Stable identity for React keys and for "which clip is playing". */
  readonly clipId: string
  readonly deviceId: number
  readonly startMs: number
  readonly endMs: number
  readonly sourceId: ClipSourceId
  readonly kind: ClipKind
  readonly playback: ClipPlaybackRef
  /**
   * Optional still for the segment / list row.
   *
   * NOT VOUCHED FOR. The default provider stamps this on every clip from the
   * main event's `mediaUrl` without checking that the media survived
   * retention — measured on device 3836, 62 of 177 clips and 61 of 95 motion
   * clips answered 404. Anything rendering it needs {@link Clip.eventIds} to
   * fall back to, or the card degrades to a class glyph on grey.
   */
  readonly thumbnailUrl?: string
  /**
   * The analytics events the hub attached to this visit, in the provider's
   * order (the `kind`-owning main event first).
   *
   * Absent on a footage-only visit — never an empty array, so "the provider
   * attached nothing" stays distinguishable from "this build did not read the
   * field". `eventIds[0]` is the id `pipelineAnalytics.getEventMedia` can still
   * answer when {@link Clip.thumbnailUrl} is dead.
   */
  readonly eventIds?: readonly string[]
  /**
   * Distinct object classes the hub aggregated for the visit (`person`,
   * `cat`, …), dominant first. Absent on motion/audio-only visits and on hubs
   * whose router predates the field — the ribbon then falls back to the kind.
   */
  readonly labels?: readonly string[]
  /**
   * Intra-visit footage holes the provider kept inside the visit.
   *
   * Carried rather than dropped because the ribbon's own gap rows describe
   * holes BETWEEN clips only: without this, a visit with a 40 s hole in the
   * middle claims continuous footage it does not have.
   */
  readonly holes?: readonly ClipHole[]
  /**
   * An OFFER of a still, not a still.
   *
   * A native provider holds no thumbnails; it mints one from the file on demand
   * behind this path. The route answers **204** when it will not produce one
   * now, and says in `x-camstack-disposition` whether that is `deferred` (you
   * are in the queue — 43 of 60 parallel first-paint tiles on 592) or `final`
   * (it will never happen). Kept apart from {@link Clip.thumbnailUrl} for
   * exactly that reason: a queued still and a dead one must not be one value
   * (D563).
   */
  readonly thumbnailMintUrl?: string
  /** The provider's own words for why this clip has no picture and never will.
   *  Rendered verbatim, never parsed. */
  readonly thumbnailUnavailable?: string
  /**
   * The copies of this clip the catalog resolved at LISTING time, so choosing a
   * quality never re-searches the camera (D549 15).
   *
   * `sub` is the cheap file (0.67 MB measured on 592); `main` is its twin at
   * ~30x (20.0 MB). A row with only `main` is shown at that cost rather than
   * hidden — a clip that is not rendered is the defect this line of work exists
   * to end.
   */
  readonly streams?: ClipStreams
  /** The camera says it keeps a sub-stream copy. */
  readonly supportSub?: boolean
  /** The camera's OWN vocabulary for what it saw (`md`, `dog_cat`). Kept
   *  verbatim and never mapped into ours — {@link Clip.labels} is the
   *  hub-resolved half, and the two are different claims. */
  readonly nativeTypes?: readonly string[]
  /** When the catalog this row came from was last read. A row is never fresher
   *  than this, and a surface showing clips must be able to say so. */
  readonly catalogAsOf?: number
  /** The provider REFUSING this clip. Absent means it said nothing, which is
   *  not a refusal — see {@link isPlayable}. */
  readonly playable?: boolean
  /** Why, in the provider's words. Only meaningful beside `playable: false`. */
  readonly unplayableReason?: string
  /**
   * The file is STILL BEING WRITTEN, so {@link Clip.endMs} is not its end.
   *
   * Absent — the common case, and every one of the 357 rows captured from 592
   * on 2026-09-20 — means the row is closed and `endMs` is the truth. Present
   * means the camera's index entry holds whatever it held when the file was
   * opened: measured on 592, a growing file reported the same `endTime` for
   * eight minutes.
   *
   * `endMs` is deliberately still a number — it is the best bound a mint window
   * has — but nothing may draw a DURATION from it, and
   * {@link resolveClipLoop} refuses to loop such a clip: repeating a file whose
   * end is a frozen guess restarts it at a boundary nobody knows, forever.
   */
  readonly inProgress?: boolean
}

/** One resolved copy of a clip's bytes. */
export interface ClipStream {
  /** The clip id that addresses THIS copy. */
  readonly id: string
  readonly bytes: number
}

/** The copies a clip row resolved. A row that resolved neither is stored with
 *  no `streams` at all, so "the catalog resolved nothing" and "this build did
 *  not read the field" stay ONE thing, which is what the surface can act on. */
export interface ClipStreams {
  readonly sub?: ClipStream
  readonly main?: ClipStream
}

/** The descriptors the viewer ships with. Unknown ids fall back (see below). */
export const CLIP_SOURCES: readonly ClipSourceDescriptor[] = [
  { id: CLIP_SOURCE_ANALYTICS, labelKey: 'v2.clips.sourceAnalytics', color: '#f59e42' },
  { id: CLIP_SOURCE_HKSV, labelKey: 'v2.clips.sourceHksv', color: '#4ade80' },
]

/** Colour for a source the viewer does not ship a descriptor for. Derived from
 *  the id so two unknown sources are still told apart on the ribbon. */
const UNKNOWN_SOURCE_COLORS: readonly string[] = ['#60a5fa', '#c084fc', '#f472b6', '#2dd4bf']

function unknownSourceColor(id: ClipSourceId): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return UNKNOWN_SOURCE_COLORS[hash % UNKNOWN_SOURCE_COLORS.length]
}

/**
 * Descriptor for a source id, synthesising one for an id we do not ship.
 *
 * A `native:<vendor>` id resolves to the onboard label with the vendor carried
 * as an interpolation value, so a camera whose own catalog the hub grows
 * tomorrow already renders a correct chip today — no viewer release required.
 * That is the whole point of the id being an open string.
 */
export function clipSourceDescriptor(id: ClipSourceId): ClipSourceDescriptor {
  const known = CLIP_SOURCES.find((s) => s.id === id)
  if (known !== undefined) return known
  if (id.startsWith(CLIP_SOURCE_NATIVE_PREFIX)) {
    return { id, labelKey: 'v2.clips.sourceOnboard', color: '#60a5fa' }
  }
  return { id, labelKey: 'v2.clips.sourceUnknown', color: unknownSourceColor(id) }
}

/** The vendor half of a `native:<vendor>` id, else null. Titles the chip. */
export function nativeSourceVendor(id: ClipSourceId): string | null {
  return id.startsWith(CLIP_SOURCE_NATIVE_PREFIX)
    ? id.slice(CLIP_SOURCE_NATIVE_PREFIX.length)
    : null
}

/**
 * A clip whose playback reference the current build can actually drive.
 *
 * `playable: false` beats everything: it is the PROVIDER saying the file cannot
 * be served (a recording still being written, a row whose file the camera has
 * since rolled). Absence of the field is NOT a refusal — not one onboard row
 * measured on 592 carries it — so absence must never empty the surface.
 */
export function isPlayable(clip: Clip): boolean {
  if (clip.playable === false) return false
  switch (clip.playback.kind) {
    case 'recorded':
      return true
    case 'native':
      return true
  }
}

/** Duration in ms. Never negative — an inverted clip reports 0. */
export function clipDurationMs(clip: Clip): number {
  return Math.max(0, clip.endMs - clip.startMs)
}
