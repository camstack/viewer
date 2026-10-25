/**
 * grid-tile-offer — bind a grid tile's WebRTC target into the player's
 * target-agnostic signaling callbacks.
 *
 * Extracted from `GridTilePlayer` because of what the inline version cost.
 * `CameraStreamPlayer` hands its auto-derived client hints (the measured
 * viewport × pixel ratio, and the downlink it probed) as the LAST argument of
 * `handleOffer`/`reoffer`. The tile's closures used to declare a shorter
 * arity — and a function with fewer parameters is assignable to a longer
 * signature in TypeScript, so nothing anywhere failed. The hints were simply
 * dropped at the call: every grid session reached the hub with no hints at
 * all, `pickAdaptiveTier` scored it `default-low`, and an `auto` tile could
 * not leave the sub-stream however wide the tile or however fast the link.
 *
 * Pure and injected so the forwarding is asserted rather than assumed — the
 * only shape of test that would have caught the original.
 */
import type {
  ClientOfferResult,
  ClientStreamHints,
  PlayerWebrtcTarget,
  WebrtcTarget,
} from '@camstack/ui-library'

/** The device-bound signaling call the tile closes over (`useDeviceWebrtc`). */
export type TileHandleOffer = (
  target: WebrtcTarget | PlayerWebrtcTarget,
  sdpOffer: string,
  sessionId?: string,
  hints?: ClientStreamHints,
) => Promise<ClientOfferResult>

/** The two callbacks `CameraStreamPlayer` expects, target already bound. */
export interface TileOfferBridge {
  readonly handleOffer: (
    sdpOffer: string,
    sessionId?: string,
    hints?: ClientStreamHints,
  ) => Promise<ClientOfferResult>
  readonly reoffer: (
    sessionId: string,
    sdpOffer: string,
    target: PlayerWebrtcTarget,
    hints?: ClientStreamHints,
  ) => Promise<ClientOfferResult>
}

/**
 * Bind `target` into the offer path. `reoffer` deliberately does NOT close
 * over it: an adaptive re-offer carries the SERVER-chosen target verbatim.
 * Both forward the player's hints unchanged.
 */
export function createTileOfferBridge(
  handleOffer: TileHandleOffer,
  target: WebrtcTarget,
): TileOfferBridge {
  return {
    handleOffer: (sdpOffer, sessionId, hints) =>
      handleOffer(target, sdpOffer, sessionId, hints),
    reoffer: (sessionId, sdpOffer, reofferTarget, hints) =>
      handleOffer(reofferTarget, sdpOffer, sessionId, hints),
  }
}
