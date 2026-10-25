/**
 * events-track-row — normalisation of a SLIM `listRecentTracks` row into the
 * shape the embed renders, plus the client-side filters.
 *
 * Deliberately NOT imported from the viewer: the embed is a hub-served bundle
 * with no dependency on the app repo, and the shapes it needs are the cap's
 * (`packages/types/.../pipeline-analytics.cap.ts`), not the app's. It is
 * validated defensively — a malformed row is SKIPPED, never rendered blank and
 * never thrown on, because one bad row must not empty a feed.
 *
 * Two label tiers, one display rule: what a human is shown is
 * `subLabel ?? label` — the finest thing known — falling back to the detection
 * class. A consumer that reads only `label` shows nothing on a species-only row.
 * That rule is {@link resolveRowTitle} and it lives HERE, once: the row no
 * longer carries a pre-baked `title`, because a baked title cannot be
 * translated (the dictionary arrives on the config, and can change under a
 * loaded feed when the host switches language) and because a second copy of the
 * rule in `events-semantic` had already drifted.
 */

import {
  AUDIO_MACRO,
  audioKindId,
  audioLabelFor,
  EMPTY_KIND_LABELS,
  kindLabelFor,
  macroOf,
} from './events-taxonomy'
import type { EventsAttribute } from './events-share-url'
import { foldSearchText, searchVariants } from './search-normalize'

/** Shared empty map — a caller with no taxonomy still filters on exact ids. */
const EMPTY_MACRO_MAP: ReadonlyMap<string, string> = new Map()

/** Local structural mirror of the fields the SLIM projection carries. */
export interface EventsTrackRow {
  readonly trackId: string
  readonly deviceId: number
  readonly cameraName: string
  readonly className: string
  /** Tier-1 label (sub-class), when present. */
  readonly label?: string
  /** Tier-2 label (instance: identity, plate text, species), when present. */
  readonly subLabel?: string
  readonly importance?: number
  readonly firstSeen: number
  readonly lastSeen: number
  readonly state: string
  readonly active: boolean
  readonly zonesVisited: readonly string[]
  /**
   * Human NAMES of {@link zonesVisited}, resolved server-side against the
   * `zones` cap.
   *
   * `zonesVisited` holds zone IDS (`cfeec78c-8d69-…`) — measured live, every
   * zone a track carries is a UUID — so it is unusable as a search token and
   * unusable as a caption. Absent on a hub that predates the field, and SHORTER
   * than `zonesVisited` when a zone has since been deleted: a name that no
   * longer exists is dropped rather than invented.
   */
  readonly zoneNames: readonly string[]
  /** Distinct detector classes observed over the track's life. */
  readonly classes: readonly string[]
  /** Distinct audio-classification labels heard during the track. */
  readonly audioLabels: readonly string[]
  /** The id the event-media plane resolves the crop against. */
  readonly bestEventId: string
  /** SYNTHETIC (sensor-linked) track: the NAME of the device that produced it. */
  readonly producingDeviceName?: string
  /**
   * How the hub produced the track (`Track.source`): `pipeline` (the spatial
   * detector — also what an older hub that omits the field means), `sensor`, or
   * `audio`.
   *
   * Kept as a free string on purpose: the embed asks ONE question of it
   * ({@link isAudioSourceRow}) and a value it has never heard of must degrade
   * to "a normal track", not narrow the feed.
   */
  readonly source?: string
  /**
   * This track has an ASSIGNABLE face: one an operator could open and attach to
   * an identity, because a crop plus an embedding was persisted to the face
   * gallery.
   *
   * NOT `Track.hasFace`. That flag is stamped at the very top of the face
   * branch, before every gate — recognition disabled, `minFacePx`, no
   * embedding, no crop captured, crop-store failure — and it was what this chip
   * first shipped with. Measured on the live hub on 2026-08-20 over seven days
   * and six cameras: 1160 tracks, **399** with `hasFace === true`, but only
   * **100** with a gallery row. Four out of five rows the chip returned were
   * faces nobody could do anything with, which is exactly what the operator
   * reported.
   *
   * Two sources, unioned, and the union is monotone — nothing that matches
   * today stops matching later:
   *
   *  • `Track.hasEmbeddedFace` — the authority, set only after the gallery
   *    insert succeeds. It is written by a hub that has the change deployed, so
   *    it is ABSENT on every track stored before that and this is why the
   *    second source exists.
   *  • a tier-2 label attributed to the face chain ({@link FACE_LABEL_STEP_IDS})
   *    — a RECOGNISED face. Assignable by construction: a track cannot carry a
   *    recognised identity without a gallery row behind it. It covers 84 of the
   *    100 assignable tracks above at 100% precision, which is the honest
   *    interim for history: a chip that says "only assignable" must not answer
   *    with rows that are not.
   *
   * **Absent ≠ false** on both inputs — the only legal test is `=== true`.
   */
  readonly hasAssignableFace?: boolean
  /**
   * The {@link hasAssignableFace} subset that is still WAITING for a name: a
   * face was persisted to the gallery (`Track.hasEmbeddedFace`) and no identity
   * has been attached — neither recognition nor an operator assignment stamped
   * a face-chain tier-2 label. This is the card's "?" badge predicate: a
   * recognised face already renders its name pill, so the badge exists exactly
   * for the rows where the pill has nothing to say.
   *
   * Derived from the same two server inputs the union above reads — no third
   * signal, and monotone DOWNWARD on purpose: assigning a name is the only
   * thing that clears it. **Absent ≠ false** — the only legal test is
   * `=== true`.
   */
  readonly hasUnassignedFace?: boolean
  /**
   * A licence plate was READ on this track: the tier-2 attribution names a step
   * in {@link PLATE_LABEL_STEP_IDS}. Same `=== true` rule as
   * {@link hasAssignableFace}.
   */
  readonly hasPlate?: boolean
  /** Operator flags. Emitted only when TRUE — absent ≠ false, same as the cap. */
  readonly debug?: boolean
  readonly markForTrain?: boolean
  readonly favourited?: boolean
  /**
   * Retrain lifecycle. `trained` is the badge that `markForTrain` cannot show
   * (a completed track reports markForTrain false).
   */
  readonly retrainStatus?: 'none' | 'staging' | 'trained'
  /** Stamped by the host after fetch — this client already analyzed the track. */
  readonly reviewed?: boolean
}

