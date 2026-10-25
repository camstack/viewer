/**
 * events-config — the configuration contract of the EVENTS embed
 * (`/viewer/camstack/embed/index.html?mode=events`).
 *
 * Same three-source model as the grid embed (see `host-bridge.ts`):
 *   1. native WebView  → `window.__CAMSTACK_EVENTS__` injected before load;
 *   2. browser iframe  → the `embed-ready` → `embed-config` handshake;
 *   3. standalone/URL  → query params + `#t=<token>` (see `events-url-config.ts`).
 *
 * Everything except `serverUrl` / `token` has a default, so a host that only
 * knows the two mandatory fields gets a working reel. Every field is also
 * patchable at runtime — `applyEventsConfigPatch` is the ONE place a partial
 * host patch is merged, so a `setConfig` command and the initial parse can
 * never disagree about what a field means.
 *
 * Pure: no window access except {@link readEventsConfig}, which is the thin
 * reader the page passes to `useEmbedConfig`.
 */
import { z } from 'zod'
import { eventsLabelsSchema } from '../../../shared/events/events-labels'
import { eventsAttributeSchema, eventsTrackSourceSchema } from '../../../shared/events/events-share-url'
import { REEL_LIST_PADDING_V } from '../../../shared/events/events-reel-geometry'
import { requireTokenUnlessTransportAuthenticated } from './transport-auth'

export { REEL_LIST_PADDING_V }
import {
  DEFAULT_EVENTS_MAX_AGE_MS,
  DEFAULT_EVENTS_MAX_ROWS,
  DEFAULT_EVENTS_PAGE_SIZE,
  REEL_EVENTS_MAX_ROWS,
} from '../../../shared/events/events-feed-limits'

export {
  DEFAULT_EVENTS_MAX_AGE_MS,
  DEFAULT_EVENTS_MAX_ROWS,
  DEFAULT_EVENTS_PAGE_SIZE,
  REEL_EVENTS_MAX_ROWS,
}

/** Layout family. `reel` = compact horizontally-scrolling strip (the viewer's
 *  "Recent" reel); `gallery` = full vertically-scrolling grid (the events page). */
export const eventsViewSchema = z.enum(['reel', 'gallery'])
export type EventsView = z.infer<typeof eventsViewSchema>

/** Thumbnail scale. Resolved to a server-side square edge by
 *  {@link thumbEdgePx} — the media plane clamps to [64, 320]. */
export const eventsThumbSizeSchema = z.enum(['small', 'medium', 'large'])
export type EventsThumbSize = z.infer<typeof eventsThumbSizeSchema>

/** Colour scheme. `auto` follows the host's `prefers-color-scheme`. */
export const eventsThemeSchema = z.enum(['auto', 'dark', 'light'])
export type EventsTheme = z.infer<typeof eventsThemeSchema>

/**
 * WHICH fields a card renders. Every flag is independent — a host that wants a
 * bare contact sheet turns them all off and still gets the images.
 *
 *  - `label`    — the chips over the thumbnail: the class glyph and the finest
 *                 SHORT thing known (`resolveRowTitle` — a sensor's translated
 *                 TYPE, an identity, or the translated sub-class / class). Not
 *                 a sensor's whole device name: that covered the image, and it
 *                 belongs to the detail.
 *  - `sublabel` — the secondary line: the detection class when the title is not
 *                 already the class, else the audio labels.
 *  - `camera`   — the producing camera (or the linked sensor device) name.
 *  - `time`     — the clock / relative time of `lastSeen`.
 *  - `badges`   — zone chips and the active dot. Admin flag pills (D/T/✓)
 *                 are a separate `showAdminFlags` switch — they are not a
 *                 display preference.
 *  - `importance` — the `★nn` key-event score pip (gallery only). OFF unless
 *                 the host asks for it: the score is a diagnostic, not
 *                 something an operator reads on every tile. A host built
 *                 before this flag existed never sends it, and gets it off.
 */
