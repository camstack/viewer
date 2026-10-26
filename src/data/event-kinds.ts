/**
 * Event-kind taxonomy (viewer side) — types + pure helpers over the descriptors
 * returned by the hub's `pipelineAnalytics.listEventKinds`.
 *
 * The server owns the unified taxonomy (`@camstack/types` `EVENT_TAXONOMY`) and
 * ships every UI-relevant field INLINE on each descriptor. Glyphs come from
 * `iconId` (see `event-kind-icons`) and labels from `labelKey`. The taxonomy
 * `color` is not the cluster palette (D939), so the stored `color` is always
 * the current palette entry for that kind.
 */
import { isRecord } from './cap-query.js'
import { paintCurrentKind } from '../../shared/palette.js'

/** Two levels only (v1): macro (timeline lane) → sub (events-page leaf). */
export type EventKindLevel = 'macro' | 'sub'

/** One event-kind descriptor (subset of the cap's `EventKindDescriptorSchema`
 *  the UI needs). */
export interface EventKindDescriptor {
  readonly kind: string
  readonly labelKey: string
  readonly label: string
  readonly color: string
  readonly iconId: string
  readonly category: string
  readonly parentKind: string | null
  readonly level: EventKindLevel
}

/** A macro node with its sub children — the shape the events-page tree renders. */
export interface EventKindTreeNode {
  readonly macro: EventKindDescriptor
  readonly subs: readonly EventKindDescriptor[]
}

/** Narrow one unknown row into an `EventKindDescriptor`, or null when off. */
export function toEventKindDescriptor(raw: unknown): EventKindDescriptor | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string' || raw.kind.length === 0) return null
  const kind = raw.kind
  const parentKind = typeof raw.parentKind === 'string' ? raw.parentKind : null
  const level: EventKindLevel =
    raw.level === 'macro' || raw.level === 'sub' ? raw.level : parentKind ? 'sub' : 'macro'
  return {
    kind,
    labelKey: typeof raw.labelKey === 'string' ? raw.labelKey : `eventKind.${kind}`,
    label: typeof raw.label === 'string' ? raw.label : kind,
    color: paintCurrentKind(kind),
    iconId: typeof raw.iconId === 'string' ? raw.iconId : 'generic',
    category: typeof raw.category === 'string' ? raw.category : 'custom',
    parentKind,
    level,
  }
}

/** Narrow an unknown array of descriptors, dropping malformed rows. */
export function toEventKindDescriptors(raw: unknown): readonly EventKindDescriptor[] {
  if (!Array.isArray(raw)) return []
  const out: EventKindDescriptor[] = []
  for (const r of raw) {
    const d = toEventKindDescriptor(r)
    if (d) out.push(d)
  }
  return out
}

/** Merge several descriptor lists, de-duping by `kind` (first wins). */
export function mergeEventKinds(
  lists: readonly (readonly EventKindDescriptor[])[],
): readonly EventKindDescriptor[] {
  const seen = new Map<string, EventKindDescriptor>()
  for (const list of lists) {
    for (const d of list) if (!seen.has(d.kind)) seen.set(d.kind, d)
  }
  return [...seen.values()]
}

/** Only the macro-level descriptors (timeline lanes / legend). */
export function macroKinds(
  descriptors: readonly EventKindDescriptor[],
): readonly EventKindDescriptor[] {
  return descriptors.filter((d) => d.level === 'macro')
}

/** The sub descriptors whose `parentKind` is `macro`. */
export function subKindsOf(
  descriptors: readonly EventKindDescriptor[],
  macro: string,
): readonly EventKindDescriptor[] {
  return descriptors.filter((d) => d.level === 'sub' && d.parentKind === macro)
}

/**
 * Build the macro→sub tree. Macros come first (in input order); each carries its
 * subs. Subs whose parent macro isn't present are grouped under a synthetic
 * macro node built from the sub's own parentKind so nothing is dropped.
 */
export function buildEventKindTree(
  descriptors: readonly EventKindDescriptor[],
): readonly EventKindTreeNode[] {
  const macros = macroKinds(descriptors)
  const macroIds = new Set(macros.map((m) => m.kind))
  const nodes: EventKindTreeNode[] = macros.map((macro) => ({
    macro,
    subs: subKindsOf(descriptors, macro.kind),
  }))

  // Orphan subs (parent macro not advertised) → synthetic macro node.
  const orphans = new Map<string, EventKindDescriptor[]>()
  for (const d of descriptors) {
    if (d.level === 'sub' && d.parentKind && !macroIds.has(d.parentKind)) {
      const bucket = orphans.get(d.parentKind) ?? []
      bucket.push(d)
      orphans.set(d.parentKind, bucket)
    }
  }
  for (const [parent, subs] of orphans) {
    nodes.push({
      macro: {
        kind: parent,
        labelKey: `eventKind.${parent}`,
        label: parent,
        color: paintCurrentKind(parent),
        iconId: parent,
        category: subs[0]?.category ?? 'custom',
        parentKind: null,
        level: 'macro',
      },
      subs,
    })
  }
  return nodes
}

/**
 * What the kind picker should render — the pure three-state decision.
 *
 * `undefined` descriptors mean the taxonomy query has NOT SETTLED yet
 * (TanStack's `data` is `undefined` until first success, and `useEventKinds`'
 * queryFn never throws — `capQuery` swallows errors to `null`), so the picker
 * must show a loading state. The flat fallback is legal ONLY when the query
 * settled and the hub advertised nothing.
 *
 * This distinction is the point: conflating "still loading" with "advertises
 * no kinds" (`tree.length === 0`) made every cold open of the timeline filter
 * render the lesser fallback list (2026-08-01 regression).
 */
