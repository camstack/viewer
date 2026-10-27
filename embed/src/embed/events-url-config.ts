/**
 * events-url-config — the QUERY-PARAM configuration source of the events embed.
 *
 * The v1 param set (all optional except the `v=1` gate):
 *
 *   /viewer/camstack/embed/index.html?mode=events&v=1
 *     &view=reel|gallery &rows=<1..6> &cols=auto|<1..12> &thumb=small|medium|large
 *     &devices=1,5,9 &classes=person,vehicle &attrs=face,plate &q=<text>
 *     &fields=label,sublabel,camera,time,badges,importance
 *     &tileLabelMode=off|icon|label&tileDetailCamera=0|1&tileDetailZone=0|1
 *     &page=<1..500> &max=<1..5000> &refresh=<ms> &age=<ms> &theme=auto|dark|light
 *     &smode=text|semantic &slimit=<1..200> &sscore=<0..1>
 *     &since=<ms> &until=<ms> &names=<id>:<name>,<id>:<name>
 *   #t=<token>
 *
 * Two distinct uses, and the difference is the TOKEN:
 *
 *  - {@link parseEventsUrlConfig} — a WHOLE config. Needs either a `#t=` token
 *    or a transport that authenticates for the page (see `transport-auth.ts`).
 *    `serverUrl` is the PREFIX the document itself was served under, not
 *    `location.origin`: behind Home Assistant's relay the bundle lives at
 *    `<ha>/api/camstack/p/<grant>/viewer/…`, and an origin-only base sends
 *    `/trpc` to Home Assistant, which knows nothing about it. This is the
 *    standalone / share-link / relayed-card case.
 *  - {@link parseEventsUrlPatch} — layout only, no credentials. A web host can
 *    put the look of the embed in the iframe `src` and hand the token over the
 *    `embed-ready` → `embed-config` channel; the patch is then applied ON TOP
 *    of the handshake config.
 *
 * The token rides the FRAGMENT, never the query string — same rule as the grid
 * share link (`share-url.ts`): a fragment is not sent to the server, so it
 * never lands in hub access logs, proxy logs or referrers. The browser wrappers
 * strip it from the address bar after reading.
 *
 * `v` gates parsing: an absent `v` means "this URL is not an events config"
 * (→ `null`, caller falls through), an unknown `v` is an explicit error rather
 * than a guess.
 */
import {
  applyEventsConfigPatch,
  DEFAULT_EVENTS_FIELDS,
  type EventsConfigPatch,
  type EventsConfigResult,
  type EventsFields,
  eventsConfigPatchSchema,
  parseEventsConfig,
} from './events-config'
import { VIEWER_EMBED_PATH } from '../../../shared/embed-path'
import { embedServerUrl, isTransportAuthenticated } from './transport-auth'

/** Version stamped into (`v=`) and required from every events config URL. */
export const EVENTS_URL_VERSION = 1

/** Server-hosted Viewer path of the embed bundle. */
export const EVENTS_EMBED_PATH = VIEWER_EMBED_PATH

/** Every field key `fields=` accepts, in render order. */
const FIELD_KEYS: readonly (keyof EventsFields)[] = [
  'label',
  'sublabel',
  'camera',
  'time',
  'badges',
  'importance',
]

function intParam(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key)
  if (raw === null || raw.trim() === '') return undefined
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : undefined
}

/** `1`/`true` -> on, `0`/`false` -> off, absent or anything else -> unset. */
function flagParam(params: URLSearchParams, key: string): boolean | undefined {
  const raw = params.get(key)?.trim().toLowerCase()
  if (raw === '1' || raw === 'true') return true
  if (raw === '0' || raw === 'false') return false
  return undefined
}

function csvNumbers(raw: string | null): number[] | undefined {
  if (raw === null) return undefined
  if (raw.trim() === '') return []
  const out: number[] = []
  for (const part of raw.split(',')) {
    const n = Number.parseInt(part.trim(), 10)
    if (Number.isFinite(n) && n >= 0) out.push(n)
  }
  return out
}

