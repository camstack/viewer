/**
 * clip-sources — which of a camera's clip sources this viewer is looking at.
 *
 * ## The operator's rule, and what it settles
 *
 * > *"La sorgente deve essere selezionata lato viewer dall'utente nelle settings
 * > generali della camera come provider di quella camera. Mai mischiate provider
 * > diversi."* — and, on our own recordings: *"non importa la sorgente di clips,
 * > sarà uno sul viewer. Non devono avere alcuna connessione."*
 *
 * ONE source at a time, per camera, chosen by the person looking. That single
 * sentence closes the question D559 left open (`senza sovrapposizioni`): there
 * is no overlap to resolve, because two sources are never drawn together. It
 * also means the native list is NOT additive to the derived one — the rule this
 * module replaces — see D569.
 *
 * ## Why the choice is a SOURCE and the call carries an ADDON
 *
 * `videoclips.listSources` answers one row per SOURCE (`analytics`,
 * `native:reolink:onboard`, …) and each row names the addon that serves it
 * (`ClipSource.addonId`, added by D555 precisely so a surface never has to map
 * one to the other itself). `videoclips.listClips` takes ONE `provider`, and it
 * is the ADDON id (D557 § 4). So the operator picks a row, we store the source
 * id — the finer grain, the thing his label says — and we send the addon the
 * row itself named. A `native:reolink:* → provider-reolink` table in this file
 * would be a second authority on provider identity and wrong the day a third
 * source appears.
 *
 * ## Why `provider` is always sent explicitly
 *
 * The cap documents an absent `provider` as "the device's BOUND provider, which
 * is CamStack on every camera today". Measured on the live hub 2026-09-20, with
 * 592 bound to both `recorder` and `provider-reolink`, an absent `provider`
 * answered with the REOLINK rows. Absence is therefore not an expression of a
 * choice, and this module never relies on it.
 *
 * Pure: no React, no i18n, no network.
 */

import { isRecord } from '../data/cap-query.js'
import { CLIP_SOURCE_ANALYTICS, type ClipSourceId } from './clip-model.js'

/** The source id CamStack's own recorder serves. Our footage, our timeline. */
export const CLIP_PROVIDER_CAMSTACK_SOURCE: ClipSourceId = CLIP_SOURCE_ANALYTICS

/**
 * What a source is saying about itself.
 *
 * The five the hub computes (D561), plus `unknown` for a state this build has
 * never seen. `unknown` is NOT folded into `ok`: `ok` means "this list may be
 * read as complete", and a build that cannot read the word has established
 * nothing (D393, D561 defect 1).
 */
export type ClipSourceState = 'ok' | 'sleeping' | 'unreachable' | 'no-storage' | 'index-empty' | 'unknown'

const KNOWN_STATES: readonly ClipSourceState[] = [
  'ok',
  'sleeping',
  'unreachable',
  'no-storage',
  'index-empty',
]

/** One row of `videoclips.listSources`, parsed structurally. */
export interface ClipSourceRow {
  readonly sourceId: ClipSourceId
  /** The addon `listClips({provider})` must be asked for. */
  readonly addonId: string
  /** The hub's own label for the source. Rendered verbatim. */
  readonly label: string
  readonly state: ClipSourceState
  /** The source's own words about why it cannot answer. Never parsed. */
  readonly reason?: string
  /** When the source's catalog was last read, if it has one. */
  readonly catalogAsOf?: number
}

function toState(raw: unknown): ClipSourceState {
  return KNOWN_STATES.includes(raw as ClipSourceState) ? (raw as ClipSourceState) : 'unknown'
}

/**
 * Parse a `listSources` response.
 *
 * Structural, for the reason `clip-mapping.ts` is: the viewer resolves
 * `@camstack/*` from the PUBLISHED packages, which lag the hub — installed
 * `@camstack/types` does not describe `listSources` at all. A row this build
 * cannot fully read still lists; a row with no addon to ask is dropped, because
 * the picker could offer it and then never satisfy it.
 */
export function parseClipSources(raw: unknown): readonly ClipSourceRow[] {
  if (!Array.isArray(raw)) return []
  const out: ClipSourceRow[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const { source, addonId, label, availability } = entry
    if (typeof source !== 'string' || source.length === 0) continue
    if (typeof addonId !== 'string' || addonId.length === 0) continue
    const avail = isRecord(availability) ? availability : {}
    out.push({
      sourceId: source,
      addonId,
      label: typeof label === 'string' && label.length > 0 ? label : source,
      state: toState(avail['state']),
      ...(typeof avail['reason'] === 'string' && avail['reason'].length > 0
        ? { reason: avail['reason'] }
        : {}),
      ...(typeof avail['catalogAsOf'] === 'number' && Number.isFinite(avail['catalogAsOf'])
        ? { catalogAsOf: avail['catalogAsOf'] }
        : {}),
    })
  }
  return out
}