/** Which operator-flag chips are on. All-off = no narrowing. Several-on = OR. */
export interface EventsFlagFilters {
  readonly debug?: boolean
  readonly train?: boolean
  readonly favourited?: boolean
  /** Local analyzed-debug ids. The debug chip must not match these. */
  readonly reviewedTrackIds?: readonly string[]
}

/**
 * Pipeline steps whose tier-2 label IS a licence plate.
 *
 * Mirrored from `PLATE_LABEL_STEP_IDS` in the addon's `pipeline/label-tier.ts`
 * — NOT imported: the embed is a browser bundle and cannot reach the addon's
 * server tree.
 *
 * **`plate-detection` is the one that fires**, and shipping this mirror without
 * it is why the operator saw an empty Plates chip. The writer attributes a
 * label to `detail.stepId`, and a plate's text rides the detail-subtree ROOT
 * (`plate-detection`, with the OCR model on `modelId`), not its `plate-ocr`
 * leaf. Measured against the live hub on 2026-08-20, seven days over six
 * cameras: every one of the 8 plate attributions is `plate-detection` and not
 * one is `plate-ocr`. The server's own copy of this set had the same hole, so
 * `labelKindOf` was answering `undefined` for every plate the fleet has read —
 * fixed in the same change.
 *
 * A step id this set has never heard of degrades to "not a plate", which
 * narrows the chip and can never empty the unfiltered feed.
 */
export const PLATE_LABEL_STEP_IDS: ReadonlySet<string> = new Set([
  'plate-detection',
  'plate-ocr',
  'operator:plate-gallery',
])

