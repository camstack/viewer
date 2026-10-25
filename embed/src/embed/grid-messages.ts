import { emitHost } from './host-bridge'

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
      /** The host→page commands this build implements, sent with `ready`.
       *  Mirrors `src/grid-embed/embed-messages.ts` — the host reloads the
       *  document for a page that did not name `setDevices`, because an unknown
       *  command is a silent no-op and for the device SET that would mean the
       *  wrong cameras until something else happened to remount. */
      readonly commands?: readonly string[]
    }
  | { readonly type: 'tileTap'; readonly deviceId: number; readonly rect: TileRect }
  | { readonly type: 'tileLongPress'; readonly deviceId: number; readonly rect: TileRect }
  | { readonly type: 'tileOpen'; readonly deviceId: number }
  | { readonly type: 'audioToggle'; readonly deviceId: number }
  | { readonly type: 'pauseToggle'; readonly deviceId: number }
  | { readonly type: 'ptzOpen'; readonly deviceId: number }
  | { readonly type: 'cellPanelOpen'; readonly deviceId: number; readonly panel: CellPanelRequest }
  /** Take THIS camera off the wall, leaving the others. The page does not act
   *  on it: the wall's membership is the host's (`setDevices` is how it comes
   *  back), and a page that removed a tile locally would disagree with the host
   *  the moment anything else re-pushed the set. */
  | { readonly type: 'tileRemove'; readonly deviceId: number }
  /** This camera should be `cw × ch` TRACKS. Sizes, never a rectangle — see
   *  `CellSpan` in `grid-layout` for why a position must not cross this bridge.
   *  Like the audio and pause sets, the host owns the value and pushes the
   *  result back (`setSpans`); the page only states the intent. */
  | { readonly type: 'tileResize'; readonly deviceId: number; readonly cw: number; readonly ch: number }
  | {
      readonly type: 'layout'
      readonly tiles: readonly { readonly deviceId: number; readonly rect: TileRect }[]
    }

/**
 * The host panels a tile can ask for beyond PTZ: the camera's linked-device
 * actions, the shared per-camera view-options menu, and the compact list that
 * offers both on a cell too small for two buttons (see `tile-controls`).
 *
 * Mirrors `src/grid-embed/embed-messages.ts` on the host side — keep the
 * members equal; the host REJECTS a panel name it does not know.
 */
export type CellPanelRequest = 'devices' | 'viewOptions' | 'actions'

export function tileTapMsg(deviceId: number, rect: TileRect): GridHostMessage {
  return { type: 'tileTap', deviceId, rect }
}

export function tileLongPressMsg(deviceId: number, rect: TileRect): GridHostMessage {
  return { type: 'tileLongPress', deviceId, rect }
}

/** The in-tile "open" button — asks the host to navigate to the camera detail. */
export function tileOpenMsg(deviceId: number): GridHostMessage {
  return { type: 'tileOpen', deviceId }
}

/** The in-tile audio button — asks the host to toggle this camera's audio. The
 *  host owns the (combinable) audio set and pushes it back via setAudioOn. */
export function audioToggleMsg(deviceId: number): GridHostMessage {
  return { type: 'audioToggle', deviceId }
}

/** The in-tile pause button — asks the host to toggle this camera's pause. The
 *  host owns the paused set (so the bar's mass play/pause reflects per-tile
 *  pauses) and pushes it back via setPaused. */
export function pauseToggleMsg(deviceId: number): GridHostMessage {
  return { type: 'pauseToggle', deviceId }
}

/** The in-tile PTZ button — asks the host to open the (native) PTZ controls for
 *  this camera. Shown only for cameras the host marked as PTZ-capable. */
export function ptzOpenMsg(deviceId: number): GridHostMessage {
  return { type: 'ptzOpen', deviceId }
}

/** An in-tile secondary button (or a row of the compact "more" list) — asks the
 *  host to mount one of ITS panels for this camera. The tile hosts none of them
 *  itself: they are the app's own components, shared with the single-camera
 *  view, and the WebView has no access to those. */
export function cellPanelOpenMsg(deviceId: number, panel: CellPanelRequest): GridHostMessage {
  return { type: 'cellPanelOpen', deviceId, panel }
}

/** The in-tile remove button — asks the host to drop this camera from the wall. */
export function tileRemoveMsg(deviceId: number): GridHostMessage {
  return { type: 'tileRemove', deviceId }
}

/** The in-tile resize handle — asks the host for a new track span. */
export function tileResizeMsg(deviceId: number, cw: number, ch: number): GridHostMessage {
  return { type: 'tileResize', deviceId, cw, ch }
}

export function gridStateMsg(
  state: GridReportState,
  message?: string,
  commands?: readonly string[],
): GridHostMessage {
  return {
    type: 'state',
    state,
    ...(message !== undefined ? { message } : {}),
    ...(commands !== undefined ? { commands } : {}),
  }
}

export function layoutMsg(
  tiles: readonly { readonly deviceId: number; readonly rect: TileRect }[],
): GridHostMessage {
  return { type: 'layout', tiles }
}

/** Post a message to the host (RN WebView → `ReactNativeWebView.postMessage`;
 *  browser iframe → `parent.postMessage`). No-op outside both. */
export function postToHost(msg: GridHostMessage): void {
  emitHost(msg)
}