export const eventsFieldsSchema = z.object({
  label: z.boolean(),
  sublabel: z.boolean(),
  camera: z.boolean(),
  time: z.boolean(),
  badges: z.boolean(),
  importance: z.boolean().default(false),
})
export type EventsFields = z.infer<typeof eventsFieldsSchema>

/** The PATCH shape of `fields`: every key optional and NONE defaulted — a
 *  default here would rewrite a key the patch never mentioned (Zod applies a
 *  default inside `.partial()`), so toggling `badges` would reset
 *  `importance`. */
export const eventsFieldsPatchSchema = z.object({
  label: z.boolean().optional(),
  sublabel: z.boolean().optional(),
  camera: z.boolean().optional(),
  time: z.boolean().optional(),
  badges: z.boolean().optional(),
  importance: z.boolean().optional(),
})

export const DEFAULT_EVENTS_FIELDS: EventsFields = {
  label: true,
  sublabel: true,
  camera: true,
  time: true,
  badges: true,
  importance: false,
}

/*
 * There is no ordering knob: the feed is newest first, always — the server's
 * own order (`lastSeen` DESC, `trackId` DESC), the one pagination walks. A
 * `sort` from an older host or an old link is not a key of either schema
 * below, so Zod drops it and the page keeps that order (operator, 2026-10-23).
 */

/**
 * What the `search` string means.
 *
 *  - `text` — a client-side substring over the loaded rows (instant, no
 *    round-trip, and it can only ever narrow what is already on screen).
 *  - `semantic` — CLIP text→image search through
 *    `pipelineAnalytics.searchObjectEvents`. A SERVER query over the whole
 *    history in the window, so it can surface rows the feed never paged to.
 *    Results replace the feed and are ordered by score.
 */
export const eventsSearchModeSchema = z.enum(['text', 'semantic'])
export type EventsSearchMode = z.infer<typeof eventsSearchModeSchema>

/** Column count for the gallery: `auto` (fit to width) or a fixed count. */
export const eventsColumnsSchema = z.union([z.literal('auto'), z.number().int().min(1).max(12)])
export type EventsColumns = z.infer<typeof eventsColumnsSchema>




/**
 * The row ceiling actually in force for a config, given how its view RENDERS.
 *
 * The gallery gets `maxRows` verbatim. The reel is clamped: it mounts every
 * card, so a host that raises the limit there (or simply inherits the gallery's
 * default) would be asking a strip to hold thousands of live DOM nodes. The
 * clamp is not silent — the reel's tail draws `tail-more`, exactly as the
 * gallery's used to.
 */
export function resolveMaxRows(config: Pick<EventsConfig, 'view' | 'maxRows'>): number {
  return config.view === 'reel' ? Math.min(config.maxRows, REEL_EVENTS_MAX_ROWS) : config.maxRows
}

/** Default incremental-refresh cadence. 0 disables polling entirely — the
 *  host's `pipeline-analytics.track-lifecycle` subscription is the mechanism;
 *  a non-zero value is an optional D8 backstop the operator can still set. */
export const DEFAULT_EVENTS_REFRESH_MS = 0