/**
 * Pipeline steps whose tier-2 label is a recognised FACE identity. Mirror of
 * `FACE_LABEL_STEP_IDS` in the same server module, and the interim half of
 * {@link EventsTrackRow.hasAssignableFace} — see there for why.
 */
export const FACE_LABEL_STEP_IDS: ReadonlySet<string> = new Set([
  'face-recognizer',
  'face-embedding',
  'operator:face-gallery',
])

const EMPTY_ATTRIBUTES: readonly EventsAttribute[] = []
const EMPTY_EXCLUDED_SOURCES: readonly string[] = []

/** True when a tier-2 attribution names a step in `steps`. */
function isAttributedTo(meta: unknown, steps: ReadonlySet<string>): boolean {
  if (!isRecord(meta)) return false
  const stepId = meta.stepId
  return typeof stepId === 'string' && steps.has(stepId)
}

/**
 * An AUDIO-EPISODE track: the hub materialised it from an audio classification,
 * so its `className` is a BARE audio macro (`speech`, `animal`) rather than a
 * detection class — the two vocabularies overlap and mean different things.
 *
 * `source` is the only honest discriminator. Guessing from the labels does not
 * work: a person track that happened to hear speech carries the same
 * `audioLabels`, and `animal` / `water` / `siren` are legitimately both.
 */
export function isAudioSourceRow(row: EventsTrackRow): boolean {
  return row.source === 'audio'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) if (typeof x === 'string' && x.length > 0 && !out.includes(x)) out.push(x)
  return out
}

/** Distinct label strings from the `audioLabels` aggregate array. */
function audioLabelStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const entry of v) {
    const label = isRecord(entry) ? nonEmptyString(entry.label) : undefined
    if (label !== undefined && !out.includes(label)) out.push(label)
  }
  return out
}

/**
 * Validate + normalise ONE raw track row. Returns null for a malformed row.
 *
 * `cameraName` is resolved from the caller's device map: the merged response
 * cannot carry a per-row camera name the way a per-camera fan-out could. A row
 * for a device the caller does not know still renders — with the numeric id —
 * rather than being dropped, because a device list that arrived late must not
 * empty the feed.
 */
export function toEventsTrackRow(
  raw: unknown,
  nameById: ReadonlyMap<number, string>,
): EventsTrackRow | null {
  if (!isRecord(raw)) return null
  const trackId = nonEmptyString(raw.trackId)
  const className = nonEmptyString(raw.className)
  if (trackId === undefined || className === undefined) return null
  if (typeof raw.deviceId !== 'number') return null
  if (typeof raw.firstSeen !== 'number' || typeof raw.lastSeen !== 'number') return null

  const label = nonEmptyString(raw.label)
  const subLabel = nonEmptyString(raw.subLabel)
  const producingDeviceName = nonEmptyString(raw.producingDeviceName)
  const source = nonEmptyString(raw.source)
  const classes = stringArray(raw.classes)

  return {
    trackId,
    deviceId: raw.deviceId,
    cameraName: nameById.get(raw.deviceId) ?? `Camera ${raw.deviceId}`,
    className,
    ...(label !== undefined ? { label } : {}),
    ...(subLabel !== undefined ? { subLabel } : {}),
    ...(typeof raw.importance === 'number' ? { importance: raw.importance } : {}),
    firstSeen: raw.firstSeen,
    lastSeen: raw.lastSeen,
    state: typeof raw.state === 'string' ? raw.state : 'idle',
    active: raw.active === true,
    zonesVisited: stringArray(raw.zonesVisited),
    zoneNames: stringArray(raw.zoneNames),
    classes: classes.includes(className) ? classes : [className, ...classes],
    audioLabels: audioLabelStrings(raw.audioLabels),
    bestEventId: nonEmptyString(raw.bestEventId) ?? trackId,
    ...(producingDeviceName !== undefined ? { producingDeviceName } : {}),
    ...(source !== undefined ? { source } : {}),
    // Emitted only when TRUE — see the field docs: absence is "unknown", and
    // writing `false` here would turn every pre-column row into a denial.
    //
    // `hasFace` is deliberately NOT read: it is four times broader than
    // "assignable" on this fleet. See `hasAssignableFace`.
    ...(raw.hasEmbeddedFace === true ||
    isAttributedTo(raw.subLabelMeta, FACE_LABEL_STEP_IDS)
      ? { hasAssignableFace: true }
      : {}),
    // Assignable AND still nameless — the "?" badge. Only the gallery mark can
    // raise it (the attribution source of the union IS a name), and only a
    // face-chain attribution clears it: a species or plate label beside an
    // embedded face leaves the face itself unnamed.
    ...(raw.hasEmbeddedFace === true &&
    !isAttributedTo(raw.subLabelMeta, FACE_LABEL_STEP_IDS)
      ? { hasUnassignedFace: true }
      : {}),
    ...(isAttributedTo(raw.subLabelMeta, PLATE_LABEL_STEP_IDS) ? { hasPlate: true } : {}),
    ...(raw.debug === true ? { debug: true } : {}),
    ...(raw.markForTrain === true ? { markForTrain: true } : {}),
    ...(raw.favourited === true ? { favourited: true } : {}),
    ...(raw.retrainStatus === 'none' ||
    raw.retrainStatus === 'staging' ||
    raw.retrainStatus === 'trained'
      ? { retrainStatus: raw.retrainStatus }
      : {}),
  }
}

