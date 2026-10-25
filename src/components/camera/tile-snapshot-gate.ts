/**
 * What a camera TILE asks the hub for, given the camera's state.
 *
 * Two different questions used to be one flag, and that is what made a disabled
 * camera look broken:
 *
 *   - is this camera at the LIVE EDGE? (occupancy, motion, battery, child
 *     states — anything that would draw a number which no longer refreshes)
 *   - should the tile ask for a SNAPSHOT?
 *
 * The second question no longer looks at the camera at all. Under D190 the
 * snapshot service owns the tile for EVERY camera state: disabled, sleeping,
 * waking, unreachable and — since 2026-08-20 — offline all come back as a frame
 * with the state painted into it and named in `stateReason`. There is no camera
 * condition for which asking is the wrong move, so the only thing left to gate
 * on is whether anybody is looking.
 *
 * The asymmetry that used to live here (an OFFLINE camera was not asked, because
 * the hub dialled before falling back to a courtesy frame) is gone with the
 * reason for it: an offline camera is now answered from cache, with the
 * treatment already applied, and the link poll does not dial it at all. While
 * that asymmetry existed the tile had nothing to paint, and the app grew three
 * separate mechanisms to paint something anyway.
 *
 * Pure, so the gate is unit-tested without a renderer.
 */
export interface TileCameraState {
  /** The surface is on screen and allowed to poll. */
  readonly screenActive: boolean
  /** The hub says the camera is reachable. */
  readonly online: boolean
  /** Soft-disabled at the hub — out of service on purpose. */
  readonly disabled: boolean
  /** A battery camera currently asleep. */
  readonly sleeping: boolean
}

/** True when live, per-frame surfaces (occupancy, motion, …) may run. */
export function isLiveEdge(state: TileCameraState): boolean {
  return state.screenActive && state.online && !state.disabled && !state.sleeping
}

/**
 * True when the tile should request a snapshot image.
 *
 * One question, and it is not about the camera: is this surface on screen? The
 * hub has a correct tile for every camera state (D190), and the client is not
 * allowed a second opinion about which of them are worth painting.
 */
export function shouldRequestSnapshot(state: TileCameraState): boolean {
  return state.screenActive
}