export const eventsConfigSchema = z.object({
  /** Hub base URL the SDK client and the media plane are addressed against. */
  serverUrl: z.string().min(1),
  /** Bearer token. Used for tRPC AND for the authenticated media fetches — the
   *  media data-plane cannot be reached from an `<img src>` without it.
   *
   *  OPTIONAL only in the transport-authenticated case: a `serverUrl` that is a
   *  same-origin PATH means a relay on this page's own origin injects the
   *  credential server-side, so a copy in the browser is exposure with no
   *  purpose — it used to ride the events iframe's `#t=` fragment straight into
   *  browser history. See `transport-auth.ts`. An ABSOLUTE `serverUrl` is a
   *  direct hub address and still requires it (refinement below). */
  token: z.string().min(1).optional(),
  view: eventsViewSchema.default('reel'),
  /** Reel only: how many rows the horizontal strip stacks. */
  rows: z.number().int().min(1).max(6).default(1),
  /** Gallery only: column count, or `auto`. */
  columns: eventsColumnsSchema.default('auto'),
  thumbSize: eventsThumbSizeSchema.default('medium'),
  fields: eventsFieldsSchema.default(DEFAULT_EVENTS_FIELDS),
  /** Cameras to merge. EMPTY = every camera the token can see (resolved once
   *  from `deviceManager.listAll`). */
  deviceIds: z.array(z.number().int().nonnegative()).default([]),
  /** Class ids to keep (client-side over the loaded window). EMPTY = all. */
  classes: z.array(z.string()).default([]),
  /**
   * Per-track ATTRIBUTES to keep — `face` / `plate`. EMPTY = all.
   *
   * A sibling of `classes`, not a member of it: the event taxonomy refuses
   * `face` and `plate` as kinds (a track carries them ALONGSIDE whatever class
   * it is), so they get their own axis. Selected attributes OR together;
   * the axis ANDs with `classes` and `search`. An unknown token is dropped
   * rather than failing the whole config — a newer host must not blank an
   * older embed.
   */
  attrs: z.array(eventsAttributeSchema).catch([]).default([]),
  /**
   * Host-side camera RENAMES, `deviceId → name`.
   *
   * The viewer lets an operator rename a camera locally; that override is
   * client-side and the hub has never heard of it, so an embed rendering the
   * server's names silently disagrees with every other surface in the app.
   * When a key is present it WINS over the server name; anything absent falls
   * back, so a partial dictionary is fine and an empty one is a no-op.
   *
   * Keyed by the id as a STRING because this crosses `JSON.stringify` on both
   * transports (injected global and postMessage), where numeric object keys do
   * not survive as numbers.
   *
   * Applies to the CAMERA name. A synthetic track's `producingDeviceName` is a
   * different device's label that arrives on the row without an id, so it is
   * left alone rather than guessed at.
   */
  deviceNames: z.record(z.string(), z.string()).default({}),
  /**
   * The event taxonomy, ALREADY TRANSLATED by the host: `kind → label`.
   *
   * Same reason as `strings` below, for the other half of the text on a card.
   * A track carries taxonomy IDS (`car`, `contact`) and the hub's own labels
   * are English; the embed has no i18n, so without this dictionary an Italian
   * app rendered `Car` on every vehicle tile. The host builds it from
   * `pipelineAnalytics.listEventKinds` + its own `t()` (see the viewer's
   * `kind-labels.ts`) and re-sends it when the language changes.
   *
   * Applies to the detection CLASS and the tier-1 sub-class — and so to a
   * SYNTHETIC row's title, whose `className` is the sensor's event kind. A
   * tier-2 value — a recognised face, a plate — is a proper noun and is
   * rendered verbatim; see `resolveRowTitle`. Device NAMES are not in here
   * either: the camera's rides `deviceNames`, keyed by id, and a sensor's
   * arrives on the row.
   *
   * Deliberately NOT part of the share URL: a link is handed to someone else,
   * whose language is not the sender's.
   */
  kindLabels: z.record(z.string(), z.string()).default({}),
  /**
   * The surface's OWN words, ALREADY TRANSLATED by the host — the pills a card
   * draws for itself (`favourite`, `active`, the D/T/✓ flags, the "?" face
   * chip) and the tail placeholder's accessible name. See `events-labels.ts`.
   *
   * Same reason as `kindLabels` above, for the text a row does not carry: the
   * embed has no i18n, so without this dictionary an Italian gallery shows
   * `favourite` in a tooltip. The host builds it from `locales/` and its own
   * `t()` (see the viewer's `events-labels.ts`) and re-sends it when the
   * language changes.
   *
   * Empty ⇒ the English that ships (`DEFAULT_EVENTS_LABELS`), merged PER LABEL.
   * That is the whole compatibility story: an older host, or an external iframe
   * writing its own config, draws exactly the card it drew before this field
   * existed.
   *
   * Deliberately NOT part of the share URL, for the same reason as
   * `kindLabels`: a link is handed to someone else, whose language is not the
   * sender's.
   */
  labels: eventsLabelsSchema.default({}),
  /**
   * User-facing copy, so a LOCALISED host can localise it.
   *
   * The embed has no i18n of its own and its host does — leaving it to ship
   * English into an Italian app is how a surface ends up half-translated. The
   * defaults stay English; anything the host sets wins.
   *
   * This is also the fix for the other half of that problem: the error state
   * used to render the raw transport message (`Network request failed`,
   * `FORBIDDEN: …`). A technical string is not copy — the real reason still
   * goes to the host on the `state` message and the log channel.
   */
  strings: z
    .object({
      empty: z.string().optional(),
      emptyFiltered: z.string().optional(),
      error: z.string().optional(),
      retry: z.string().optional(),
      end: z.string().optional(),
      loadOlder: z.string().optional(),
    })
    .default({}),
  /** Free-text contains over title / class / camera / audio labels, or the
   *  CLIP query when `searchMode` is `semantic`. */
  search: z.string().default(''),
  searchMode: eventsSearchModeSchema.default('text'),
  /** Max CLIP hits requested per query. */
  semanticLimit: z.number().int().min(1).max(200).default(50),
  /**
   * CLIP cosine floor; hits below it are not returned at all. ABSENT = the
   * hub's per-MODEL default (D649), and the request then carries no
   * `minScore`. Never defaulted here: a SigLIP2 score lives on another scale
   * than MobileCLIP's (its floor is ~0.1, MobileCLIP's 0.2), so a number the
   * embed made up would be right for one model and silently empty for the
   * other. Only an operator's explicit `sscore` / `setConfig` sets it.
   */
  semanticMinScore: z.number().min(0).max(1).optional(),
  /**
   * Operator-flag chips from the host filter sheet. All-false = no narrowing.
   * Several-true OR together. Independent of `attrs` / `classes`.
   */
  filterDebug: z.boolean().default(false),
  filterTrain: z.boolean().default(false),
  filterFavourited: z.boolean().default(false),
  /** Parked (stationary-promoted) rows. Default off. Rides `includeStationary`
   *  on `listRecentTracks` — not a client-side hide. */
  showStationary: z.boolean().default(false),
  /**
   * Track SOURCES to leave out. EMPTY (the default) hides nothing — the HOST
   * owns the default, because the host is what shows the operator the
   * condition and lets them undo it. A page nobody can ask about must not
   * quietly narrow itself.
   *
   * Rides `excludeSources` on `listRecentTracks`, so the rows never arrive and
   * paging tells the truth about how much is left. It is ALSO applied to the
   * loaded rows: a hub too old for the parameter drops it silently (Zod strips
   * unknown keys), and a filter chip that says "audio hidden" over a list full
   * of audio is worse than no chip. Server-narrowed, client-exact — the same
   * division of labour the zone and class filters use.
   */
  excludeSources: z.array(eventsTrackSourceSchema).default([]),

  /** Track ids this client has marked analyzed. Debug chip + export hide them. */
  reviewedTrackIds: z.array(z.string()).default([]),
  /**
   * D/T/✓ pills on the thumbnail. Favourite ★ is always shown when the row
   * is favourited. Default OFF so a share URL / non-admin host never leaks
   * operator diagnostics onto a public tile.
   */
  showAdminFlags: z.boolean().default(false),
  /**
   * Explicit window on `lastSeen`, for day navigation.
   *
   * Both bounds ride the REQUEST (`since` / `until` on `listRecentTracks`), so
   * a day view never materialises a row outside its day and then hides it.
   * Absent ⇒ the rolling behaviour: anchored at mount, floored by `maxAgeMs`.
   *
   * A closed window that ends in the PAST also stops the incremental poll —
   * there is nothing newer inside it, and polling a finished day forever is
   * how a "live" feed burns a query a minute saying nothing.
   */
  sinceMs: z.number().int().nonnegative().optional(),
  untilMs: z.number().int().nonnegative().optional(),
  pageSize: z.number().int().min(1).max(500).default(DEFAULT_EVENTS_PAGE_SIZE),
  maxRows: z.number().int().min(1).max(5000).default(DEFAULT_EVENTS_MAX_ROWS),
  refreshMs: z.number().int().min(0).max(600_000).default(DEFAULT_EVENTS_REFRESH_MS),
  maxAgeMs: z.number().int().min(60_000).default(DEFAULT_EVENTS_MAX_AGE_MS),
  theme: eventsThemeSchema.default('auto'),
  /**
   * The HOST draws the pull-to-refresh gesture (a native `RefreshControl`
   * above the WebView). When true the embed's internal overscroll gesture
   * stands down — two overlapping pull gestures is worse than either alone —
   * and the page starts reporting `scroll` at-top transitions so the host can
   * arm its control only when a pull cannot steal a mid-list scroll. A web
   * iframe host never sets this and keeps the internal gesture.
   */
  nativePullToRefresh: z.boolean().default(false),
}).superRefine(requireTokenUnlessTransportAuthenticated)
export type EventsConfig = z.infer<typeof eventsConfigSchema>

