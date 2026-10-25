/**
 * Page↔host message contract for the grid embed. Mirrors the server's
 * `grid-messages` (stream-broker embed). Pure — unit-tested.
 *
 * - `parseGridHostMessage`: validate an inbound `WebView.onMessage` / iframe
 *   postMessage payload (page → host).
 * - `gridCommandScript`: build the `injectJavaScript` string that drives the
 *   page's `window.__camstackGrid` command API (host → page).
 */
import type { GridQuality, GridLayout } from '../store/grid-store.js'
import type { GridHighlightEmbedConfig, TileOverlayEmbedConfig } from './embed-config.js'

/** A tile's pixel rect in the WebView viewport (CSS px). */
export interface TileRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export type GridReportState = 'connecting' | 'ready' | 'error'

export type GridHostMessage =
  | {
      readonly type: 'state'
      readonly state: GridReportState
      readonly message?: string
      /**
       * The host→page commands THIS page implements, sent with `ready`.
       *
       * Absent means "an older page that never said" — see
       * {@link GRID_HOT_DEVICES_COMMAND}. Every other command in this protocol
       * degrades to a wrong OPTION when a page does not know it; a device set
       * that fails to arrive leaves the wall showing the wrong CAMERAS, so that
       * one is the one the host must not guess about.
       */
      readonly commands?: readonly string[]
    }
  | { readonly type: 'tileTap'; readonly deviceId: number; readonly rect: TileRect }
  | { readonly type: 'tileLongPress'; readonly deviceId: number; readonly rect: TileRect }
  | { readonly type: 'tileOpen'; readonly deviceId: number }
  | { readonly type: 'audioToggle'; readonly deviceId: number }
  | { readonly type: 'pauseToggle'; readonly deviceId: number }
  | { readonly type: 'ptzOpen'; readonly deviceId: number }
  | { readonly type: 'cellPanelOpen'; readonly deviceId: number; readonly panel: CellPanelRequest }
  /** Take THIS camera off the wall and leave the others. Before it the only
   *  per-cell verbs were `tileOpen` (which PROMOTES a camera) and the host's own
   *  close button (which empties the whole view) — there was no way to say
   *  "this one no, the others yes". The host answers by dropping the id from the
   *  set it owns; the page never edits its own membership. */
  | { readonly type: 'tileRemove'; readonly deviceId: number }
  /** This camera should occupy `cw × ch` TRACKS of the wall's grid. Sizes, never
   *  a rectangle: see {@link GridCellSpan}. */
  | { readonly type: 'tileResize'; readonly deviceId: number; readonly cw: number; readonly ch: number }
  | { readonly type: 'layout'; readonly tiles: readonly { readonly deviceId: number; readonly rect: TileRect }[] }

/**
 * The host panels a TILE can ask for: the camera's linked-device actions, the
 * shared per-camera view-options menu, and — on a cell too small to carry both
 * buttons — the compact list that offers them (see `grid/cell-controls.ts`).
 *
 * PTZ keeps its own `ptzOpen` message: it predates this one and the hosted
 * player in the field still speaks it.
 */
export type CellPanelRequest = 'devices' | 'viewOptions' | 'actions'

const CELL_PANELS: readonly CellPanelRequest[] = ['devices', 'viewOptions', 'actions']

function isCellPanelRequest(v: unknown): v is CellPanelRequest {
  return typeof v === 'string' && CELL_PANELS.includes(v as CellPanelRequest)
}

/** A page's self-declared command list. Anything that is not an array of
 *  strings is treated as "not declared" rather than rejecting the whole
 *  message: the state report matters more than the capability hint. */
function coerceCommandNames(v: unknown): readonly string[] | null {
  if (!Array.isArray(v)) return null
  const names: string[] = []
  for (const n of v) if (typeof n === 'string') names.push(n)
  return names
}

function isRect(v: unknown): v is TileRect {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.x === 'number' && typeof r.y === 'number' && typeof r.w === 'number' && typeof r.h === 'number'
  )
}

const REPORT_STATES: readonly GridReportState[] = ['connecting', 'ready', 'error']