/** Normalise a whole page, skipping malformed rows. */
export function toEventsTrackRows(
  rows: unknown,
  nameById: ReadonlyMap<number, string>,
): EventsTrackRow[] {
  if (!Array.isArray(rows)) return []
  const out: EventsTrackRow[] = []
  for (const raw of rows) {
    const row = toEventsTrackRow(raw, nameById)
    if (row !== null) out.push(row)
  }
  return out
}

/**
 * Every taxonomy id this track can legitimately be matched by.
 *
 * A detection class contributes BOTH itself and its macro, so selecting the
 * macro `vehicle` matches a track stored as `truck`, and selecting the sub
 * `truck` still matches a track stored as `truck`. Audio labels contribute
 * their namespaced id plus the bare `audio` macro, which is what a picker
 * emits for the whole group.
 *
 * The expansion is one-way, UPWARD, on purpose. Adding a macro's siblings
 * would make `truck` match a track known only to be a `bus` — that is not a
 * broader search, it is a wrong one.
 */
export function rowKindIdentities(
  row: EventsTrackRow,
  toMacro: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const out = new Set<string>()
  for (const c of [row.className, ...row.classes]) {
    if (c.length === 0) continue
    out.add(c)
    out.add(macroOf(c, toMacro))
  }
  if (row.audioLabels.length > 0) {
    out.add(AUDIO_MACRO)
    for (const label of row.audioLabels) out.add(audioKindId(label))
  }
  return out
}

/**
 * Class filter. An EMPTY selection matches everything.
 *
 * Matches against every vocabulary a track answers in — its class family, the
 * classes accumulated over its life, and its audio labels — because those
 * vocabularies are disjoint: measured on the live hub, 508 of 1000 tracks carry
 * audio and NONE has an audio `className`, so a `className`-only compare made
 * an audio selection match nothing at all, and every SUB kind was dead too.
 *
 * An EMPTY `toMacro` degrades this to the exact-id compare — which is what a
 * hub too old for `listEventKindsBatch` gets. Narrower, never empty.
 */
export function rowMatchesClasses(
  row: EventsTrackRow,
  selected: ReadonlySet<string>,
  toMacro: ReadonlyMap<string, string> = EMPTY_MACRO_MAP,
): boolean {
  if (selected.size === 0) return true
  const identities = rowKindIdentities(row, toMacro)
  for (const s of selected) if (identities.has(s)) return true
  return false
}

