/**
 * events-semantic — CLIP text search, as a PASSTHROUGH to the same cap method
 * the viewer's own search box calls.
 *
 * ## Why passthrough and not host-driven results
 *
 * The alternative was a documented "host supplies the trackIds" mode. It loses
 * on every axis that matters here:
 *
 *  - **Fan-out.** `searchObjectEvents` takes ONE optional `deviceId` and
 *    omitting it searches every camera, so the passthrough is a single request
 *    — the same economy the feed was designed around. A host-driven mode would
 *    hand the embed a list of ids it has not loaded, and the only way to render
 *    those is `getTrack` per id: exactly the per-camera fan-out that was
 *    removed from this surface.
 *  - **Divergence.** Two implementations of "what does this query match" drift.
 *    The viewer already normalises these rows (`toScoredResult`); a second
 *    normalisation in the host would have to re-derive it.
 *  - **Auth.** `searchObjectEvents` is `access: 'view'` — the same level as
 *    `listRecentTracks`, which the embed already calls with the token it holds.
 *    No new grant, no new surface.
 *
 * The one honest cost: a search hit is an EVENT, not a track. The scored row
 * carries everything a card needs (`deviceId`, `timestamp`, `className`, both
 * label tiers, `mediaId` (D482), `importance`) but NOT the track-only
 * aggregates — `zonesVisited`, `audioLabels`, `active`. Those render empty on
 * a search result rather than being faked from a second query, and the mode is
 * reported to the host (`countChanged.mode: 'semantic'`) so a caption can say
 * so.
 *
 * Pure. The request lives in `use-events-feed.ts`.
 */
import type { SearchObjectEventsInput } from './events-client.js'
import type { EventsSort } from './events-share-url.js'
import { compareRowsDesc, sortRows } from './events-feed'
import type { EventsTrackRow } from './events-track-row'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** What {@link semanticSearchRequest} reads off the page config. */
export interface SemanticSearchConfig {
  readonly semanticLimit: number
  readonly semanticMinScore?: number | undefined
  readonly sinceMs?: number | undefined
  readonly untilMs?: number | undefined
}

/**
 * The `searchObjectEvents` input for one query.
 *
 * `minScore` rides the request ONLY when the operator set one (`sscore`, a
 * share link, `setConfig`). Absent, the hub resolves the floor per embedding
 * MODEL (D649): SigLIP2 scores on another scale than MobileCLIP, so any number
 * this embed invented would suit one model and empty the other's results.
 *
 * ONE camera or ALL — the cap takes a single optional `deviceId` and omitting
 * it searches everything, so this stays one request.
 */
export function semanticSearchRequest(
  text: string,
  deviceIds: readonly number[],
  config: SemanticSearchConfig,
): SearchObjectEventsInput {
  const only = deviceIds.length === 1 ? deviceIds[0] : undefined
  return {
    text,
    limit: config.semanticLimit,
    ...(config.semanticMinScore !== undefined ? { minScore: config.semanticMinScore } : {}),
    ...(only !== undefined ? { deviceId: only } : {}),
    ...(config.sinceMs !== undefined ? { since: config.sinceMs } : {}),
    ...(config.untilMs !== undefined ? { until: config.untilMs } : {}),
  }
}

/**
 * Normalise ONE scored object event into the row shape the cards render.
 *
 * `bestEventId` is carried through as an OPAQUE informational pointer only —
 * `EventsCard` never addresses media through it (D482: it resolves the
 * thumbnail against `row.trackId`, the same owner form every other track
 * card uses). It still prefers the event's own `mediaId` when the server
 * reported one, else the track, else the event's own id — the same
 * precedence `Track.bestEventId` itself follows — so a host reading it off
 * the `trackList`/`trackClick` postMessage sees the same shape it always has.
 *
 * The track window collapses to the event's single timestamp: a search result
 * IS a moment, and inventing a duration from a row that does not carry one
 * would put a wrong number on the card.
 */
