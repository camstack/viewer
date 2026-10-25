/**
 * track-filter — the shared IDEA of "which tracks does this surface show".
 *
 * Three surfaces filter tracks and none of them should filter the same rows:
 * the events page (`events-filter-store`), the per-camera timeline
 * (`camera-local-store.timelineClasses`) and the Recent reel
 * (`reel-filter-store`). They are different SCOPES and must keep different
 * VALUES — narrowing the events page to one camera has nothing to say about
 * what a 24 h strip on the Cameras screen shows.
 *
 * What they must not be is three different ideas about what a filter IS. This
 * module owns the parts where they were already drifting: the ABSENT / EMPTY
 * distinction on read, the toggle reducer, and the derivation of a track
 * SOURCE exclusion from a class selection. Nothing here holds state, and
 * nothing here reaches storage.
 *
 * ## ABSENT, EMPTY and a list are three answers, not two
 *
 * Every persisted filter field in this app has to tell them apart, and the
 * distinction is what makes a narrowing default survive:
 *
 *  - **absent** — this install has never seen the facet ⇒ apply the default.
 *  - **empty**  — the operator cleared it ⇒ no narrowing, and it must SURVIVE
 *    the next launch. Reading it as absent re-applies the default forever,
 *    which is a rule wearing a default's clothes.
 *  - **a list** — an explicit selection.
 *
 * A malformed value degrades to the default, not to empty: garbage is closer
 * to "we do not know" than to "the operator chose nothing".
 */
import {
  type EventsTrackSource,
  isEventsTrackSource,
} from '../../shared/events/events-share-url.js'
import type { EventKindDescriptor } from '../data/event-kinds.js'

/**
 * Taxonomy CATEGORY → the track source that produces those kinds.
 *
 * The categories come from the hub's own `EVENT_TAXONOMY` and ride every
 * descriptor `listEventKinds` returns, so this is a mapping between two server
 * vocabularies rather than a restatement of either. `sensor` and `control` are
 * two macros over ONE track source: a door contact and a lock are the same
 * kind of projection, and the model has a single `sensor` source for both.
 */
function sourceOfCategory(category: string): EventsTrackSource {
  if (category === 'audio') return 'audio'
  if (category === 'sensor' || category === 'control') return 'sensor'
  return 'pipeline'
}

/**
 * Which DIMENSION a taxonomy node drives.
 *
 * This is the routing that lets ONE control answer one question. The event
 * tree offers Motion, Audio, Person, Vehicle, Animal, Package, Control and
 * Sensor side by side, and the operator is entitled to read those as eight
 * equal rows — but underneath they are not the same kind of thing:
 *
 *  - a node whose rows come from the spatial pipeline is a CLASS. `person`,
 *    `car`, `motion`, `package-delivered` all live in a track's `className` /
 *    `classes[]`, and the class filter selects them.
 *  - a node whose rows are a SYNTHETIC projection is a SOURCE. Those rows carry
 *    no accumulated `classes[]` at all, and the hub's class filter is a
 *    superset that keeps every row it cannot read — so a class selection can
 *    neither select them nor exclude them. Provenance is `source`, and
 *    `excludeSources` is the predicate that speaks it.
 *
 * The routing is decided by what the node IS — {@link sourceOfCategory} over
 * the hub's own category — never by a list of names written here and never by
 * which menu the row sits in. A node the taxonomy adds tomorrow is routed
 * correctly on the day it appears.
 *
 * Note the test is "is this node's source synthetic", not "is this node
 * `detection`": `motion` and `package` are not detection categories but they
 * ARE pipeline rows, and sending them down the source dimension would ask the
 * hub to exclude a source that does not exist.
 */
export function nodeDrivesSource(descriptor: EventKindDescriptor): boolean {
  return sourceOfCategory(descriptor.category) !== 'pipeline'
}

/**
 * The two default presets, named rather than spelled out at each call site.
 *
 *  - `all-but-audio` — the events page. Everything the hub advertises except
 *    the audio nodes: an investigation surface should hide only what was
 *    reported as noise, and a door opening is an event the operator asked to
 *    see.
 *  - `detection-macros` — the Recent strip. The macro tier a GLANCE is for.
 *
 * Both are resolved against the live taxonomy on every read and neither is
 * ever written to storage — see the ABSENT/EMPTY note above.
 */