export type EventKindTreeSource =
  | { readonly state: 'loading' }
  | { readonly state: 'taxonomy'; readonly tree: readonly EventKindTreeNode[] }
  | { readonly state: 'fallback' }

/**
 * The advertised tree, plus a macro row for every OBSERVED class it does not
 * name.
 *
 * 2026-09-11, camera 101: `listEventKinds` advertised no detection class at
 * all — the hub reads "detection enabled" off a momentary `getCameraStatus`,
 * and a camera armed on motion has no session between motions — while the
 * same 24 h of `listTracks` held 95 `person`, 48 `vehicle`, 30 `animal`. The
 * taxonomy won over the rows on screen, and the operator could see a class
 * on the timeline that the filter would not let them tick. A class that has
 * PRODUCED an event in the window is a fact this surface holds in its own
 * hands; it is appended after the advertised lanes, as a macro with no subs,
 * and never duplicates a kind the taxonomy names as a macro or under one.
 */
function withObservedClasses(
  tree: readonly EventKindTreeNode[],
  observedClasses: readonly string[],
): readonly EventKindTreeNode[] {
  const named = new Set<string>()
  for (const node of tree) {
    named.add(node.macro.kind)
    for (const sub of node.subs) named.add(sub.kind)
  }
  const extra = [...new Set(observedClasses)].filter((kind) => kind.length > 0 && !named.has(kind))
  if (extra.length === 0) return tree
  const observed: EventKindTreeNode[] = extra.map((kind) => ({
    macro: {
      kind,
      labelKey: `eventKind.${kind}`,
      label: kind,
      color: paintCurrentKind(kind),
      iconId: kind,
      category: 'detection',
      parentKind: null,
      level: 'macro',
    },
    subs: [],
  }))
  return [...tree, ...observed]
}

/**
 * Decide loading / taxonomy / fallback from the (possibly unsettled) query
 * data. `observedClasses` — the distinct classes of the rows the surface has
 * LOADED — join the taxonomy when it omits them (see
 * {@link withObservedClasses}); they never turn a loading or an empty answer
 * into a taxonomy, because the fallback branch renders them itself.
 */
export function resolveEventKindTreeSource(
  descriptors: readonly EventKindDescriptor[] | undefined,
  observedClasses: readonly string[] = [],
): EventKindTreeSource {
  if (descriptors === undefined) return { state: 'loading' }
  const tree = buildEventKindTree(descriptors)
  if (tree.length === 0) return { state: 'fallback' }
  return { state: 'taxonomy', tree: withObservedClasses(tree, observedClasses) }
}

/** Map every kind id → its macro (`parentKind ?? kind`) for collapse/matching. */
export function classToMacroMap(
  descriptors: readonly EventKindDescriptor[],
): ReadonlyMap<string, string> {
  const m = new Map<string, string>()
  for (const d of descriptors) m.set(d.kind, d.parentKind ?? d.kind)
  return m
}

/** Resolve a class/kind id to its macro; unknown ids map to themselves (they
 *  are effectively their own macro). */
export function macroOf(kind: string, map: ReadonlyMap<string, string>): string {
  return map.get(kind) ?? kind
}

/**
 * The classes to send, or `null` for "send no class filter".
 *
 * `null` when the selection is empty (nothing narrowed) and — importantly —
 * when the macro map is not loaded yet. An unloaded map cannot expand
 * anything, and a request built from it would narrow the read by a name no
 * row carries. Not-yet-known must never be served as a fact (D315): the
 * unfiltered rows arrive and the client filter narrows them, which is exactly
 * what happened before this existed.
 */
export function expandSelectionToServerClasses(
  selection: ReadonlySet<string>,
  classToMacro: ReadonlyMap<string, string>,
): readonly string[] | null {
  if (selection.size === 0) return null
  if (classToMacro.size === 0) return null
  const out = new Set<string>(selection)
  for (const [className, macro] of classToMacro) {
    if (selection.has(macro)) out.add(className)
  }
  return [...out].sort()
}

/** Collapse a class list to distinct macro ids (input order preserved). */
export function collapseToMacro(
  classes: readonly string[],
  map: ReadonlyMap<string, string>,
): readonly string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of classes) {
    const macro = macroOf(c, map)
    if (!seen.has(macro)) {
      seen.add(macro)
      out.push(macro)
    }
  }
  return out
}

/** A macro's own id plus all its sub ids — selecting a macro includes its subs. */
export function expandMacroSelection(
  macro: string,
  descriptors: readonly EventKindDescriptor[],
): readonly string[] {
  return [macro, ...subKindsOf(descriptors, macro).map((s) => s.kind)]
}

/**
 * Namespace a BARE audio-macro id to its taxonomy key (`dog` → `audio-dog`).
 *
 * Audio events persist the macro id un-namespaced while the taxonomy keys audio
 * subs under `audio-<id>`, so this is the bridge between the two. It also keeps
 * an audio label from colliding with the VIDEO class of the same name — `water`
 * heard is not `water` seen, and `dog` heard is not `dog` seen.
 *
 * It lives here, in the pure data layer, rather than beside the glyph
 * dictionary: the filter needs it, and the glyph module drags the icon set —
 * and with it react-native — into anything that imports it.
 */
export function audioKindId(label: string): string {
  return `audio-${label.toLowerCase()}`
}
