/**
 * events-share-url — the v1 URL contract of the EVENTS embed, encode side.
 *
 * A link is:
 *   <serverUrl>/viewer/camstack/embed/index.html?mode=events&v=1
 *     &view=reel|gallery &rows=<1..6> &cols=auto|<1..12> &thumb=small|medium|large
 *     &devices=1,5,9 &classes=person,vehicle &attrs=face,plate &q=<text>
 *     &fields=label,sublabel,camera,time,badges,importance
 *     &tileLabelMode=off|icon|label&tileDetailCamera=0|1&tileDetailZone=0|1
 *     &page=<1..500> &max=<1..5000> &refresh=<ms> &age=<ms> &theme=auto|dark|light
 *   #t=<token>
 *
 * The token rides the FRAGMENT, never the query string — same rule as the grid
 * share link: a fragment is not sent to the server, so it never reaches hub
 * access logs, proxy logs or referrers. `serverUrl` is not encoded at all: the
 * page derives it from `location.origin`, because the embed is always served by
 * the hub that owns the data.
 *
 * The decode side lives beside this module in `events-url-config.ts`
 * (`parseEventsUrlPatch`). This module only encodes, and every param name,
 * spelling and value format below is taken from that parser rather than from
 * prose. Two spellings that are easy to get wrong and are NOT the config field
 * names: `cols` (not `columns`), `thumb` (not `thumbSize`), `q` (not `search`),
 * `page` / `max` / `age` / `refresh` (not `pageSize` / `maxRows` / `maxAgeMs` /
 * `refreshMs`). Any change to the parser must be applied here in the same
 * change.
 *
 * `fields=` is an ALLOW-LIST: the keys present are on, everything else off. An
 * EMPTY `fields=` therefore means "images only" — a real ask for a dense
 * contact sheet — which is why an all-off record must still emit the parameter
 * rather than omit it.
 *
 * Pure: no window access, so the node-env suite covers it.
 */
import { z } from 'zod'
import { VIEWER_EMBED_PATH } from '../embed-path.js'
import { tileDisplayOverridesSchema } from './events-tile-display.js'

/** Version stamped into (`v=`) every events embed URL. The parser treats an
 *  absent `v` as "not an events config" and an unknown one as an error. */
export const EVENTS_URL_VERSION = 1

/** Hub data-plane path of the shared embed bundle. */
export const EVENTS_EMBED_PATH = VIEWER_EMBED_PATH

export const eventsViewSchema = z.enum(['reel', 'gallery'])
export type EventsView = z.infer<typeof eventsViewSchema>

export const eventsThumbSchema = z.enum(['small', 'medium', 'large'])
export type EventsThumb = z.infer<typeof eventsThumbSchema>

/** Feed ordering. `importance` sorts the LOADED rows client-side — it cannot
 *  be pushed into a query the cursor orders by `lastSeen`. Pair it with a day
 *  window for a stable top-N. */
export const eventsSortSchema = z.enum(['time', 'importance'])
export type EventsSort = z.infer<typeof eventsSortSchema>

/** `text` = instant client-side substring; `semantic` = a CLIP query that
 *  REPLACES the feed with score-ordered hits. */
export const eventsSearchModeSchema = z.enum(['text', 'semantic'])
export type EventsSearchMode = z.infer<typeof eventsSearchModeSchema>

/**
 * Per-track ATTRIBUTES the surface can filter by.
 *
 * Deliberately NOT members of `classes`. The event taxonomy refuses `face` and
 * `plate` as label tiers — a track CARRIES a face or a plate alongside whatever
 * class it is — so they are a second axis: the selected attributes OR together
 * and the axis ANDs with the class and text filters, which is what makes
 * "vehicles, on the driveway, with a plate" expressible.
 */
export const EVENTS_ATTRIBUTES = ['face', 'plate'] as const
export const eventsAttributeSchema = z.enum(EVENTS_ATTRIBUTES)
export type EventsAttribute = z.infer<typeof eventsAttributeSchema>

/** Narrow an arbitrary string to a known attribute id. */
export function isEventsAttribute(value: string): value is EventsAttribute {
  return (EVENTS_ATTRIBUTES as readonly string[]).includes(value)
}