export type FilterPreset = 'all-but-audio' | 'detection-macros'

/** The kinds a preset ticks, given the taxonomy loaded right now. */
export function presetKinds(
  preset: FilterPreset,
  descriptors: readonly EventKindDescriptor[] | undefined,
): readonly string[] {
  if (descriptors === undefined) return []
  if (preset === 'detection-macros') return detectionMacroKinds(descriptors)
  return descriptors.filter((d) => sourceOfCategory(d.category) !== 'audio').map((d) => d.kind)
}

const PRESET_HIDES_AUDIO: readonly EventsTrackSource[] = Object.freeze(['audio'])
const PRESET_HIDES_BOTH: readonly EventsTrackSource[] = Object.freeze(['audio', 'sensor'])

/**
 * The sources a preset hides, WITHOUT waiting for the taxonomy.
 *
 * Both presets are defined by a property their members cannot have — "not
 * audio", "the detection tier" — so this half of the answer is known before
 * any descriptor arrives. Deferring it would flash exactly the rows the
 * default exists to hide on every cold launch, for as long as
 * `listEventKinds` takes.
 */
export function presetExcludeSources(preset: FilterPreset): readonly EventsTrackSource[] {
  return preset === 'detection-macros' ? PRESET_HIDES_BOTH : PRESET_HIDES_AUDIO
}

/**
 * The kinds a surface actually asks for: the operator's stored selection, or
 * the preset resolved against the taxonomy that has loaded.
 *
 * `[]` is "no class narrowing" whether it is the operator's explicit choice or
 * a taxonomy that has not answered. Those are different FACTS and a surface
 * must not confuse them — but the request is the same either way, because a
 * filter built from a vocabulary nobody has read would narrow by a name no row
 * carries (D315).
 */
export function resolveFilterClasses(
  stored: readonly string[] | null,
  preset: FilterPreset,
  descriptors: readonly EventKindDescriptor[] | undefined,
): readonly string[] {
  return stored === null ? presetKinds(preset, descriptors) : pruneToAdvertised(stored, descriptors)
}

/**
 * Drop ids the loaded taxonomy does not advertise.
 *
 * ## The state this exists to end
 *
 * A stored selection outlives the scope it was written in. `expandMacroSelection`
 * removes a macro plus the subs the CURRENT descriptors call its own, so
 * unticking every visible row leaves behind anything the current vocabulary has
 * never heard of. The result is a selection that is not empty and cannot match:
 * the operator sees no ticks, the feed answers nothing, and the count sees
 * numbers with no rows behind them. Measured from the operator's screenshot:
 * five stored ids, zero visible ticks, a chip reading four.
 *
 * That residue is also what made an attribute-only selection a dead end. With
 * the kinds unticked the class axis has to be UNCONSTRAINED — the same
 * absent-versus-empty rule as everywhere else — and it could not be, because
 * the list was never actually empty.
 *
 * ## Why it is safe, and where it stops
 *
 * Only when the taxonomy has ANSWERED with kinds. `undefined` (in flight) and
 * `[]` (a hub that advertises none) both leave the selection untouched:
 * not-yet-known must never be served as a fact, and pruning against an empty
 * vocabulary would erase every selection on a hub too old to describe itself.
 *
 * When it does run, an id it removes is one no row in this scope can carry a
 * matching identity for — so nothing that could have matched is lost, and the
 * alternative is a guaranteed-empty feed the operator reads as a broken filter.
 */
export function pruneToAdvertised(
  selection: readonly string[],
  descriptors: readonly EventKindDescriptor[] | undefined,
): readonly string[] {
  if (descriptors === undefined || descriptors.length === 0) return selection
  const advertised = new Set(descriptors.map((d) => d.kind))
  return selection.every((k) => advertised.has(k))
    ? selection
    : selection.filter((k) => advertised.has(k))
}

/**
 * Every macro the selection touches — a ticked SUB counts for its macro.
 *
 * The one basis every visible number on the panel is built from. The tree
 * header used to report `selection.length` (raw ids, subs included) while the
 * chip reported macros, so the same state produced "5" in one place and "4" in
 * another with zero rows ticked on screen between them.
 */
