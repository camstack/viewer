/**
 * @vitest-environment jsdom
 *
 * The theater's orientation must be RE-ASSERTED, not merely applied once.
 *
 * `ScreenOrientation.lockAsync` is APP-WIDE. The theater's own effect had the
 * dep array `[fullscreen]`, and `freezeOnBlur: false` means pushing the grid on
 * top leaves the theater MOUNTED — so the grid's unmount cleanup could impose a
 * lock the theater would never undo, and the layout stayed wrong until the
 * route was re-entered from scratch. That is the operator's "la timeline
 * comincia a stare sotto", and it stays there.
 *
 * The fix is a hook that re-applies the theater's OWN intent on every focus.
 * Proving it needs the call sequence (`orientation-control.ts`) and a real
 * re-focus of a still-mounted tree (`focus-control.ts`): a `useEffect` and a
 * `useFocusEffect` are indistinguishable from rendered output, and the whole
 * defect is exactly that difference.
 *
 * Explicit fullscreen EXIT on a phone must force portrait (then release) —
 * unlock alone left a landscape-held phone in `fill` with no stacked chrome.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { setTestPlatform } from '../../testing/platform-control.js'
import { emitFocus } from '../../testing/focus-control.js'
import {
  orientationCalls,
  resetOrientationCalls,
  type OrientationCall,
} from '../../testing/orientation-control.js'
import {
  theaterOrientationIntent,
  useTheaterOrientation,
} from '../use-theater-orientation.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

/** `OrientationLock.LANDSCAPE` / `PORTRAIT_UP` in the stubbed enum. */
const LANDSCAPE = 5
const PORTRAIT_UP = 3

/** Phone shortest side — under the tablet gate. */
const PHONE_MIN_SIDE = 430
/** Tablet shortest side — must NOT restore portrait. */
const TABLET_MIN_SIDE = 768

function Probe({
  fullscreen,
  screenMinSide = PHONE_MIN_SIDE,
}: {
  readonly fullscreen: boolean
  readonly screenMinSide?: number
}): React.ReactElement | null {
  useTheaterOrientation(fullscreen, { screenMinSide })
  return null
}

/**
 * Owns fullscreen in React state so an exit is a real prop transition on the
 * SAME mounted hook instance. `view.rerender(<Probe/>)` would replace the
 * provider tree `mountScreen` built and remount the hook with the exit
 * already applied — `wasFullscreenRef` would initialise to `false`.
 */
function ExitDriver({
  screenMinSide = PHONE_MIN_SIDE,
  onReady,
}: {
  readonly screenMinSide?: number
  readonly onReady: (exit: () => void) => void
}): React.ReactElement | null {
  const [fullscreen, setFullscreen] = React.useState(true)
  useTheaterOrientation(fullscreen, { screenMinSide })
  React.useEffect(() => {
    onReady(() => {
      setFullscreen(false)
    })
  }, [onReady])
  return null
}

function callsSince(mark: number): readonly OrientationCall[] {
  return orientationCalls().slice(mark)
}

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
  resetOrientationCalls()
})

describe('theaterOrientationIntent', () => {
  it('maps fullscreen → landscape, exit-on-phone → portrait, else free', () => {
    expect(theaterOrientationIntent({ isWeb: false, fullscreen: true })).toBe('landscape')
    expect(
      theaterOrientationIntent({
        isWeb: false,
        fullscreen: false,
        restorePortraitOnExit: true,
      }),
    ).toBe('portrait')
    expect(theaterOrientationIntent({ isWeb: false, fullscreen: false })).toBe('free')
    expect(theaterOrientationIntent({ isWeb: true, fullscreen: true })).toBe('none')
  })
})

describe('the theater re-asserts its own orientation on every focus', () => {
  it('unlocks on mount AND again when the route comes back to the front', () => {
    setTestPlatform('ios')
    mountScreen(React.createElement(Probe, { fullscreen: false }))

    expect(orientationCalls()).toEqual([{ kind: 'unlock' }])

    // Another route (the grid) leaves an APP-WIDE portrait lock behind on its
    // way out. The theater is still mounted, so nothing but focus can fire.
    const mark = orientationCalls().length
    act(() => {
      emitFocus()
    })

    // Blur releases, focus re-applies — a round trip, not a single call. The
    // second `unlock` is the theater speaking again; without it the grid's
    // portrait lock is simply still in force.
    expect(callsSince(mark)).toEqual([{ kind: 'unlock' }, { kind: 'unlock' }])
  })

  it('re-asserts LANDSCAPE, not "unlocked", when the theater is in fullscreen', () => {
    setTestPlatform('ios')
    mountScreen(React.createElement(Probe, { fullscreen: true }))
    expect(orientationCalls()).toEqual([{ kind: 'lock', lock: LANDSCAPE }])

    const mark = orientationCalls().length
    act(() => {
      emitFocus()
    })
    // The screen re-asserts ITS state — a blanket unlock here would drop the
    // fullscreen player out of landscape on every return.
    expect(callsSince(mark)).toEqual([{ kind: 'unlock' }, { kind: 'lock', lock: LANDSCAPE }])
  })

  it('on phone, exiting fullscreen forces PORTRAIT_UP then releases', async () => {
    setTestPlatform('ios')
    let exit: (() => void) | undefined
    mountScreen(
      React.createElement(ExitDriver, {
        onReady: (fn) => {
          exit = fn
        },
      }),
    )
    expect(orientationCalls()).toEqual([{ kind: 'lock', lock: LANDSCAPE }])

    const mark = orientationCalls().length
    act(() => {
      exit?.()
    })
    // lockAsync is async; flush the then() that unlocks after portrait.
    await act(async () => {
      await Promise.resolve()
    })

    // Cleanup of the landscape effect unlocks, then portrait locks and
    // releases. The forced PORTRAIT_UP is the whole point of the exit path.
    expect(callsSince(mark)).toEqual([
      { kind: 'unlock' },
      { kind: 'lock', lock: PORTRAIT_UP },
      { kind: 'unlock' },
    ])
  })

  it('on tablet, exiting fullscreen only unlocks — never forces portrait', () => {
    setTestPlatform('ios')
    let exit: (() => void) | undefined
    mountScreen(
      React.createElement(ExitDriver, {
        screenMinSide: TABLET_MIN_SIDE,
        onReady: (fn) => {
          exit = fn
        },
      }),
    )
    const mark = orientationCalls().length
    act(() => {
      exit?.()
    })
    // Cleanup unlock + free unlock — never PORTRAIT_UP.
    expect(callsSince(mark)).toEqual([{ kind: 'unlock' }, { kind: 'unlock' }])
    expect(callsSince(mark).some((c) => c.kind === 'lock')).toBe(false)
  })

  it('releases the lock it imposed when the screen goes away', () => {
    setTestPlatform('ios')
    const view = mountScreen(React.createElement(Probe, { fullscreen: true }))
    const mark = orientationCalls().length
    act(() => {
      view.unmount()
    })
    expect(callsSince(mark)).toEqual([{ kind: 'unlock' }])
  })

  it('touches nothing at all on web', () => {
    setTestPlatform('web')
    resetOrientationCalls()
    const view = mountScreen(React.createElement(Probe, { fullscreen: true }))
    act(() => {
      emitFocus()
    })
    act(() => {
      view.unmount()
    })
    // `screen.orientation.lock()` rejects outside fullscreen and the `void`
    // swallows it — an unhandled rejection per navigation, for no effect.
    expect(orientationCalls()).toEqual([])
  })
})