export type EventsConfigResult =
  | { readonly ok: true; readonly config: EventsConfig }
  | { readonly ok: false; readonly error: string }

/**
 * Runtime patch shape — every configurable field, all optional. `serverUrl` and
 * `token` are deliberately ABSENT: swapping the identity of a mounted embed is
 * a remount, not a patch (the SDK client and every cached media blob URL are
 * built from them).
 */
export const eventsConfigPatchSchema = z.object({
  view: eventsViewSchema.optional(),
  rows: z.number().int().min(1).max(6).optional(),
  columns: eventsColumnsSchema.optional(),
  thumbSize: eventsThumbSizeSchema.optional(),
  fields: eventsFieldsPatchSchema.optional(),
  deviceIds: z.array(z.number().int().nonnegative()).optional(),
  classes: z.array(z.string()).optional(),
  /** See the config field. Replaces the whole selection, never merged. */
  attrs: z.array(eventsAttributeSchema).optional(),
  /** Replaces the whole dictionary (not merged) — a rename REMOVED on the host
   *  must be able to disappear here, which a merge could never express. */
  deviceNames: z.record(z.string(), z.string()).optional(),
  /** See the config field. Replaced whole, and re-sent on a language switch —
   *  that is the event this patch exists for. */
  kindLabels: z.record(z.string(), z.string()).optional(),
  /** See the config field. Replaced whole, and re-sent on a language switch —
   *  that is the event this patch exists for. A host that sends none leaves the
   *  page on the words it booted with. */
  labels: eventsLabelsSchema.optional(),
  strings: z
    .object({
      empty: z.string().optional(),
      emptyFiltered: z.string().optional(),
      error: z.string().optional(),
      retry: z.string().optional(),
      end: z.string().optional(),
      loadOlder: z.string().optional(),
    })
    .optional(),
  search: z.string().optional(),
  searchMode: eventsSearchModeSchema.optional(),
  semanticLimit: z.number().int().min(1).max(200).optional(),
  /** `null` UNSETS it — the request then carries no `minScore` and the hub
   *  applies its per-model default (D649). `undefined` leaves it alone. */
  semanticMinScore: z.number().min(0).max(1).nullable().optional(),
  filterDebug: z.boolean().optional(),
  filterTrain: z.boolean().optional(),
  filterFavourited: z.boolean().optional(),
  showStationary: z.boolean().optional(),
  /** See the config field. Replaces the whole list, never merged. */
  excludeSources: z.array(eventsTrackSourceSchema).optional(),
  reviewedTrackIds: z.array(z.string()).optional(),
  showAdminFlags: z.boolean().optional(),
  /** `null` CLEARS the bound (back to rolling). `undefined` leaves it alone —
   *  the distinction is the whole point of a day-navigation patch. */
  sinceMs: z.number().int().nonnegative().nullable().optional(),
  untilMs: z.number().int().nonnegative().nullable().optional(),
  pageSize: z.number().int().min(1).max(500).optional(),
  maxRows: z.number().int().min(1).max(5000).optional(),
  refreshMs: z.number().int().min(0).max(600_000).optional(),
  maxAgeMs: z.number().int().min(60_000).optional(),
  theme: eventsThemeSchema.optional(),
  /** See the config field. Pushed by the NATIVE host once the loaded embed
   *  advertises `native-pull-refresh`. */
  nativePullToRefresh: z.boolean().optional(),
})
export type EventsConfigPatch = z.infer<typeof eventsConfigPatchSchema>