/**
 * Every token a free-text query may match this row by, folded for comparison.
 *
 * Aligned with the viewer's `trackSearchTokens`. The set is EVERY textual field
 * a track actually carries:
 *
 *  - the detection classes AND their taxonomy macros;
 *  - BOTH label tiers. Tier 2 matters most — after the tiered-label change the
 *    identities (a face name, a plate read, a species) live there, so a box
 *    captioned "label / identity / plate" that reads only tier 1 matches
 *    nothing when you type a person's name;
 *  - the audio labels, bare and namespaced — `crying`, `glass_breaking`;
 *  - the ZONE NAMES (`Uscio`, `Aiuola`), never the zone ids they are resolved
 *    from;
 *  - the camera name and, on a synthetic track, the producing device.
 *
 * Every value contributes both its raw and its folded form (see
 * `search-normalize`), so `glass_breaking` answers to `glass breaking`.
 *
 * DELIBERATELY EXCLUDED, because each would match a large arbitrary slice of
 * the feed rather than narrow it: `trackId` / `bestEventId` (opaque ids),
 * `zonesVisited` (zone ids), `state` (`new`/`idle`/`moving` — a status, and
 * `new` alone would match thousands), `importanceReason` and `retrainStatus`
 * (internal diagnostics with no operator-facing vocabulary).
 *
 * An enrichment label expands through the taxonomy ONLY when the taxonomy
 * actually knows it: `macroOf` returns an unknown id unchanged, which would
 * re-add the label under the guise of expanding it and make the loop look like
 * it was doing work it was not.
 */
export function rowSearchTokens(
  row: EventsTrackRow,
  toMacro: ReadonlyMap<string, string> = EMPTY_MACRO_MAP,
): ReadonlySet<string> {
  const out = new Set<string>()
  const add = (value: string | undefined): void => {
    for (const variant of searchVariants(value)) out.add(variant)
  }
  for (const c of [row.className, ...row.classes]) {
    add(c)
    if (c.length > 0) add(macroOf(c, toMacro))
  }
  add(row.label)
  add(row.subLabel)
  add(row.cameraName)
  add(row.producingDeviceName)
  for (const audio of row.audioLabels) {
    add(audio)
    add(audioKindId(audio))
  }
  for (const zone of row.zoneNames) add(zone)
  for (const fine of [row.label, row.subLabel]) {
    if (fine === undefined) continue
    const macro = toMacro.get(fine.trim().toLowerCase())
    if (macro !== undefined) add(macro)
  }
  return out
}

/** Free-text contains (case-insensitive, separator-folded) over
 *  {@link rowSearchTokens}. An empty needle matches everything — the "no
 *  filter" convention. */
export function rowMatchesSearch(
  row: EventsTrackRow,
  needle: string,
  toMacro: ReadonlyMap<string, string> = EMPTY_MACRO_MAP,
): boolean {
  const raw = needle.trim().toLowerCase()
  if (raw.length === 0) return true
  // The needle is folded the same way the tokens are — otherwise typing the
  // separator a machine label actually uses would match and typing a space
  // would not, which is backwards.
  const folded = foldSearchText(needle)
  for (const token of rowSearchTokens(row, toMacro)) {
    if (token.includes(raw)) return true
    if (folded.length > 0 && token.includes(folded)) return true
  }
  return false
}

/**
 * Attribute filter. An EMPTY selection matches everything.
 *
 * The selected attributes OR together, exactly like the class chips: asking for
 * faces AND plates means "anything carrying either", not "a track carrying
 * both" — a track with both is one shot of a plate through a windscreen, and an
 * AND would answer almost nothing.
 *
 * Composes with the class and text filters by AND, which is what makes
 * "vehicles, on the driveway, with a plate" expressible.
 */
export function rowMatchesAttributes(
  row: EventsTrackRow,
  selected: ReadonlySet<EventsAttribute>,
): boolean {
  if (selected.size === 0) return true
  if (selected.has('face') && row.hasAssignableFace === true) return true
  if (selected.has('plate') && row.hasPlate === true) return true
  return false
}

/** Operator-flag chips. Empty selection matches everything; several-on OR. */
export function rowMatchesFlags(row: EventsTrackRow, flags: EventsFlagFilters = {}): boolean {
  const debug = flags.debug === true
  const train = flags.train === true
  const favourited = flags.favourited === true
  if (!debug && !train && !favourited) return true
  const reviewed = flags.reviewedTrackIds?.includes(row.trackId) === true
  if (debug && row.debug === true && !reviewed) return true
  if (train && row.markForTrain === true) return true
  if (favourited && row.favourited === true) return true
  return false
}