/**
 * Where the clips-mode cards come from.
 *
 * `derived` is the app's own derivation — the timeline's clusters ∩
 * `recording.getAvailability` (`clips-from-clusters.ts`). `cap` is a read of
 * `videoclips.listClips` for ONE provider. Exactly one of them fills the body,
 * ever: that is the operator's *"mai mischiate provider diversi"*, and it is
 * also what keeps the two-clusterer defect shut (D569).
 */
export type ClipDerivation = 'derived' | 'cap'

export interface ClipProviderChoice {
  /** The source being looked at, or null while the camera's rows are unknown. */
  readonly sourceId: ClipSourceId | null
  /** The addon to pass as `listClips({provider})`. Null with `sourceId`. */
  readonly addonId: string | null
  readonly derivation: ClipDerivation
  /** The stored pick names a source this camera does not have. The surface says
   *  so; it never asks for it, because the cap refuses an unbound provider by
   *  name and a stale preference would otherwise be a permanent red timeline. */
  readonly chosenMissing: boolean
  /** The chosen row's own state and reason, carried so the surface can report
   *  a source that cannot answer without looking the row up again. */
  readonly state: ClipSourceState | null
  readonly reason?: string
}

export interface ResolveClipProviderInput {
  /** The per-camera stored pick — a SOURCE id. Absent = never chosen here. */
  readonly chosen?: string
  /** The camera's sources as `listSources` answered. Empty = not yet known. */
  readonly sources: readonly ClipSourceRow[]
}

function fromRow(row: ClipSourceRow, chosenMissing: boolean): ClipProviderChoice {
  return {
    sourceId: row.sourceId,
    addonId: row.addonId,
    derivation: row.sourceId === CLIP_PROVIDER_CAMSTACK_SOURCE ? 'derived' : 'cap',
    chosenMissing,
    state: row.state,
    ...(row.reason !== undefined ? { reason: row.reason } : {}),
  }
}

/**
 * Which source this camera's clip surface reads, and how.
 *
 * The default is CamStack, deliberately: absence must reproduce exactly what
 * the app drew before this setting existed, and *"di default va su camstack"*
 * is the operator's own word for it. A camera with no CamStack row falls to its
 * first source rather than to nothing — a camera full of onboard clips that
 * says "no clips" is the defect this whole line of work exists to end
 * (D554 4, D555).
 */
export function resolveClipProvider(input: ResolveClipProviderInput): ClipProviderChoice {
  const { chosen, sources } = input
  if (sources.length === 0) {
    // Nothing has answered. Keep drawing what we draw, and do not contradict a
    // stored pick we have no evidence against (D315).
    return { sourceId: null, addonId: null, derivation: 'derived', chosenMissing: false, state: null }
  }
  if (chosen !== undefined && chosen.length > 0) {
    const picked = sources.find((s) => s.sourceId === chosen)
    if (picked !== undefined) return fromRow(picked, false)
  }
  const fallback =
    sources.find((s) => s.sourceId === CLIP_PROVIDER_CAMSTACK_SOURCE) ?? sources[0]
  const missing = chosen !== undefined && chosen.length > 0
  return fromRow(fallback, missing)
}

/**
 * One row of the camera's clip-source picker.
 *
 * Deliberately not a rendered string: the source's own `reason` is the
 * provider's prose and travels verbatim, while the STATE gets an i18n key of
 * ours. A client that paraphrases a server's words drifts the first time one
 * changes (D563), and a state we render as prose could not be translated.
 */
export interface ClipSourceOption {
  /** The SOURCE id, which is what the per-camera pick stores. */
  readonly value: ClipSourceId
  /** The hub's own label for the source. Rendered as given. */
  readonly label: string
  /** i18n key naming why this source cannot answer, or null when it can. */
  readonly stateKey: string | null
  /** The source's own words, when it gave any. Verbatim, never parsed. */
  readonly detail?: string
}

const STATE_KEY: Readonly<Record<ClipSourceState, string | null>> = {
  ok: null,
  sleeping: 'v2.clips.sourceStateSleeping',
  unreachable: 'v2.clips.sourceStateUnreachable',
  'no-storage': 'v2.clips.sourceStateNoStorage',
  'index-empty': 'v2.clips.sourceStateIndexEmpty',
  unknown: 'v2.clips.sourceStateUnknown',
}

/**
 * The picker's rows.
 *
 * Every source the camera HAS, whichever one is being read — a source is never
 * hidden, only its clips (D557's kept property). An empty list is "nothing has
 * answered yet", not "this camera has no sources", so no row is invented for
 * it: the surface above says which, and the clips keep coming from wherever
 * they were coming from.
 */
export function clipSourcePickerOptions(
  sources: readonly ClipSourceRow[],
): readonly ClipSourceOption[] {
  return sources.map((row) => ({
    value: row.sourceId,
    label: row.label,
    stateKey: STATE_KEY[row.state],
    ...(row.reason !== undefined ? { detail: row.reason } : {}),
  }))
}
