/**
 * events-taxonomy — the class → macro map, from the SERVER's own descriptors.
 *
 * `pipelineAnalytics.listEventKindsBatch` returns, per camera, the event kinds
 * that camera can produce, each with a `parentKind` (`car` → `vehicle`; null
 * for a macro). That is the only place the family tree exists, and it is
 * DERIVED — a class the hub learns about tomorrow expands without an embed
 * redeploy. Nothing here is hardcoded, deliberately.
 *
 * Why the embed needs it at all: a track stores the coarse `className`, but the
 * picker an operator uses emits taxonomy ids at every level. Compared naively,
 * the two vocabularies are disjoint for everything except three macros — the
 * viewer measured selecting `Audio` matching 0 of 1000 rows, and every SUB kind
 * (`car`, `dog`) matching nothing at all. The embed shipped with that same
 * exact-id compare; this is the fix, reading the same source the viewer reads.
 *
 * Pure. The fetch lives in `use-events-feed.ts`'s client.
 */

/** The macro every audio sub hangs from — what a picker emits for "Audio". */
export const AUDIO_MACRO = 'audio'

/** One descriptor row, reduced to the fields the maps are built from. */
export interface EventKindDescriptorLite {
  readonly kind: string
  readonly parentKind?: string | null
  readonly iconId?: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Build `kind → macro` from the batched descriptor response.
 *
 * Accepts the raw `listEventKindsBatch` payload (an array of
 * `{ deviceId, kinds }`) and is total on anything else — a hub too old to have
 * the method, or an error, yields an EMPTY map, and an empty map degrades this
 * to the exact-id compare that shipped before. Never throws: a taxonomy that
 * failed to load must narrow the filter, never empty the feed.
 */
export function buildClassToMacro(raw: unknown): ReadonlyMap<string, string> {
  return classToMacroFromKinds(kindDescriptors(raw))
}

/** Flatten the raw batch payload (`[{ deviceId, kinds }]`) to its descriptors. */
function kindDescriptors(raw: unknown): readonly Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  if (!Array.isArray(raw)) return out
  for (const perDevice of raw) {
    if (!isRecord(perDevice)) continue
    const kinds = perDevice.kinds
    if (!Array.isArray(kinds)) continue
    for (const d of kinds) if (isRecord(d)) out.push(d)
  }
  return out
}

/**
 * `kind → macro` from descriptors that are already parsed — the app's own
 * `useEventKinds` hands over typed rows, and rebuilding the raw wire shape
 * just to parse it again would be a second spelling of this rule.
 */
export function classToMacroFromKinds(
  kinds: readonly { readonly kind?: unknown; readonly parentKind?: unknown }[],
): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  for (const d of kinds) {
    const kind = d.kind
    if (typeof kind !== 'string' || kind.length === 0) continue
    const parent = d.parentKind
    map.set(kind, typeof parent === 'string' && parent.length > 0 ? parent : kind)
  }
  return map
}

/** Resolve a class/kind id to its macro. An UNKNOWN id maps to itself — it is
 *  effectively its own macro, and that is what keeps an empty map harmless. */
export function macroOf(kind: string, map: ReadonlyMap<string, string>): string {
  return map.get(kind) ?? kind
}

/** The `audio-` namespace the taxonomy uses for audio macro ids. */
const AUDIO_KIND_PREFIX = 'audio-'

/** The taxonomy MACRO for audio — what a D189 audio row carries as its class. */
const AUDIO_MACRO_ID = 'audio'

/**
 * Audio labels are stored BARE (`speech`, `dog`); the taxonomy keys them
 * namespaced (`audio-speech`). One place converts.
 *
 * IDEMPOTENT, exactly like its server-side twin (`audioKindId` in
 * `@camstack/types`). Without the guard this doubles a value that already
 * carries the namespace — and since the hub's D189 contract an audio row's
 * class is the macro `audio` itself, so the ungarded form produced
 * `audio-audio`: an id the taxonomy does not know, which shadows both
 * `EVENT_KIND_ICONS.audio` and the 25 curated `audio-*` glyphs. Four other call
 * sites feed this from `audioLabels[].label`, and the guard covers them too.
 */
export function audioKindId(label: string): string {
  const id = label.toLowerCase()
  return id.startsWith(AUDIO_KIND_PREFIX) ? id : `${AUDIO_KIND_PREFIX}${id}`
}

/**
 * Build `kind → iconId` from the same descriptor response.
 *
 * The descriptor is where a kind's glyph is DECLARED (`iconId`), so a class the
 * hub learns tomorrow gets the right icon without an embed redeploy — exactly
 * as the native card's `resolver.resolveIcon` does. Falling back to the raw
 * class id (below) reproduces the native's own fallback path
 * (`resolveEventKindIcon(track.className.toLowerCase())`), which is why an
 * absent taxonomy still renders sensible glyphs instead of a wall of `Tag`.
 */