/**
 * Card edge in CSS px — **the native reel's own numbers**, not an approximation.
 *
 * The host reserves a fixed strip height for the reel
 * (`reelRowHeight(cardWidth)` in the viewer: `cardWidth + 8`), sized from THIS
 * scale.
 *
 * Source of truth: `REEL_THUMB_SIZE_PX` in the viewer's `settings-store.ts`
 * (`small: 60, medium: 80, large: 106`). Read, not estimated.
 */
export function cardEdgePx(size: EventsThumbSize): number {
  if (size === 'small') return 60
  if (size === 'large') return 106
  return 80
}

/**
 * Square edge (px) to REQUEST from the media plane for a card edge.
 *
 * The card is measured in CSS px; the pixels are physical. Asking for the CSS
 * edge on a 2x display renders a half-resolution tile — visibly soft, and the
 * whole point of a server-side square is that it arrives at the size it is
 * shown. So the ask is `cardEdge × devicePixelRatio`, clamped to the plane's
 * own [64, 320] (mirrored, so one rendering is never two cache entries).
 *
 * `dpr` is a parameter, not `window.devicePixelRatio` read here, so the rule is
 * pure and the WebView's real ratio is measured by the caller rather than
 * assumed. At 1x the small tile asks 80 (clamped up to 64's floor is moot);
 * at 2x, 160; at 3x the large tile asks 396 and is clamped to 320.
 */
