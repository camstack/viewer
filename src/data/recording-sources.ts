/**
 * Which RECORDING source a camera's timeline reads, and the `provider` the
 * cap wants for it.
 *
 * Two names, deliberately kept apart, because `recording` takes one and the
 * operator picks the other:
 *
 *  - the **source id** is what a `listSources` row calls itself and what
 *    `CameraPref.recordingProvider` stores (`camstack`, `native:reolink:card`);
 *  - the **addonId** is what every `recording` method's `provider` field takes
 *    — the cap says so by name: *"the `addonId` a RecordingSourceSchema row
 *    carries, never a source id and never a list"*.
 *
 * This module is the ONE place that turns one into the other. Two places
 * would be two definitions of "ours", and D625 exists because an un-narrowed
 * fan-out unions two sources into one bar.
 *
 * ## The default costs no round trip
 *
 * `camstack` is a RESERVED id (D625): only the `recorder` addon may mint it,
 * enforced in `device-collection-dispatch.ts` and in CI. That is what lets
 * absence MEAN ours without first asking `listSources` — a timeline paints on
 * mount, and a default that had to wait for a list would be a blank bar on
 * every launch.
 *
 * ## A pick that has not resolved is NOT ours
 *
 * `listSources` not having answered yet and the chosen source having gone away
 * are different events, and neither may be drawn as our footage. `clip-sources
 * .ts` ends with `?? sources[0]` — for a clip list that fallback was argued
 * for; for a timeline it silently swaps one camera's coverage for another's.
 * So {@link resolveRecordingProvider} answers `addonId: null` in both cases and
 * says which one it is, and a caller with a null addonId does not ask.
 */
import { isRecord } from './cap-query.js'

/**
 * The source id CamStack's own recorder serves. RESERVED — no other addon may
 * spell it (`packages/types/src/capabilities/reserved-collection-sources.ts`).
 *
 * Spelled here rather than imported from `@camstack/types` on purpose: this
 * checkout resolves `@camstack/*` from the PUBLISHED packages, exactly as
 * metro and CI do, so importing a constant added in the workspace would
 * type-check green against a tsconfig nobody ships with and throw on first
 * evaluation. The server-side guard is what keeps the two spellings honest.
 */
export const RECORDING_SOURCE_CAMSTACK = 'camstack'

/** The one addon allowed to serve {@link RECORDING_SOURCE_CAMSTACK}. */
export const RECORDING_SOURCE_CAMSTACK_ADDON = 'recorder'

/** One row of `recording.listSources`, parsed structurally. */
export interface RecordingSourceRow {
  readonly sourceId: string
  /** The addonId to send as `provider`. */
  readonly addonId: string
  /** A human label, when the row carried one. */
  readonly label?: string
}

/** Why {@link RecordingProviderChoice} holds the addonId it holds. */
export type RecordingProviderDerivation =
  /** No pick stored: ours, by the reserved id, with no list consulted. */
  | 'default'
  /** The stored pick matched a row `listSources` answered. */
  | 'picked'
  /** A pick is stored but `listSources` has not answered — do NOT ask yet. */
  | 'pending'
  /** A pick is stored and the answered list does not contain it. */
  | 'missing'

/** Which source a camera's timeline reads, and whether it may be asked. */
export interface RecordingProviderChoice {
  /** The source id in effect. Always populated — it is the operator's pick, or
   *  the reserved default — even when {@link addonId} is null. */
  readonly sourceId: string
  /** What to send as `provider`, or null when nothing may be asked yet. */
  readonly addonId: string | null
  readonly derivation: RecordingProviderDerivation
}

/** The default choice: ours, resolved without a list. */
export const RECORDING_PROVIDER_DEFAULT: RecordingProviderChoice = Object.freeze({
  sourceId: RECORDING_SOURCE_CAMSTACK,
  addonId: RECORDING_SOURCE_CAMSTACK_ADDON,
  derivation: 'default',
}) as RecordingProviderChoice

/**
 * Parse a `recording.listSources` response.
 *
 * The wire field is **`source`**, not `sourceId` — `RecordingSourceSchema`
 * spells it that way and so does `videoclips.listSources`, which
 * `parseClipSources` has always read correctly. Measured on the live hub:
 * `{ source: 'camstack', label: 'CamStack recordings', addonId: 'recorder' }`.
 *
 * A row this build cannot read is dropped rather than guessed at — an unusable
 * row is not a source. A row with no `addonId` is dropped for the reason the
 * clip picker drops one: the picker could offer it and then have nothing to
 * ask.
 */
export function parseRecordingSources(raw: unknown): readonly RecordingSourceRow[] {
  if (!Array.isArray(raw)) return []
  const rows: RecordingSourceRow[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const { source, addonId, label } = entry
    if (typeof source !== 'string' || source.length === 0) continue
    if (typeof addonId !== 'string' || addonId.length === 0) continue
    rows.push({
      sourceId: source,
      addonId,
      ...(typeof label === 'string' && label.length > 0 ? { label } : {}),
    })
  }
  return rows
}

/**
 * Resolve a stored pick into the `provider` to send.
 *
 * @param chosen       - `CameraPref.recordingProvider`; undefined = ours.
 * @param sources      - the rows `listSources` answered. Meaningless unless
 *                       `sourcesKnown`.
 * @param sourcesKnown - has `listSources` ANSWERED? An empty list that was
 *                       never asked and an empty list that came back empty are
 *                       different facts, and only the second one can make a
 *                       pick `missing` (D315).
 */
export function resolveRecordingProvider(
  chosen: string | undefined,
  sources: readonly RecordingSourceRow[],
  sourcesKnown: boolean,
): RecordingProviderChoice {
  // No pick, or the reserved id spelled out: ours, and no list is consulted.
  // Deliberately BEFORE the list lookup — our row must resolve identically on
  // a camera whose `listSources` is slow, failing, or absent entirely.
  if (chosen === undefined || chosen === RECORDING_SOURCE_CAMSTACK) {
    return RECORDING_PROVIDER_DEFAULT
  }
  if (!sourcesKnown) return { sourceId: chosen, addonId: null, derivation: 'pending' }
  const row = sources.find((s) => s.sourceId === chosen)
  if (row === undefined) return { sourceId: chosen, addonId: null, derivation: 'missing' }
  return { sourceId: row.sourceId, addonId: row.addonId, derivation: 'picked' }
}

/** One entry of the recording source picker. */
export interface RecordingSourcePickerOption {
  readonly value: string
  readonly label: string
}

/**
 * The picker's rows for one camera.
 *
 * OURS is always first and always present, whatever `listSources` answered:
 * it is the reserved default, it is what absence means, and a list that did
 * not mention it must not be able to remove the option of going back to it.
 * Every other row keeps the hub's own words for its label — a client that
 * paraphrases a server's prose drifts the first time a word changes (D563).
 */
export function recordingSourcePickerOptions(
  sources: readonly RecordingSourceRow[],
  ourLabel: string,
): readonly RecordingSourcePickerOption[] {
  const out: RecordingSourcePickerOption[] = [
    { value: RECORDING_SOURCE_CAMSTACK, label: ourLabel },
  ]
  for (const row of sources) {
    if (row.sourceId === RECORDING_SOURCE_CAMSTACK) continue
    out.push({ value: row.sourceId, label: row.label ?? row.sourceId })
  }
  return out
}
