/**
 * The two halves of "reopen the last camera", as mounted-once bridges.
 *
 * Both render `null` and both live in `app/(app)/_layout.tsx` beside the other
 * bridges, for the same reason those do: they must be mounted exactly once, and
 * inside `ConnectionProvider` (the reopen needs the camera list before it can
 * refuse a camera that is gone or disabled).
 *
 * The rules they run are pure in `last-camera.ts` — including WHY the launch
 * reads a frozen value rather than the live one.
 */
import { useEffect, useRef } from 'react'
import { useRouter, usePathname, type Href } from 'expo-router'

import { log } from '../lib/logger.js'
import { useCameras } from '../data/use-cameras.js'
import { useSettings } from '../data/use-settings.js'
import { useLastCameraStore } from '../store/last-camera-store.js'
import { cameraRoute, resolveReopenLastCamera } from './last-camera.js'

/**
 * Remembers the single stream and clears on every other page.
 *
 * **Gated on `hydrated`, and that gate is load-bearing.** At launch this app
 * sits on `/cameras`, which is a "changed page" — writing that clear before the
 * store has read the previous session's value would erase the very thing the
 * launch is about to look for, and the feature would appear to work for exactly
 * as long as the read happened to win the race.
 */
export function LastCameraWatcher(): null {
  const pathname = usePathname()
  const note = useLastCameraStore((s) => s.note)
  const hydrated = useLastCameraStore((s) => s.hydrated)

  useEffect(() => {
    if (!hydrated) return
    note(pathname)
  }, [pathname, note, hydrated])

  return null
}

/**
 * Opens the remembered camera, at most once per launch.
 *
 * `push`, not `replace`: the launch has already landed on `/cameras`, so
 * pushing leaves the stack in its normal shape and the back arrow does what it
 * does from any other camera.
 *
 * Hidden cameras are included in the lookup on purpose — hiding is a
 * preference about the LIST, and a camera the operator hid but was watching is
 * not a camera that is gone.
 */
export function ReopenLastCameraBridge(): null {
  const router = useRouter()
  const pathname = usePathname()
  const { settings, hydrated: settingsHydrated } = useSettings()
  const startupDeviceId = useLastCameraStore((s) => s.startupDeviceId)
  const memoryHydrated = useLastCameraStore((s) => s.hydrated)
  const { data: cameras } = useCameras({ includeHidden: true })
  /**
   * "At most once per launch", and it lives HERE rather than in the pure rule
   * for a concrete reason: React Compiler is enabled in this app, and reading
   * `.current` during a render is exactly the pattern whose result the compiler
   * is free to memoise. The rule therefore has no memory of being asked, and
   * the effect — the only place a ref may be read — enforces the one shot.
   */
  const decided = useRef(false)

  const decision = resolveReopenLastCamera({
    enabled: settings.stream.reopenLastCamera,
    settingsHydrated,
    memoryHydrated,
    startupDeviceId,
    // `undefined` until the query has ANSWERED. Deliberately not `?? []`: that
    // is what makes a slow hub indistinguishable from a deleted camera.
    cameras,
    pathname,
  })

  useEffect(() => {
    if (decided.current || decision.action === 'wait') return
    decided.current = true
    // `boot` always ships (`lib/logger.ts`), so "why did it not reopen" has an
    // answer in a normal build. A launch that silently did nothing is the
    // hardest kind of report to act on.
    log.info('boot', 'last-camera launch decision', {
      action: decision.action,
      reason: decision.action === 'skip' ? decision.reason : 'ok',
      deviceId: startupDeviceId ?? -1,
    })
    if (decision.action !== 'reopen') return
    // Documented type boundary (the same one `app/index.tsx` states for a
    // resumed deep link): `cameraRoute` builds a route this app owns, and
    // expo-router's `Href` is a template-literal union no runtime string can
    // satisfy structurally.
    router.push(cameraRoute(decision.deviceId) as Href)
  }, [decision, router, startupDeviceId])

  return null
}
