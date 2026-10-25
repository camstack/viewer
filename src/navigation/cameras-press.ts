/**
 * Where pressing the Cameras entry should land.
 *
 * Three situations, and they were all one line (`if (isActive) return`) until
 * the operator reported that none of them worked:
 *
 *  - ON a camera → the LIST, and the remembered camera is FORGOTTEN. Pressing
 *    the entry you are looking at is how an operator says "take me out of
 *    here"; keeping the camera would send them straight back on the next press.
 *  - ON the list already → nothing.
 *  - ANYWHERE ELSE with a camera still remembered → that camera. Leaving a
 *    camera for Grids is not finishing with it, so coming back returns to it.
 *    This is the per-tab stack memory a nested route tree would give, bought
 *    with the value the app already persists.
 *
 * Pure — the bars call it, the tests read it.
 */
import { cameraRoute } from './last-camera.js'

export type CamerasPress =
  | { readonly kind: 'noop' }
  /** Go to the cameras list. `forget` says whether to drop the remembered
   *  camera on the way — true only when we are leaving one. */
  | { readonly kind: 'list'; readonly forget: boolean }
  | { readonly kind: 'camera'; readonly href: string }

/** True for `/camera/<id>` and nothing else. */
export function isOnCameraRoute(pathname: string): boolean {
  return /^\/camera\/\d+/.test(pathname)
}

export function resolveCamerasPress(
  pathname: string,
  rememberedDeviceId: number | null,
): CamerasPress {
  if (isOnCameraRoute(pathname)) return { kind: 'list', forget: true }
  if (pathname === '/cameras') return { kind: 'noop' }
  if (rememberedDeviceId !== null) {
    return { kind: 'camera', href: cameraRoute(rememberedDeviceId) }
  }
  return { kind: 'list', forget: false }
}