function csvStrings(raw: string | null): string[] | undefined {
  if (raw === null) return undefined
  if (raw.trim() === '') return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** `fields=` is an ALLOW-LIST: the keys present are on, everything else off.
 *  `fields=` (empty) therefore means "no text at all", which is a real ask for
 *  a dense contact sheet — and is why absence (`null`) must stay distinct. */
function fieldsParam(raw: string | null): Partial<EventsFields> | undefined {
  if (raw === null) return undefined
  const on = new Set((csvStrings(raw) ?? []).map((s) => s.toLowerCase()))
  const out: Partial<EventsFields> = {}
  for (const key of FIELD_KEYS) out[key] = on.has(key.toLowerCase())
  return out
}

/**
 * Read a query param's value WITHOUT percent-decoding it.
 *
 * `URLSearchParams.get()` decodes, and for a param whose value has internal
 * structure that is destructive: `names=102:Garage%2C%20retro` comes back as
 * `102:Garage, retro`, the encoded comma is now a REAL comma, and splitting on
 * ',' cuts the name in half. Found by the viewer author round-tripping his
 * encoder against this parser — `{"102":"Garage"}` plus a junk entry.
 *
 * Note that dropping the second `decodeURIComponent` would NOT have fixed it:
 * by then the separator is already indistinguishable from the data. The value
 * has to be read before any decoding happens, which is what this does.
 *
 * The contract stays SINGLE-encode (`encodeURIComponent` per name). The
 * alternative — asking every host to double-encode — would have broken on the
 * day this was fixed, and the viewer deliberately did not compensate.
 */
function rawQueryParam(search: string, key: string): string | null {
  const query = search.startsWith('?') ? search.slice(1) : search
  for (const pair of query.split('&')) {
    if (pair.length === 0) continue
    const eq = pair.indexOf('=')
    const name = eq === -1 ? pair : pair.slice(0, eq)
    if (name !== key) continue
    return eq === -1 ? '' : pair.slice(eq + 1)
  }
  return null
}

/**
 * `names=<id>:<name>,<id>:<name>` → the rename dictionary.
 *
 * Takes the RAW (still percent-encoded) value, so the structure survives:
 * split on ',' then on the FIRST ':' — both of which are `%2C` / `%3A` inside
 * a name and therefore cannot be confused with a separator — and decode each
 * name exactly once. A camera called "Garage, retro" or "Sala: TV" round-trips.
 *
 * An entry that is malformed is skipped rather than failing the whole link — a
 * bad rename must not cost the recipient the page.
 *
 * Empty (`names=`) is a valid EMPTY dictionary, which is how a share link says
 * "no renames" distinctly from not mentioning them at all.
 */
function namesParam(raw: string | null): Record<string, string> | undefined {
  if (raw === null) return undefined
  const out: Record<string, string> = {}
  if (raw.trim() === '') return out
  for (const entry of raw.split(',')) {
    const sep = entry.indexOf(':')
    if (sep <= 0) continue
    const id = entry.slice(0, sep).trim()
    if (!/^\d+$/.test(id)) continue
    let name: string
    try {
      name = decodeURIComponent(entry.slice(sep + 1))
    } catch {
      continue
    }
    if (name.trim().length === 0) continue
    out[id] = name
  }
  return out
}

/** Build the `names=` value from a dictionary. Exported so a link builder and
 *  the parser share one encoding — the round trip is unit-tested. */
export function encodeDeviceNames(names: Readonly<Record<string, string>>): string {
  return Object.entries(names)
    .filter(([id, name]) => /^\d+$/.test(id) && name.trim().length > 0)
    .map(([id, name]) => `${id}:${encodeURIComponent(name)}`)
    .join(',')
}

/** A window bound from the query: absent ⇒ undefined, empty ⇒ null (CLEAR),
 *  a number ⇒ that bound. Mirrors the patch's three-way semantics. */
function windowParam(params: URLSearchParams, key: string): number | null | undefined {
  const raw = params.get(key)
  if (raw === null) return undefined
  if (raw.trim() === '') return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function columnsParam(raw: string | null): 'auto' | number | undefined {
  if (raw === null || raw.trim() === '') return undefined
  if (raw === 'auto') return 'auto'
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : undefined
}

/** Read the `#t=<token>` fragment. Returns null when absent/empty. */
export function readTokenFragment(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (raw.length === 0) return null
  const token = new URLSearchParams(raw).get('t')
  return token !== null && token.length > 0 ? token : null
}

/**
 * Parse the v1 query params into a validated config PATCH (no credentials).
 *
 * Returns `null` when the URL carries no `v=` at all — the caller then treats
 * the URL as "not an events config" and falls through to its other sources.
 * An unknown version, or a param that fails validation, is a hard error.
 */
export function parseEventsUrlPatch(
  search: string,
):
  | { readonly ok: true; readonly patch: EventsConfigPatch }
  | { readonly ok: false; readonly error: string }
  | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const versionRaw = params.get('v')
  if (versionRaw === null) return null
  const version = Number.parseInt(versionRaw, 10)
  if (version !== EVENTS_URL_VERSION) {
    return { ok: false, error: `unsupported events URL version "${versionRaw}"` }
  }

  const candidate: Record<string, unknown> = {}
  const view = params.get('view')
  if (view !== null) candidate.view = view
  const rows = intParam(params, 'rows')
  if (rows !== undefined) candidate.rows = rows
  const columns = columnsParam(params.get('cols'))
  if (columns !== undefined) candidate.columns = columns
  const thumb = params.get('thumb')
  if (thumb !== null) candidate.thumbSize = thumb
  const fields = fieldsParam(params.get('fields'))
  if (fields !== undefined) candidate.fields = fields
  // The viewer's tile settings, by the viewer's names (`events-tile-display`).
  const labelMode = params.get('tileLabelMode')
  if (labelMode !== null) candidate.tileLabelMode = labelMode
  const detailCamera = flagParam(params, 'tileDetailCamera')
  if (detailCamera !== undefined) candidate.tileDetailCamera = detailCamera
  const detailZone = flagParam(params, 'tileDetailZone')
  if (detailZone !== undefined) candidate.tileDetailZone = detailZone
  const devices = csvNumbers(params.get('devices'))
  if (devices !== undefined) candidate.deviceIds = devices
  const classes = csvStrings(params.get('classes'))
  if (classes !== undefined) candidate.classes = classes
  const attrs = csvStrings(params.get('attrs'))
  if (attrs !== undefined) candidate.attrs = attrs
  const q = params.get('q')
  if (q !== null) candidate.search = q
  const page = intParam(params, 'page')
  if (page !== undefined) candidate.pageSize = page
  const max = intParam(params, 'max')
  if (max !== undefined) candidate.maxRows = max
  const refresh = intParam(params, 'refresh')
  if (refresh !== undefined) candidate.refreshMs = refresh
  const age = intParam(params, 'age')
  if (age !== undefined) candidate.maxAgeMs = age
  const theme = params.get('theme')
  if (theme !== null) candidate.theme = theme
  // `sort=` is NOT read: events are newest first, always. A link minted when
  // it asked for an importance order still opens — newest first.
  const smode = params.get('smode')
  if (smode !== null) candidate.searchMode = smode
  const slimit = intParam(params, 'slimit')
  if (slimit !== undefined) candidate.semanticLimit = slimit
  const sscore = params.get('sscore')
  if (sscore !== null && sscore.trim() !== '') {
    const n = Number.parseFloat(sscore)
    if (Number.isFinite(n)) candidate.semanticMinScore = n
  }
  // An empty `since=` / `until=` is an explicit CLEAR, exactly as a `null`
  // patch is — a share link that freezes "the rolling feed" must be able to say
  // so, and the absent case already means "leave the default alone".
  const since = windowParam(params, 'since')
  if (since !== undefined) candidate.sinceMs = since
  const until = windowParam(params, 'until')
  if (until !== undefined) candidate.untilMs = until
  // RAW, not `params.get('names')` — see `rawQueryParam`.
  const names = namesParam(rawQueryParam(search, 'names'))
  if (names !== undefined) candidate.deviceNames = names

  const parsed = eventsConfigPatchSchema.safeParse(candidate)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
    }
  }
  return { ok: true, patch: parsed.data }
}

