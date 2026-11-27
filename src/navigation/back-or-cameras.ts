import { CAMERAS_TAB_HREF } from './back-to-cameras.js'

/** The two router methods the strip's back control needs. */
export interface BackOrCamerasRouter {
  readonly canGoBack: () => boolean
  readonly back: () => void
  readonly replace: (href: typeof CAMERAS_TAB_HREF) => void
}

/**
 * Back for a screen that is not a tab root: pop one screen, and when there is
 * nothing to pop (deep link, web reload) land on the Cameras tab instead of
 * doing nothing.
 */
export function backOrCameras(router: BackOrCamerasRouter): void {
  if (router.canGoBack()) router.back()
  else router.replace(CAMERAS_TAB_HREF)
}