/**
 * Drop the rows whose PROVENANCE the surface is hiding.
 *
 * The same rule the hub applies to the read (`excludeSources` on
 * `listRecentTracks`), repeated here for one reason: a hub too old for that
 * parameter drops it silently — Zod strips a key it does not declare — and a
 * filter control that says "audio hidden" over a list of audio events is a
 * worse failure than no control. The narrowed read is the optimisation that
 * keeps paging honest; this is the guarantee.
 *
 * A row with NO `source` is a pipeline track (legacy rows carry the column
 * NULL), and a source this build has never heard of is kept: an exclusion list
 * may only ever hide what it NAMES, or a viewer that predates a new kind of
 * event hides it forever without saying so.
 */
export function rowMatchesSources(
  row: EventsTrackRow,
  excluded: ReadonlySet<string>,
): boolean {
  if (excluded.size === 0) return true
  return !excluded.has(row.source ?? 'pipeline')
}

/** Apply every client-side filter in one pass. */
export function filterRows(
  rows: readonly EventsTrackRow[],
  classes: readonly string[],
  search: string,
  toMacro: ReadonlyMap<string, string> = EMPTY_MACRO_MAP,
  attrs: readonly EventsAttribute[] = EMPTY_ATTRIBUTES,
  flags: EventsFlagFilters = {},
  excludeSources: readonly string[] = EMPTY_EXCLUDED_SOURCES,
): EventsTrackRow[] {
  const selected = new Set(classes)
  const selectedAttrs = new Set(attrs)
  const excluded = new Set(excludeSources)
  return rows.filter(
    (r) =>
      rowMatchesSources(r, excluded) &&
      rowMatchesClasses(r, selected, toMacro) &&
      rowMatchesAttributes(r, selectedAttrs) &&
      rowMatchesSearch(r, search, toMacro) &&
      rowMatchesFlags(r, flags),
  )
}

/**
 * WHICH tier a rendered title came from. The card decides what to draw from
 * this, never from comparing the title string to the class: once the class is
 * TRANSLATED, `title !== className` is true for every row (`Auto` is not
 * `car`), and the old string compare would have put a text pill on every bare
 * `person` tile and taken its glyph away.
 *
 *  - `device`   — a SYNTHETIC row's producing sensor. The rendered `text` is
 *                 the sensor's TYPE, translated; the sensor's own NAME is
 *                 {@link RowTitle.fullText}.
 *  - `identity` — a tier-2 proper noun: a recognised face, a plate read.
 *  - `kind`     — a tier-1 sub-class finer than the stored class (`car` under
 *                 `vehicle`). Taxonomy, so it is TRANSLATED.
 *  - `class`    — the detection class itself. Translated too, and the one tier
 *                 the thumbnail's glyph already says.
 */
export type RowTitleTier = 'device' | 'identity' | 'kind' | 'class'

/** A row's rendered title plus the tier it came from. */
export interface RowTitle {
  /** Ready to render — already translated where translation is legal. */
  readonly text: string
  readonly tier: RowTitleTier
  /**
   * The whole thing `text` is the SHORT form of — today only a synthetic row's
   * producing sensor NAME, where `text` is the sensor's type.
   *
   * Present only when it says strictly more than `text`, so a caller that
   * renders `fullText ?? text` is never rendering a duplicate. It is a device
   * name: a proper noun, VERBATIM, never through the class dictionary.
   *
   * The tile does not draw it — that is the whole point, it covered the
   * picture — it hovers it, and the DETAIL is where it is read (`trackTitle`).
   */
  readonly fullText?: string
}