export function selectedMacroKinds(
  selection: readonly string[],
  descriptors: readonly EventKindDescriptor[] | undefined,
): readonly string[] {
  if (selection.length === 0) return []
  const selected = new Set(selection)
  const out = new Set<string>()
  for (const d of descriptors ?? []) {
    if (selected.has(d.kind)) out.add(macroOfDescriptor(d))
  }
  return [...out]
}

/**
 * How a macro row draws its own checkbox.
 *
 * `partial` is the state that was missing: a macro whose subs are ticked but
 * whose own id is not rendered as EMPTY, so a selection made entirely of subs
 * showed a tree with nothing ticked at all — while the counts beside it
 * insisted something was selected. A collapsed row must never hide the fact
 * that something under it is on.
 */
export type MacroCheckState = 'on' | 'partial' | 'off'

export function macroCheckState(
  macroKind: string,
  subKinds: readonly string[],
  selection: ReadonlySet<string>,
): MacroCheckState {
  if (selection.has(macroKind)) return 'on'
  return subKinds.some((k) => selection.has(k)) ? 'partial' : 'off'
}

/**
 * The source exclusion behind the SAME selection — derived, never stored.
 *
 * One control, two dimensions: the ticks the operator sees go out as `classes`
 * for the pipeline nodes and as `excludeSources` for the synthetic ones, and
 * the split is {@link nodeDrivesSource}. A second stored field would be a
 * second filter that can disagree with the first.
 */
export function resolveFilterExcludeSources(
  stored: readonly string[] | null,
  preset: FilterPreset,
  descriptors: readonly EventKindDescriptor[] | undefined,
): readonly EventsTrackSource[] {
  if (stored === null) return presetExcludeSources(preset)
  return excludeSourcesForSelection(stored, descriptors)
}

/**
 * How to label the collapsed chip for a resolved selection.
 *
 * Counted in MACROS, because macros are the rows the operator ticked: the
 * stored list carries every sub the macro toggle swept in, so a raw length
 * reads "30" for a default that unticked one thing. `all` when the selection
 * covers every macro the hub advertises (or narrows nothing at all) —
 * anything else is a narrowing and has to say so.
 */
export type SelectionSummary =
  | { readonly kind: 'all' }
  | { readonly kind: 'narrowed'; readonly macros: number }

export function summariseSelection(
  resolved: readonly string[],
  descriptors: readonly EventKindDescriptor[] | undefined,
): SelectionSummary {
  if (resolved.length === 0) return { kind: 'all' }
  const advertised = new Set((descriptors ?? []).map((d) => macroOfDescriptor(d)))
  const selectedMacros = new Set<string>()
  for (const d of descriptors ?? []) {
    if (resolved.includes(d.kind)) selectedMacros.add(macroOfDescriptor(d))
  }
  // A taxonomy that has not answered cannot say whether this is everything;
  // report the honest "narrowed" rather than inventing "all".
  if (advertised.size > 0 && selectedMacros.size >= advertised.size) return { kind: 'all' }
  return { kind: 'narrowed', macros: selectedMacros.size }
}

/**
 * The numbers the Classes control draws, from ONE derivation.
 *
 * The panel has two sections — the attribute rows and the kind tree — so each
 * states its own count and the collapsed chip states their SUM. Keeping that
 * arithmetic here rather than in the component is the point: the chip and the
 * tree header used to compute their numbers independently (macros in one, raw
 * ids in the other) and a state with five stored ids drew "4" over "5" over a
 * tree with nothing visibly ticked.
 *
 * `narrowed` is false only when NEITHER axis constrains anything — that is the
 * one state that may be labelled "All".
 */
export interface FacetCounts {
  readonly classes: number
  readonly attributes: number
  readonly total: number
  readonly narrowed: boolean
}

export function facetCounts(
  resolved: readonly string[],
  descriptors: readonly EventKindDescriptor[] | undefined,
  attributeCount: number,
): FacetCounts {
  const summary = summariseSelection(resolved, descriptors)
  const classes = summary.kind === 'narrowed' ? summary.macros : 0
  return {
    classes,
    attributes: attributeCount,
    total: classes + attributeCount,
    narrowed: summary.kind === 'narrowed' || attributeCount > 0,
  }
}