export function thumbEdgePx(size: EventsThumbSize, dpr = 1): number {
  return thumbEdgeForCardPx(cardEdgePx(size), dpr)
}

/** {@link thumbEdgePx} for a card edge that was COMPUTED rather than read off a
 *  preset — the desktop reel sizes its cards from the box it was given. */
export function thumbEdgeForCardPx(cardEdge: number, dpr = 1): number {
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  const wanted = Math.round(cardEdge * scale)
  return Math.max(THUMB_MIN_EDGE_PX, Math.min(THUMB_MAX_EDGE_PX, wanted))
}

/** The event-media plane's own clamp on `?size=`. Mirrored here so the ask is
 *  never a size the server will silently change. */
export const THUMB_MIN_EDGE_PX = 64
export const THUMB_MAX_EDGE_PX = 320

/** Fixed height of one reel card inside the padded scrolling strip. */
export function reelCardHeightPx(size: EventsThumbSize): number {
  return cardEdgePx(size)
}

/**
 * The strip height the HOST reserves for a reel row. Mirrors
 * `reelRowHeight(cardWidth)` in the viewer — the embed lays itself out to fit
 * this exactly, because the host sizes the iframe/WebView from it and anything
 * taller is silently cut.
 */
export function reelRowHeightPx(size: EventsThumbSize): number {
  return reelCardHeightPx(size) + REEL_LIST_PADDING_V * 2
}

/** Validate an untrusted config object. Pure — used by the tests, the global
 *  reader and the URL reader alike. */
export function parseEventsConfig(raw: unknown): EventsConfigResult {
  if (raw === undefined || raw === null) return { ok: false, error: 'config is required' }
  const parsed = eventsConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
    }
  }
  return { ok: true, config: parsed.data }
}

/**
 * Merge a validated runtime patch onto a config. IMMUTABLE — returns a new
 * object; `fields` is merged key-by-key so a host toggling one badge does not
 * have to resend the whole record.
 */