export function toSemanticRow(
  raw: unknown,
  nameById: ReadonlyMap<number, string>,
): (EventsTrackRow & { readonly score: number }) | null {
  if (!isRecord(raw)) return null
  const id = nonEmptyString(raw.id)
  const className = nonEmptyString(raw.className)
  if (id === undefined || className === undefined) return null
  if (typeof raw.deviceId !== 'number') return null
  if (typeof raw.timestamp !== 'number') return null
  if (typeof raw.score !== 'number') return null

  const trackId = nonEmptyString(raw.trackId)
  const mediaId = typeof raw.mediaId === 'number' ? String(raw.mediaId) : undefined
  const label = nonEmptyString(raw.label)
  const subLabel = nonEmptyString(raw.subLabel)

  return {
    // A hit with no trackId can still be shown and clicked; the host resolves
    // the detail by the id it is given, and the event id is what it has.
    trackId: trackId ?? id,
    deviceId: raw.deviceId,
    cameraName: nameById.get(raw.deviceId) ?? `Camera ${raw.deviceId}`,
    className,
    // No `title` is baked here: `resolveRowTitle` owns the rule, and the copy
    // that used to live on this line was the same untranslated fallback the
    // card had — one defect in two places.
    ...(label !== undefined ? { label } : {}),
    ...(subLabel !== undefined ? { subLabel } : {}),
    ...(typeof raw.importance === 'number' ? { importance: raw.importance } : {}),
    firstSeen: raw.timestamp,
    lastSeen: raw.timestamp,
    state: 'idle',
    active: false,
    // Track-only aggregates. Empty, not faked — see the module docblock.
    zonesVisited: [],
    zoneNames: [],
    classes: [className],
    audioLabels: [],
    bestEventId: mediaId ?? trackId ?? id,
    score: raw.score,
  }
}

/**
 * Normalise a whole response, DEDUPLICATED by track, best score wins.
 *
 * Without this one track shows up once per matching detection — a person who
 * walked across the frame is five hits of the same crop, which reads as five
 * events. Ordering is score DESC (the server's own), with the track's own time
 * order breaking ties so a burst of equal scores is at least chronological.
 */
export function toSemanticRows(
  raw: unknown,
  nameById: ReadonlyMap<number, string>,
): readonly EventsTrackRow[] {
  if (!Array.isArray(raw)) return []
  const best = new Map<string, EventsTrackRow & { score: number }>()
  for (const entry of raw) {
    const row = toSemanticRow(entry, nameById)
    if (row === null) continue
    const held = best.get(row.trackId)
    if (held === undefined || row.score > held.score) best.set(row.trackId, row)
  }
  return [...best.values()].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    return b.lastSeen - a.lastSeen
  })
}

/**
 * Union of the CLIP hits and the rows the SAME query matched as free text,
 * ORDERED the way the rest of the page is ordered.
 *
 * A CLIP query embeds IMAGES. It is structurally blind to every non-visual
 * thing a track knows — the audio labels, the zone names, a plate read, the
 * camera's own name — so a search box wired to it alone answers "nothing" for
 * a word that is written on the track. Measured on the live hub: `crying` is an
 * audio label on 92 tracks in 7 days, and `searchObjectEvents('crying')`
 * returned an unrelated person at score 0.22 as its top hit. The operator's
 * report was exactly that: `cry` finds nothing. So the two halves are unioned,
 * deduplicated by `trackId` — and the TEXT row wins a collision, because it is
 * a whole track (window, zones, audio labels) where the CLIP row is one event
 * with those aggregates deliberately empty.
 *
 * ## Why the order is chronological and not the score
 *
 * The hub ranks by cosine similarity and returns score DESC, and this function
 * used to render that order verbatim with the metadata matches stacked on top
 * of it. On screen that is a column of timestamps in no order at all: the card
 * shows a time and nothing shows a score, so a relevance ranking is invisible
 * and reads as a bug — which is exactly how the operator reported it.
 *
 * Relevance still decides WHICH rows come back: `searchObjectEvents` takes
 * `minScore` and `limit` and returns the top of the ranking. What it must not
 * also decide is the order they are shown in, because this surface already has
 * an ordering the operator chose (`sort`: newest / importance) and it stays
 * meaningful only if it governs every list the page draws — the feed, a text
 * filter, and a search result alike. The detail view's prev/next walks this
 * same order, which makes an unexplained one worse than merely odd.
 *
 * If a score is ever to be shown, it is on the CARD (`ScoredObjectEvent.score`
 * is already on the wire and `toSemanticRow` already reads it) — not smuggled
 * in as a hidden sort key.
 *
 * The text half can only ever cover the rows the feed has LOADED (it is a
 * client-side filter with no server query behind it), so this widens a semantic
 * search, it does not complete it.
 */
export function mergeSearchRows(
  semanticRows: readonly EventsTrackRow[],
  textRows: readonly EventsTrackRow[],
  sort: EventsSort,
): readonly EventsTrackRow[] {
  const byTrack = new Map<string, EventsTrackRow>()
  for (const row of semanticRows) byTrack.set(row.trackId, row)
  // Last write wins: the text row REPLACES the CLIP row for the same track.
  for (const row of textRows) byTrack.set(row.trackId, row)
  // The time order is established HERE rather than assumed: `sortRows('time')`
  // is a no-op by design (the feed arrives in the server's order), and handing
  // it a score-ranked array is precisely how the scrambled list happened.
  return sortRows([...byTrack.values()].sort(compareRowsDesc), sort)
}