/**
 * Track PROVENANCE — the hub's `TrackSource`, mirrored here because the embed
 * is a browser bundle and cannot import the server's types.
 *
 * `pipeline` is the spatial detection+tracking pipeline. Every OTHER value is
 * a SYNTHETIC projection: no positions, a single snapshot, no trajectory.
 *
 *  - `sensor` — a linked sensor/control device state change.
 *  - `audio`  — an audio event on the camera itself that was anomalous for
 *               THAT camera, loud, and heard while nothing visual happened.
 *
 * A THIRD axis, next to `classes` and {@link EVENTS_ATTRIBUTES}, and the
 * distinction is not cosmetic: a synthetic row's provenance is `source` and
 * never its class. `className` is the taxonomy kind it was projected as
 * (`audio`, `contact`, `doorbell`), which is why filtering by class could
 * never express "not the synthetic rows" — and why trying returned every one
 * of them for every selection.
 */
export const EVENTS_TRACK_SOURCES = ['pipeline', 'sensor', 'audio'] as const
export const eventsTrackSourceSchema = z.enum(EVENTS_TRACK_SOURCES)
export type EventsTrackSource = z.infer<typeof eventsTrackSourceSchema>

/** Narrow an arbitrary string to a known track source. */
export function isEventsTrackSource(value: string): value is EventsTrackSource {
  return (EVENTS_TRACK_SOURCES as readonly string[]).includes(value)
}

/**
 * The sources HIDDEN by default on a surface that has a filter control saying
 * so. Audio-only markers are the loud, low-information half of a busy day — a
 * camera hearing a dog while nothing is on screen — and they were burying the
 * passages the feed exists for. It is a DEFAULT, not a rule: the events page
 * shows the condition among its other filters and one tap undoes it.
 *
 * `sensor` is deliberately NOT here. A door opening is an event the operator
 * asked to see; only audio was reported as noise.
 */
export const EVENTS_DEFAULT_HIDDEN_SOURCES: readonly EventsTrackSource[] = ['audio']

export const eventsThemeSchema = z.enum(['auto', 'dark', 'light'])
export type EventsTheme = z.infer<typeof eventsThemeSchema>

/** Gallery column count: `auto` (fit to width) or a fixed 1..12. */
export const eventsColumnsSchema = z.union([z.literal('auto'), z.number().int().min(1).max(12)])
export type EventsColumns = z.infer<typeof eventsColumnsSchema>

/** Which text a card renders. Mirrors the embed's `eventsFieldsSchema`. */
export const eventsFieldsSchema = z.object({
  label: z.boolean(),
  sublabel: z.boolean(),
  camera: z.boolean(),
  time: z.boolean(),
  badges: z.boolean(),
  /** The `★nn` score pip. Off by default — see the embed's field doc. */
  importance: z.boolean(),
})
export type EventsFields = z.infer<typeof eventsFieldsSchema>

export const DEFAULT_EVENTS_FIELDS: EventsFields = Object.freeze({
  label: true,
  sublabel: false,
  camera: true,
  time: true,
  badges: true,
  importance: false,
})

/** Field keys in render order — also the order they are emitted in `fields=`. */
export const EVENTS_FIELD_KEYS: readonly (keyof EventsFields)[] = [
  'label',
  'sublabel',
  'camera',
  'time',
  'badges',
  'importance',
]

/**
 * Everything a link freezes besides the token.
 *
 * No order: an events link is newest first, always (operator, 2026-10-23). A
 * stored record that still carries a `sort` has it stripped by the schema.
 *
 * Bounds are the embed's own (`events-config.ts`): exceeding one is a link the
 * page would reject, so it is rejected here instead — a builder that emits an
 * unopenable URL is worse than one that refuses.
 */