/**
 * The row's display TITLE — what a TILE puts over the thumbnail:
 *
 *  • a SYNTHETIC row shows its sensor's TYPE, translated. `className` is that
 *    type: the hub projects a non-spatial event under the event KIND it came
 *    from (`contact` / `lock` / `switch`, `synthetic-track.ts`), so the type is
 *    read from a taxonomy field and never guessed off the name — `Sensore porta
 *    garage` is a `contact`, and its first word says `Sensore`. The NAME rides
 *    along as {@link RowTitle.fullText} for the surfaces that have room for it;
 *    the tile does not draw it, because a whole device name over a 106 px
 *    thumbnail is a label wearing the picture, which is what the operator
 *    reported;
 *  • else the tier-2 IDENTITY (`subLabel`), VERBATIM: it is a proper noun, and
 *    running a person's name through a class dictionary mangles it;
 *  • else the tier-1 sub-class (`label`) when it says more than the stored
 *    class — TAXONOMY, so translated;
 *  • else the class itself, also translated.
 *
 * The `label !== className` guard is what keeps the tier honest: a hub that
 * stores the same word in both carries no finer fact, and a pill saying what
 * the glyph already says is the noise the operator rejected.
 *
 * A synthetic row keeps the `device` TIER even though its text is now a class
 * label: the tier is what tells the card to draw a text pill at all, and
 * demoting it to `class` would replace `Contatto` with the bare contact glyph —
 * the opposite of "show the type".
 */
export function resolveRowTitle(
  row: Pick<EventsTrackRow, 'producingDeviceName' | 'subLabel' | 'label' | 'className'>,
  kindLabels: ReadonlyMap<string, string> = EMPTY_KIND_LABELS,
): RowTitle {
  if (row.producingDeviceName !== undefined) {
    return {
      text: kindLabelFor(row.className, kindLabels),
      tier: 'device',
      fullText: row.producingDeviceName,
    }
  }
  if (row.subLabel !== undefined) return { text: row.subLabel, tier: 'identity' }
  if (row.label !== undefined && row.label !== row.className) {
    return { text: kindLabelFor(row.label, kindLabels), tier: 'kind' }
  }
  return { text: kindLabelFor(row.className, kindLabels), tier: 'class' }
}

/**
 * The card's caption line — **only what the thumbnail does not already say**.
 *
 * The old rule ("the class when the title is finer, else the audio labels")
 * predates the glyphs and pills, and once those shipped it started repeating
 * them. Two cases the operator caught on the live gallery:
 *
 *  - an AUDIO card rendered speech+music as glyphs AND `speech, music` as text
 *    — the caption was a transcription of the icons;
 *  - a VEHICLE card rendered the `car` glyph, the pill `Car`, AND the caption
 *    `vehicle` — three sayings of one fact, the last of which was the COARSEST.
 *
 * A third case was arguably worse for being subtle: pill `Dave` + caption
 * `person`, where the person glyph was already sitting next to the pill.
 *
 * So the rule is now positional, not content-guessing: when the thumbnail is
 * carrying the labels (the glyph, the finest-label pill, the audio glyphs) the
 * caption has nothing left to add and renders NOTHING. When it is not — a host
 * that turned `fields.label` off but left `fields.sublabel` on — the caption
 * becomes the only carrier and says the finest thing known plus any audio.
 *
 * `thumbnailCarriesLabels` and `title` are passed in rather than inferred so the
 * rule stays pure and the caller cannot disagree with the renderer about what is
 * on the image — or about what the title says. The audio labels are resolved
 * through the SAME dictionary the title is: when the caption is the only
 * carrier, an untranslated `dog` beside a translated `Cane` would be the very
 * half-translated surface this exists to prevent.
 */
export function rowCaption(
  row: EventsTrackRow,
  thumbnailCarriesLabels: boolean,
  title: string,
  kindLabels: ReadonlyMap<string, string> = EMPTY_KIND_LABELS,
): string {
  if (thumbnailCarriesLabels) return ''
  const parts = [title]
  for (const audio of row.audioLabels) {
    // The de-duplication compares RAW values (the class and tier-1 label are
    // stored raw); only the rendered form is translated.
    if (audio === row.className || audio === row.label) continue
    const text = audioLabelFor(audio, kindLabels)
    if (!parts.includes(text)) parts.push(text)
  }
  return parts.join(' · ')
}