/** Validate an already-parsed page→host message object (web iframe postMessage). */
export function coerceGridHostMessage(data: unknown): GridHostMessage | null {
  if (typeof data !== 'object' || data === null) return null
  const m = data as Record<string, unknown>

  switch (m.type) {
    case 'state': {
      if (typeof m.state !== 'string' || !REPORT_STATES.includes(m.state as GridReportState)) return null
      const state = m.state as GridReportState
      const message = typeof m.message === 'string' ? { message: m.message } : {}
      const commands = coerceCommandNames(m.commands)
      return { type: 'state', state, ...message, ...(commands ? { commands } : {}) }
    }
    case 'tileTap':
    case 'tileLongPress': {
      if (typeof m.deviceId !== 'number' || !isRect(m.rect)) return null
      return { type: m.type, deviceId: m.deviceId, rect: m.rect }
    }
    case 'tileOpen': {
      if (typeof m.deviceId !== 'number') return null
      return { type: 'tileOpen', deviceId: m.deviceId }
    }
    case 'audioToggle': {
      if (typeof m.deviceId !== 'number') return null
      return { type: 'audioToggle', deviceId: m.deviceId }
    }
    case 'pauseToggle': {
      if (typeof m.deviceId !== 'number') return null
      return { type: 'pauseToggle', deviceId: m.deviceId }
    }
    case 'ptzOpen': {
      if (typeof m.deviceId !== 'number') return null
      return { type: 'ptzOpen', deviceId: m.deviceId }
    }
    case 'cellPanelOpen': {
      if (typeof m.deviceId !== 'number' || !isCellPanelRequest(m.panel)) return null
      return { type: 'cellPanelOpen', deviceId: m.deviceId, panel: m.panel }
    }
    case 'tileRemove': {
      if (typeof m.deviceId !== 'number') return null
      return { type: 'tileRemove', deviceId: m.deviceId }
    }
    case 'tileResize': {
      if (typeof m.deviceId !== 'number' || typeof m.cw !== 'number' || typeof m.ch !== 'number')
        return null
      if (!Number.isFinite(m.cw) || !Number.isFinite(m.ch)) return null
      return { type: 'tileResize', deviceId: m.deviceId, cw: m.cw, ch: m.ch }
    }
    case 'layout': {
      if (!Array.isArray(m.tiles)) return null
      const tiles: { deviceId: number; rect: TileRect }[] = []
      for (const t of m.tiles) {
        if (typeof t !== 'object' || t === null) return null
        const tt = t as Record<string, unknown>
        if (typeof tt.deviceId !== 'number' || !isRect(tt.rect)) return null
        tiles.push({ deviceId: tt.deviceId, rect: tt.rect })
      }
      return { type: 'layout', tiles }
    }
    default:
      return null
  }
}

/** Validate an untrusted page→host message string (native WebView.onMessage). */
export function parseGridHostMessage(raw: string): GridHostMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  return coerceGridHostMessage(data)
}

// ── Host → page commands ─────────────────────────────────────────────────────

export type GridCommand =
  | { readonly kind: 'setMutedAll'; readonly value: boolean }
  | { readonly kind: 'setAudioOn'; readonly value: readonly number[] }
  | { readonly kind: 'setActiveMic'; readonly value: number | null }
  | { readonly kind: 'setPaused'; readonly value: readonly number[] }
  | { readonly kind: 'setQuality'; readonly value: GridQuality }
  | { readonly kind: 'setLayout'; readonly value: GridLayout }
  | { readonly kind: 'setShowName'; readonly value: boolean }
  | { readonly kind: 'setShowBadges'; readonly value: boolean }
  | { readonly kind: 'setHighlight'; readonly value: GridHighlightEmbedConfig }
  | { readonly kind: 'setActiveOnly'; readonly value: boolean }
  | { readonly kind: 'setShowBoxes'; readonly value: boolean }
  // The first PER-DEVICE command: each camera's own indicators (motion regions,
  // motion pill, audio meter, occupancy, stats), keyed by device id. Everything
  // above it is one value for the whole wall — this is the channel a per-device
  // highlight map would also travel on.
  | {
      readonly kind: 'setOverlays'
      readonly value: Readonly<Record<string, TileOverlayEmbedConfig>>
    }
  // The device SET, at runtime. Until this existed the only way to change the
  // cameras on the wall was to remount the WebView — a fresh document boot and
  // N renegotiated peers for one added camera, which is what made "add this
  // camera to the view" unusable however it was drawn on top.
  | { readonly kind: 'setDevices'; readonly value: readonly number[] }
  // Per-camera SIZE on the wall, in tracks. The second per-device channel, and
  // the first geometry the host is allowed to state at all — see
  // {@link GridCellSpan} for the line it must not cross.
  | { readonly kind: 'setSpans'; readonly value: Readonly<Record<string, GridCellSpan>> }
  | { readonly kind: 'fit'; readonly w: number; readonly h: number }
  // Fast reconnect (no WebView reload) — keeps the last decoded frame on every
  // tile. Fired on a NetInfo connectivity change / foreground resume.
  | { readonly kind: 'reconnect' }
  // ── Grid-wide recorded playback (the grid timeline) ────────────────────────
  //
  // The SAME verbs the single-camera player embed exposes on
  // `window.__camstackEmbed` (see `live/live-control-map.ts`), applied by the
  // page to EVERY tile at once. Grid-wide rather than per-tile because that is
  // what the surface means: one timeline, one moment, N cameras.
  //
  // A page that does not implement them is not a failure mode — see the
  // per-method guard in {@link gridCommandScript}.
  | { readonly kind: 'scrubStart' }
  | { readonly kind: 'scrubTo'; readonly value: number }
  | { readonly kind: 'scrubCommit'; readonly value: number }
  | { readonly kind: 'seek'; readonly value: number }
  | { readonly kind: 'setRate'; readonly value: number }
  | { readonly kind: 'goLive' }