function macroOfDescriptor(d: EventKindDescriptor): string {
  return d.parentKind ?? d.kind
}

/**
 * The kinds a surface shows by DEFAULT: the macro tier of the detection
 * category — `person`, `vehicle`, `animal` and whatever else the hub puts
 * there.
 *
 * Derived from the descriptors, never written out. A hand-written list beside
 * a live taxonomy is two sources of truth, and the one that is not generated
 * is the one that rots: a macro the hub learns next year would be silently
 * absent from every default forever.
 *
 * It leaves the synthetic sources out BY CONSTRUCTION — `audio` is its own
 * category and `sensor`/`control` are theirs — so a surface defaulting to this
 * needs no second mechanism to hide them.
 *
 * Returns `[]` when the taxonomy has not answered or advertises no detection
 * macro. A caller must read that as "no class narrowing", never as "select
 * nothing": an empty strip is what not-yet-known must never look like (D315).
 */
export function detectionMacroKinds(
  descriptors: readonly EventKindDescriptor[] | undefined,
): readonly string[] {
  if (descriptors === undefined) return []
  return descriptors.filter((d) => d.level === 'macro' && d.category === 'detection').map((d) => d.kind)
}

/**
 * The track SOURCES a class selection can never match, so the hub can drop
 * them from the READ instead of shipping rows the client then hides.
 *
 * This is the "by construction" made explicit. A selection with no audio kind
 * in it cannot match an audio-sourced row (their `className` is the `audio`
 * macro, D189), and a selection with no sensor/control kind cannot match a
 * sensor-sourced one. Deriving the exclusion rather than storing it is what
 * keeps this ONE filter with two expressions instead of two filters that can
 * disagree.
 *
 * `pipeline` is never returned. Selecting no pipeline kind is a legitimate
 * thing to ask for, but it is expressed by the class list itself; adding it
 * here would let a half-loaded taxonomy empty the surface.
 *
 * An EMPTY selection excludes nothing — it is "show everything", so every
 * source stays.
 */
export function excludeSourcesForSelection(
  selection: readonly string[],
  descriptors: readonly EventKindDescriptor[] | undefined,
): readonly EventsTrackSource[] {
  if (selection.length === 0) return []
  const selected = new Set(selection)
  const reachable = new Set<EventsTrackSource>()
  for (const d of descriptors ?? []) {
    if (selected.has(d.kind)) reachable.add(sourceOfCategory(d.category))
  }
  // A kind the taxonomy does not describe is assumed to be a pipeline class —
  // narrowing on a guess would hide rows the operator asked for.
  for (const kind of selected) {
    if (!(descriptors ?? []).some((d) => d.kind === kind)) reachable.add('pipeline')
  }
  const out: EventsTrackSource[] = []
  for (const source of ['audio', 'sensor'] as const) {
    if (!reachable.has(source)) out.push(source)
  }
  return out
}

/** Toggle a value's membership in a readonly list (immutable). */
export function toggleMember<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value]
}

/** True when `v` is an indexable, non-array object. */
export function isFilterRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The strings of an unknown value, dropping non-strings. Not a validator —
 *  callers narrow further (`isEventsTrackSource`, the live taxonomy). */
export function filterStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/**
 * Read a persisted string list, keeping the three answers apart.
 *
 * `null` is returned ONLY for a well-formed empty array, so a caller that
 * treats `null` as "the default" would be wrong — see the module docblock.
 * The signature is deliberately total: absent and malformed both give
 * `fallback`, an empty array gives an empty array.
 */
export function parseStringList(
  raw: unknown,
  fallback: readonly string[],
): readonly string[] {
  return Array.isArray(raw) ? filterStrings(raw) : [...fallback]
}

/** {@link parseStringList} narrowed to the known track sources. A token this
 *  build has never heard of is DROPPED: it would otherwise ride into the
 *  embed's config, fail its enum and take the whole patch with it. */
export function parseHiddenSources(
  raw: unknown,
  fallback: readonly EventsTrackSource[],
): readonly EventsTrackSource[] {
  return Array.isArray(raw) ? filterStrings(raw).filter(isEventsTrackSource) : [...fallback]
}