export const eventsShareParamsSchema = z.object({
  view: eventsViewSchema,
  /** Reel only: how many rows the strip stacks. */
  rows: z.number().int().min(1).max(6).optional(),
  /** Gallery only. */
  columns: eventsColumnsSchema.optional(),
  thumb: eventsThumbSchema,
  /** EMPTY = every camera the token can see. */
  deviceIds: z.array(z.number().int().nonnegative()),
  /** EMPTY = every class. */
  classes: z.array(z.string()).optional(),
  /** EMPTY = no attribute narrowing. See {@link EVENTS_ATTRIBUTES}. */
  attrs: z.array(eventsAttributeSchema).optional(),
  search: z.string().optional(),
  searchMode: eventsSearchModeSchema.optional(),
  semanticLimit: z.number().int().min(1).max(200).optional(),
  semanticMinScore: z.number().min(0).max(1).optional(),
  /** Day window. Both bounds ride the REQUEST, so a day view never
   *  materialises a row outside its day. */
  sinceMs: z.number().int().nonnegative().optional(),
  untilMs: z.number().int().nonnegative().optional(),
  /** LOCAL renames the link should carry: `{ '<id>': '<name>' }`. */
  deviceNames: z.record(z.string(), z.string()).optional(),
  fields: eventsFieldsSchema,
  /** The viewer's own tile settings (`events-tile-display`). Omitted = the
   *  embed's defaults / the legacy `fields` flags decide. */
  ...tileDisplayOverridesSchema.shape,
  pageSize: z.number().int().min(1).max(500).optional(),
  maxRows: z.number().int().min(1).max(5000).optional(),
  refreshMs: z.number().int().min(0).max(600_000).optional(),
  maxAgeMs: z.number().int().min(60_000).optional(),
  theme: eventsThemeSchema,
})
export type EventsShareParams = z.infer<typeof eventsShareParamsSchema>

/** A sane starting point for the builder: a gallery of everything, all text on. */
export const DEFAULT_EVENTS_SHARE_PARAMS: EventsShareParams = Object.freeze({
  view: 'gallery',
  columns: 'auto',
  thumb: 'medium',
  deviceIds: [],
  fields: DEFAULT_EVENTS_FIELDS,
  theme: 'auto',
})

/**
 * The `names=` value for a rename dictionary: `<id>:<percent-encoded name>`
 * joined by commas.
 *
 * MIRROR of `encodeDeviceNames` in the adjacent `events-url-config.ts`,
 * which is where the matching PARSER lives. Each name is percent-encoded
 * INDIVIDUALLY so a camera called "Garage, retro" survives the comma split;
 * the id is plain. Entries with a non-numeric id or a blank name are dropped
 * here rather than emitted for the parser to skip.
 *
 * **Do not "fix" this by encoding twice.** As of 2026-08-08 the parser decodes
 * ONE TIME TOO MANY — it reads the value through `URLSearchParams.get()`, which
 * has already percent-decoded it, and then calls `decodeURIComponent` again —
 * so a name containing a comma arrives truncated (`Garage, retro` → `Garage`).
 * Double-encoding here would paper over that and break the day it is fixed.
 * This side encodes once, per the contract; the defect is reported and belongs
 * to `events-url-config.ts`.
 */
export function encodeDeviceNames(names: Readonly<Record<string, string>>): string {
  return Object.entries(names)
    .filter(([id, name]) => /^\d+$/.test(id) && name.trim().length > 0)
    .map(([id, name]) => `${id}:${encodeURIComponent(name)}`)
    .join(',')
}

/** The `fields=` csv for a record: the keys that are ON, in render order. May
 *  be the empty string — that is "images only", not "unset". */
export function encodeEventsFields(fields: EventsFields): string {
  return EVENTS_FIELD_KEYS.filter((key) => fields[key]).join(',')
}

/**
 * Serialize the v1 params into a query string (no leading `?`, no token).
 *
 * Hand-assembled rather than via `URLSearchParams` so csv commas stay literal —
 * every value is schema-constrained to URL-safe characters, except the free
 * text of `q=`, which IS encoded.
 *
 * Only `view`/`thumb`/`theme`/`fields` are unconditional. A parameter the
 * operator did not set is OMITTED rather than emitted at its default, so the
 * link stays readable and the embed's own defaults keep their meaning.
 */