/** The argument list for one command, as JS source. Exhaustive over the union
 *  so a new command cannot silently serialize to `undefined`. */
function gridCommandArgs(cmd: GridCommand): string {
  switch (cmd.kind) {
    case 'fit':
      return `${cmd.w}, ${cmd.h}`
    case 'reconnect':
    case 'scrubStart':
    case 'goLive':
      return ''
    default:
      return JSON.stringify(cmd.value)
  }
}

/**
 * The command whose ABSENCE the host must notice.
 *
 * The method probe in {@link gridCommandScript} makes an unknown command a
 * no-op, which is the right degradation for an OPTION (an older page draws the
 * old overlay) and the wrong one for the device set: an older page would keep
 * the old cameras, for ever. So the host takes the hot path only once a page
 * has named this command in its `ready` report, and reloads the document
 * otherwise — exactly what it did before the command existed.
 */
export const GRID_HOT_DEVICES_COMMAND = 'setDevices'

/**
 * The per-camera SIZE the host may state, in TRACKS of the wall's own grid.
 *
 * A dimension, never a position. An offset is only meaningful inside the frame
 * that produced it, and the host's box is not the page's viewport — they differ
 * by the WebView's chrome, and during a rotation the host's number is stale
 * before the page's is. `cw`/`ch` mean the same thing in every box, so they
 * survive a rotation, a re-fit and a device-set change untouched. This is the
 * rule that a per-cell rectangle in the protocol would break, and it is the same
 * one 1.0.265 was fixed by.
 *
 * `{cw: 1, ch: 1}` — and an absent entry — mean the wall that ships today.
 */
export interface GridCellSpan {
  readonly cw: number
  readonly ch: number
}

/**
 * The command whose absence the host must NOT reload for.
 *
 * The mirror image of {@link GRID_HOT_DEVICES_COMMAND}, and the distinction is
 * the point. A device set that fails to arrive leaves the wall showing the wrong
 * CAMERAS, so the host reloads the document rather than guess. A span that fails
 * to arrive leaves the wall distributing its cells evenly — which is exactly the
 * wall that shipped, and a correct one. So the host pushes spans only to a page
 * that named this command, and otherwise sends nothing at all: on web the iframe
 * is served by the hub and the two halves version-skew independently, and a
 * reload there would blank every peer to deliver a preference.
 */
export const GRID_SPANS_COMMAND = 'setSpans'

/**
 * Build a guarded `injectJavaScript` string driving `window.__camstackGrid`.
 *
 * The guard checks the METHOD, not just the object. The old form
 * (`api && api.foo(x)`) is only safe while every host command exists on every
 * page the host can load — and that stopped being true the moment the grid
 * timeline started sending playback verbs: an embed build without `seek` would
 * throw `api.seek is not a function` inside the injected script, on every drag
 * frame. Probing the method makes an older page degrade to a no-op, which is
 * exactly what a host↔page version skew should do.
 */
export function gridCommandScript(cmd: GridCommand): string {
  const api = 'window.__camstackGrid'
  return `${api} && typeof ${api}.${cmd.kind} === 'function' && ${api}.${cmd.kind}(${gridCommandArgs(cmd)}); true;`
}
