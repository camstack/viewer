/**
 * adhoc-back — where Back goes from `/grid/adhoc` (#700).
 *
 * The route is now only the sharing format and the deep link. A link that
 * names the camera it came from (`from=<deviceId>`) backs out to THAT camera;
 * one that does not (a shared link opened cold) backs out to the Cameras tab
 * like every other stacked surface.
 *
 * `dismissTo` (POP_TO), never a bare pop: with the camera still in the stack
 * it pops to it BY ROUTE, and with nothing to pop to it replaces the current
 * route instead of doing nothing — so the link is never a dead end.
 */
import { backToCameras, type CamerasBackRouter } from './back-to-cameras.js'

export interface AdhocBackRouter extends CamerasBackRouter {
  readonly dismissTo: (href: string) => void
}

/** The camera id carried by `?from=`, or null when absent or malformed. */
export function parseAdhocOrigin(param: string | readonly string[] | undefined): number | null {
  const raw = typeof param === 'string' ? param : param?.[0]
  if (raw === undefined) return null
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export function backFromAdhocGrid(router: AdhocBackRouter, originDeviceId: number | null): void {
  if (originDeviceId === null) {
    backToCameras(router)
    return
  }
  router.dismissTo(`/camera/${originDeviceId}`)
}