export function buildKindIconIds(raw: unknown): ReadonlyMap<string, string> {
  return iconIdsFromKinds(kindDescriptors(raw))
}

/** `kind → declared glyph id` from already-parsed descriptors. */
export function iconIdsFromKinds(
  kinds: readonly { readonly kind?: unknown; readonly iconId?: unknown }[],
): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  for (const d of kinds) {
    const kind = d.kind
    const iconId = d.iconId
    if (typeof kind !== 'string' || kind.length === 0) continue
    if (typeof iconId !== 'string' || iconId.length === 0) continue
    map.set(kind, iconId)
  }
  return map
}

/**
 * The glyph id for a track's class: the declared `iconId` when the taxonomy
 * knows the class, else the lower-cased class itself — `resolveEventKindIcon`
 * keys on the same vocabulary, so `person`/`car`/`dog` resolve correctly with
 * no taxonomy at all, and anything unknown lands on the neutral `Tag`.
 *
 * `isAudioClass` says the class came from an AUDIO episode (`source: 'audio'`),
 * whose `className` is a bare audio macro — `speech`, `animal`. Those are keyed
 * `audio-<id>` everywhere else in the taxonomy, so the bare id matched nothing
 * and fell through to `Tag`; the operator saw generic tags on every audio tile.
 * Namespacing first is also what keeps the two readings of a SHARED id apart
 * (`water` the leak sensor vs `audio-water` the running tap), and an audio class
 * with no curated glyph still lands on `Volume2` rather than the neutral tag.
 */
export function iconIdForClass(
  className: string,
  iconIds: ReadonlyMap<string, string>,
  isAudioClass = false,
): string {
  if (isAudioClass) {
    // Since D189 the hub already sends the taxonomy macro `audio` here, and the
    // taxonomy knows it — so ask about the class AS GIVEN first. Only a bare
    // sub-macro from an older hub (`speech`, `animal`) needs the namespace.
    const asGiven = iconIds.get(className)
    if (asGiven !== undefined) return asGiven
    if (className.toLowerCase() === AUDIO_MACRO_ID) return AUDIO_MACRO_ID
    const namespaced = audioKindId(className)
    return iconIds.get(namespaced) ?? namespaced
  }
  const key = className.toLowerCase()
  return iconIds.get(className) ?? iconIds.get(key) ?? key
}

// ── Translated kind LABELS ──────────────────────────────────────────────────

/**
 * Build `kind → TRANSLATED label` from the host's dictionary.
 *
 * The embed has no i18n of its own and its host does (see `events-config`'s
 * `strings`), so a class name reaches the operator in his language ONLY if the
 * host hands the taxonomy over already translated. Without it every card
 * rendered the hub's English `label` — `Car` on an Italian gallery, which is
 * exactly what the operator reported.
 *
 * Each kind is also indexed LOWER-CASED, because a stored `className` /
 * tier-1 `label` is not guaranteed to match the taxonomy id's case
 * (`resolveLabel` in the viewer's `use-event-kind-resolver` does the same two
 * lookups for the same reason). An empty dictionary is legal and degrades to
 * the raw id — narrower than English, never blank.
 */
export function buildKindLabels(
  raw: Readonly<Record<string, string>>,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  for (const [kind, label] of Object.entries(raw)) {
    if (kind.length === 0 || label.length === 0) continue
    map.set(kind, label)
    const lower = kind.toLowerCase()
    if (!map.has(lower)) map.set(lower, label)
  }
  return map
}

/** Shared empty dictionary — a caller with no host translation still renders. */
export const EMPTY_KIND_LABELS: ReadonlyMap<string, string> = new Map()

/**
 * The label to RENDER for a taxonomy id: the host's translation when it has
 * one, else the id itself.
 *
 * ONE function, so no surface can quietly go back to printing the raw id — the
 * defect this replaces existed in three copies (the card's title, the card's
 * caption, and the semantic-hit normaliser), which is what a missing shared
 * function looks like.
 */
export function kindLabelFor(id: string, labels: ReadonlyMap<string, string>): string {
  return labels.get(id) ?? labels.get(id.toLowerCase()) ?? id
}

/**
 * The label to RENDER for a BARE audio-macro label (`speech`, `dog`).
 *
 * Audio labels are stored bare and the taxonomy keys them `audio-<id>`, so the
 * lookup is namespaced — but the FALLBACK is the bare label the operator
 * already recognises, never the namespaced id. Returning `audio-speech` when
 * the host sent no dictionary would replace an English word with an internal
 * one, which is worse than the defect.
 */
export function audioLabelFor(label: string, labels: ReadonlyMap<string, string>): string {
  const namespaced = audioKindId(label)
  return labels.get(namespaced) ?? labels.get(label) ?? label
}