export function applyEventsConfigPatch(
  config: EventsConfig,
  patch: EventsConfigPatch,
): EventsConfig {
  const fields: EventsFields =
    patch.fields !== undefined ? { ...config.fields, ...patch.fields } : config.fields
  // The window bounds are rebuilt, never spread.
  //
  // `null` means CLEAR, and a cleared bound must be genuinely ABSENT — the
  // request builder tests `!== undefined`, so a lingering `null` would be sent
  // to the server as a bound. Spreading a `{}` over a base that still carried
  // the old value did exactly nothing, which is why BOTH the config and the
  // patch are destructured before the result is assembled.
  //
  // `semanticMinScore` follows the same three-way rule: `null` unsets the
  // operator's floor, and the request builder then sends no `minScore` at all.
  const { sinceMs: patchedSince, untilMs: patchedUntil, semanticMinScore: patchedScore, ...rest } = patch
  const { sinceMs: currentSince, untilMs: currentUntil, semanticMinScore: currentScore, ...base } = config
  const nextSince = resolveClearable(patchedSince, currentSince)
  const nextUntil = resolveClearable(patchedUntil, currentUntil)
  const nextScore = resolveClearable(patchedScore, currentScore)
  return {
    ...base,
    ...rest,
    fields,
    ...(nextSince !== undefined ? { sinceMs: nextSince } : {}),
    ...(nextUntil !== undefined ? { untilMs: nextUntil } : {}),
    ...(nextScore !== undefined ? { semanticMinScore: nextScore } : {}),
  }
}

/** One clearable number after a patch: `undefined` KEEPS the current value,
 *  `null` CLEARS it, a number replaces it. The three cases are distinct on
 *  purpose — day navigation needs "go back to rolling" and "leave this alone"
 *  to differ, and so does "back to the hub's score floor". */
function resolveClearable(
  patched: number | null | undefined,
  current: number | undefined,
): number | undefined {
  if (patched === null) return undefined
  return patched ?? current
}

/** Read + validate `window.__CAMSTACK_EVENTS__` (set by a native host before load). */
export function readEventsConfig(): EventsConfigResult {
  const raw = (window as unknown as { __CAMSTACK_EVENTS__?: unknown }).__CAMSTACK_EVENTS__
  if (raw === undefined || raw === null) {
    return { ok: false, error: 'window.__CAMSTACK_EVENTS__ is not set' }
  }
  return parseEventsConfig(raw)
}

/**
 * The name to render for a camera: the host's local rename when it has one,
 * else the server's. ONE implementation, so the card, the search results and
 * the free-text haystack cannot disagree about what a camera is called.
 */
export function resolveDeviceName(
  deviceId: number,
  serverName: string,
  overrides: Readonly<Record<string, string>>,
): string {
  const override = overrides[String(deviceId)]
  return override !== undefined && override.trim().length > 0 ? override : serverName
}

/** The copy actually rendered: the host's override, else the English default. */
export const DEFAULT_EVENTS_STRINGS = {
  empty: 'No events',
  /** The other empty: the feed HAS rows and the filters kept none of them.
   *  Deliberately not `empty` — "this camera was quiet" and "nothing here
   *  matches what you asked for" are different sentences, and only one of them
   *  is about something the operator can undo. */
  emptyFiltered: 'No events match this filter',
  error: "Couldn't load events",
  retry: 'Retry',
  end: '·',
  /** The CEILING tail. Deliberately not `end`: the feed has more, this client
   *  stopped holding it, and the two must never read the same. */
  loadOlder: 'Load older events',
} as const

export type EventsStringKey = keyof typeof DEFAULT_EVENTS_STRINGS

export function eventsString(config: Pick<EventsConfig, 'strings'>, key: EventsStringKey): string {
  const override = config.strings[key]
  return override !== undefined && override.trim().length > 0
    ? override
    : DEFAULT_EVENTS_STRINGS[key]
}