export function encodeEventsShareQuery(params: EventsShareParams): string {
  const parts: string[] = [
    'mode=events',
    `v=${String(EVENTS_URL_VERSION)}`,
    `view=${params.view}`,
    `thumb=${params.thumb}`,
  ]
  if (params.view === 'reel' && params.rows !== undefined) parts.push(`rows=${String(params.rows)}`)
  if (params.view === 'gallery' && params.columns !== undefined) {
    parts.push(`cols=${params.columns === 'auto' ? 'auto' : String(params.columns)}`)
  }
  if (params.deviceIds.length > 0) parts.push(`devices=${params.deviceIds.join(',')}`)
  if (params.classes !== undefined && params.classes.length > 0) {
    parts.push(`classes=${params.classes.join(',')}`)
  }
  if (params.attrs !== undefined && params.attrs.length > 0) {
    parts.push(`attrs=${params.attrs.join(',')}`)
  }
  if (params.search !== undefined && params.search.trim().length > 0) {
    parts.push(`q=${encodeURIComponent(params.search.trim())}`)
  }
  if (params.searchMode !== undefined) parts.push(`smode=${params.searchMode}`)
  if (params.semanticLimit !== undefined) parts.push(`slimit=${String(params.semanticLimit)}`)
  if (params.semanticMinScore !== undefined) parts.push(`sscore=${String(params.semanticMinScore)}`)
  if (params.sinceMs !== undefined) parts.push(`since=${String(params.sinceMs)}`)
  if (params.untilMs !== undefined) parts.push(`until=${String(params.untilMs)}`)
  // Emitted whenever the caller supplies a dictionary — INCLUDING an empty one.
  // `names=` is a valid empty dictionary and says "no renames" distinctly from
  // not mentioning renames at all, exactly as `fields=` does.
  if (params.deviceNames !== undefined) {
    parts.push(`names=${encodeDeviceNames(params.deviceNames)}`)
  }
  // Always emitted: an all-off record is meaningful ("images only") and would
  // be read as "unset" if the parameter were dropped.
  parts.push(`fields=${encodeEventsFields(params.fields)}`)
  if (params.tileLabelMode !== undefined) parts.push(`tileLabelMode=${params.tileLabelMode}`)
  if (params.tileDetailCamera !== undefined) {
    parts.push(`tileDetailCamera=${params.tileDetailCamera ? '1' : '0'}`)
  }
  if (params.tileDetailZone !== undefined) {
    parts.push(`tileDetailZone=${params.tileDetailZone ? '1' : '0'}`)
  }
  if (params.pageSize !== undefined) parts.push(`page=${String(params.pageSize)}`)
  if (params.maxRows !== undefined) parts.push(`max=${String(params.maxRows)}`)
  if (params.refreshMs !== undefined) parts.push(`refresh=${String(params.refreshMs)}`)
  if (params.maxAgeMs !== undefined) parts.push(`age=${String(params.maxAgeMs)}`)
  parts.push(`theme=${params.theme}`)
  return parts.join('&')
}

/**
 * The full standalone link: embed path + query + `#t=` fragment.
 *
 * The token is `encodeURIComponent`-ed: it is opaque to us, and a stray `#` or
 * `&` in it would silently truncate the fragment.
 */
export function buildEventsShareUrl(
  serverUrl: string,
  params: EventsShareParams,
  token: string,
): string {
  const base = serverUrl.replace(/\/+$/, '')
  return `${base}${EVENTS_EMBED_PATH}?${encodeEventsShareQuery(params)}#t=${encodeURIComponent(token)}`
}

/**
 * The URL the IN-APP host loads. No `v=1` and no token: a native WebView gets
 * its whole config from the injected `window.__CAMSTACK_EVENTS__`, and a web
 * iframe from the `embed-ready` handshake. Emitting `v=1` here would make the
 * page treat the URL as a config source and reject it for having no token.
 */
export function buildEventsEmbedUrl(
  serverUrl: string,
  params?: { readonly cacheBust?: string },
): string {
  const base = serverUrl.replace(/\/+$/, '')
  const cb = params?.cacheBust
  return `${base}${EVENTS_EMBED_PATH}?mode=events${cb ? `&_cb=${encodeURIComponent(cb)}` : ''}`
}