/**
 * Re-stamp rows with the CURRENT camera names.
 *
 * `toEventsTrackRow` resolves `cameraName` once, at fetch time. A host rename
 * that arrives afterwards (`setConfig({deviceNames})`) has to reach rows that
 * are already loaded, so the name is re-applied at render. Immutable, and it
 * allocates only for the rows whose name actually changed — a dictionary that
 * changes nothing returns the input array untouched.
 */
export function applyDeviceNames(
  rows: readonly EventsTrackRow[],
  nameById: ReadonlyMap<number, string>,
): readonly EventsTrackRow[] {
  let changed = false
  const out = rows.map((row) => {
    const name = nameById.get(row.deviceId)
    if (name === undefined || name === row.cameraName) return row
    changed = true
    return { ...row, cameraName: name }
  })
  return changed ? out : rows
}

/** One resolved operator-flag triple, as the host's write reports it. */
export interface TrackFlagPatch {
  readonly debug?: boolean
  readonly markForTrain?: boolean
  readonly favourited?: boolean
}

/**
 * Stamp already-loaded rows with flags the HOST just wrote.
 *
 * `listRecentTracks` is ordered by `lastSeen`. A flag write does not move
 * that clock, so the incremental poll never replaces the row, and the card
 * plus the debug/train/favourite chips keep reading the pre-write copy.
 * The host therefore pushes the resolved triple here. `true` emits the
 * field; `false` drops it back to absent — the same rule `toEventsTrackRow`
 * uses — so a chip that tests `=== true` and a pill that tests the same
 * cannot disagree.
 */
export function applyTrackFlagPatches(
  rows: readonly EventsTrackRow[],
  patches: Readonly<Record<string, TrackFlagPatch>>,
): readonly EventsTrackRow[] {
  const ids = Object.keys(patches)
  if (ids.length === 0) return rows
  let changed = false
  const out = rows.map((row) => {
    const patch = patches[row.trackId]
    if (patch === undefined) return row
    const next = applyOneFlagPatch(row, patch)
    if (next !== row) changed = true
    return next
  })
  return changed ? out : rows
}

function stripFlagFields(row: EventsTrackRow): Omit<EventsTrackRow, 'debug' | 'markForTrain' | 'favourited'> {
  const { debug: _debug, markForTrain: _train, favourited: _fav, ...rest } = row
  return rest
}

function applyOneFlagPatch(row: EventsTrackRow, patch: TrackFlagPatch): EventsTrackRow {
  const debug = patch.debug === true ? true : patch.debug === false ? undefined : row.debug
  const markForTrain =
    patch.markForTrain === true
      ? true
      : patch.markForTrain === false
        ? undefined
        : row.markForTrain
  const favourited =
    patch.favourited === true ? true : patch.favourited === false ? undefined : row.favourited
  if (debug === row.debug && markForTrain === row.markForTrain && favourited === row.favourited) {
    return row
  }
  return {
    ...stripFlagFields(row),
    ...(debug === true ? { debug: true } : {}),
    ...(markForTrain === true ? { markForTrain: true } : {}),
    ...(favourited === true ? { favourited: true } : {}),
  }
}

/**
 * The devices to actually ASK for when the host said "all cameras".
 *
 * `deviceManager.listAll` answers with every device in the deployment, and the
 * feed's page size is `floor(FANOUT_BUDGET / deviceCount)` — so naming 318
 * devices to read 17 cameras' tracks does not merely waste server work, it caps
 * the page at SIX rows and leaves the gallery unable to fill a screen. That is
 * the whole bug: a non-camera contributes nothing but shrinks the page.
 *
 * Degrades honestly: if NOT ONE row reports `isCamera`, the field is absent
 * (an older hub) and every device is kept — narrower would risk asking for
 * nothing at all.
 */
export function resolveCameraIds(
  devices: readonly { readonly id: number; readonly isCamera?: boolean }[],
): number[] {
  const cameras = devices.filter((d) => d.isCamera === true).map((d) => d.id)
  return cameras.length > 0 ? cameras : devices.map((d) => d.id)
}
