/**
 * Back from a camera always lands on the cameras tab.
 *
 * `router.back()` is a no-op on a cold start (empty stack) and, from a grid
 * tile, leaves the grid mounted underneath so WebRTC keeps running. One
 * destination, wall unmounts — but reached with POP_TO (`dismissTo`), not
 * REPLACE: replace mints a SECOND tab navigator instead of returning to the
 * mounted one, which is how the cameras list lost its scroll position on
 * 2026-08-18. `src/navigation/back-to-cameras.ts` owns that decision and
 * `src/navigation/__tests__/back-to-cameras.spec.ts` proves it against the
 * real stack router; this file only guards the wiring.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('camera back always goes to cameras', () => {
  it('the detail screen backs out through backToCameras on back and swipe', () => {
    const src = read('screens/CameraDetailScreen.tsx')
    expect(src).toContain("import { backToCameras } from '../navigation/back-to-cameras.js'")
    // The TWO-finger fling does not navigate: leaving the screen is what
    // closed the PiP window (`camera-detail/pip-handoff.ts`). The one-finger
    // fling added on 2026-09-13 DOES leave — but into the on-demand overlay,
    // which survives the route change, so nothing is handed to a window that
    // is about to be unmounted.
    //
    // This assertion matches SOURCE TEXT, so it also fires on the spelling
    // inside a comment. That is not a false positive worth loosening: the
    // cheap fix is to describe the call without spelling it.
    expect(src).not.toContain('swipeBackThroughPip')
    expect(src).not.toContain('navigateBack')
    expect(src).toContain('onBack={() => backToCameras(router, forgetLastCamera)}')
    expect(src).not.toContain('router.back()')
    // The regression: a bare replace remounts the tab navigator.
    expect(src).not.toContain("router.replace('/cameras')")
  })
})