/**
 * Parse a WHOLE config out of the URL (params + `#t=` token + origin).
 *
 * `null` when the URL is not an events config link at all. A `v=1` link WITHOUT
 * a token is not an error here either — a host may be supplying the token over
 * the iframe handshake and only the layout in the URL — so the caller decides:
 * standalone ⇒ "config global is not set", iframe ⇒ handshake + patch.
 */
export function parseEventsUrlConfig(
  search: string,
  hash: string,
  origin: string,
  pathname: string = '',
): EventsConfigResult | null {
  const patch = parseEventsUrlPatch(search)
  if (patch === null) return null
  if (!patch.ok) return { ok: false, error: patch.error }
  const serverUrl = embedServerUrl(origin, pathname, EVENTS_EMBED_PATH)
  const token = readTokenFragment(hash)
  // No `#t=`, but the page was served through a relay on its own origin: the
  // relay authenticates every forwarded request, so this IS a whole config —
  // the credential-less one. Home Assistant's cards take this path, and the
  // token they used to put in this fragment no longer leaves the integration.
  if (token === null && !isTransportAuthenticated(serverUrl)) return null
  return parseEventsConfig({
    serverUrl,
    ...(token !== null ? { token } : {}),
    fields: DEFAULT_EVENTS_FIELDS,
    ...patch.patch,
  })
}

/** Browser wrapper: read the URL config, then STRIP the `#t=` fragment via
 *  `history.replaceState` so the token never lingers in history. */
export function readEventsUrlConfig(): EventsConfigResult | null {
  const result = parseEventsUrlConfig(
    location.search,
    location.hash,
    location.origin,
    location.pathname,
  )
  if (result !== null && location.hash !== '') {
    history.replaceState(null, '', location.pathname + location.search)
  }
  return result
}

/** Browser wrapper for the layout-only patch (iframe host supplies the token). */
export function readEventsUrlPatch(): EventsConfigPatch | null {
  const parsed = parseEventsUrlPatch(location.search)
  if (parsed === null || !parsed.ok) return null
  return parsed.patch
}

/** Apply a URL patch on top of a handshake-supplied config. Exported so the
 *  precedence rule (`global > url-with-token > handshake + url-patch`) has ONE
 *  implementation and one test. */
export function mergeUrlPatch(
  result: EventsConfigResult,
  patch: EventsConfigPatch | null,
): EventsConfigResult {
  if (!result.ok || patch === null) return result
  return { ok: true, config: applyEventsConfigPatch(result.config, patch) }
}
