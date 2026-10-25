/**
 * Leaving a stacked screen (camera detail, grid wall) for the Cameras tab.
 *
 * The regression this pins, reported 2026-08-18: open a camera from the
 * Cameras list, come back, and the list is at the top again. Cause is
 * `router.replace('/cameras')` — shipped 2026-08-17 in 6a5a13c to stop back
 * being a dead end on a cold-start deep link. REPLACE does not RETURN to the
 * `(tabs)` route already sitting at the bottom of the stack; the stack router
 * builds a BRAND NEW one (`createRouteFromAction`, fresh key) in the slot the
 * detail occupied. A second copy of the whole tab navigator mounts, the
 * cameras list is a fresh `FlatList`, and its scroll offset is gone.
 *
 * `dismissTo` (POP_TO) reaches the same destination without that cost, and
 * keeps the cold-start guarantee: no `(tabs)` in the stack → it replaces the
 * current route exactly like REPLACE did.
 *
 * Parts 2-4 drive the REAL `@react-navigation/routers` StackRouter — the same
 * copy the app runs — so this is a behavioural test of the navigation action,
 * not a source guard. The action shapes match what expo-router dispatches: see
 * `expo-router/build/global-state/getNavigationAction.js`, which resolves
 * `/cameras` against a stack whose focused route is `camera/[id]`, finds the
 * divergence at the (app) Stack, and dispatches `{ type, target: <stack key>,
 * payload: { name: '(tabs)', params: { screen: 'cameras', … } } }`.
 */
import { describe, expect, it } from 'vitest'
import {
  StackActions,
  StackRouter,
  type ParamListBase,
  type PartialState,
  type RouterConfigOptions,
  type StackNavigationState,
} from '@react-navigation/routers'
import { backToCameras, CAMERAS_TAB_HREF } from '../back-to-cameras.js'

/** The two routes of the (app) group Stack this test cares about. */
const TABS = '(tabs)'
const DETAIL = 'camera/[id]'

type StackState = StackNavigationState<ParamListBase>
type ActionResult = StackState | PartialState<StackState> | null

const options: RouterConfigOptions = {
  routeNames: [TABS, DETAIL],
  routeParamList: {},
  routeGetIdList: {},
}

const router = StackRouter({ initialRouteName: TABS })

/** The router may answer with null or a stale partial; neither is a stack. */
function settled(result: ActionResult): StackState {
  if (result === null) throw new Error('the router produced no state')
  if (result.stale !== false) throw new Error('the router produced a stale state')
  return result
}

/** Stack as it stands while a camera is open: tabs at the bottom, detail on top. */
function stackWithCameraOpen(): StackState {
  return settled(
    router.getStateForAction(
      router.getInitialState(options),
      StackActions.push(DETAIL, { id: '7' }),
      options,
    ),
  )
}

/** Cold start straight onto /camera/7 (a notification deep link): no tabs below. */
function stackFromDeepLink(): StackState {
  return StackRouter({ initialRouteName: DETAIL }).getInitialState(options)
}

const toCameras = { screen: 'cameras' } as const

describe('back to the cameras tab', () => {
  it('uses dismissTo — the pop-to action — and never replace', () => {
    const calls: string[] = []
    backToCameras({
      dismissTo: (href) => {
        calls.push(`dismissTo:${href}`)
      },
    })
    expect(calls).toEqual([`dismissTo:${CAMERAS_TAB_HREF}`])
  })

  it('REPLACE remounts the tab navigator — this is the lost scroll position', () => {
    const open = stackWithCameraOpen()
    const tabsKeyBefore = open.routes[0].key

    const next = settled(
      router.getStateForAction(open, StackActions.replace(TABS, toCameras), options),
    )

    const landed = next.routes[next.index]
    expect(landed.name).toBe(TABS)
    // A SECOND tabs route, with its own key: React mounts a new tab navigator,
    // a new CamerasScreen and a new FlatList. Nothing can restore the offset.
    expect(landed.key).not.toBe(tabsKeyBefore)
    // …and the old one is still underneath, so the stack grows by one on every
    // camera round-trip.
    expect(next.routes).toHaveLength(2)
  })

  it('POP_TO returns to the tab navigator that is already mounted', () => {
    const open = stackWithCameraOpen()
    const tabsKeyBefore = open.routes[0].key

    const next = settled(
      router.getStateForAction(open, StackActions.popTo(TABS, toCameras), options),
    )

    expect(next.routes).toHaveLength(1)
    const landed = next.routes[next.index]
    // SAME key ⇒ same mounted subtree ⇒ the cameras list keeps its scroll.
    expect(landed.key).toBe(tabsKeyBefore)
    // The params still say which tab to land on, so "back always goes to
    // Cameras" survives — `useNavigationBuilder` re-consumes `params.screen`
    // whenever it changes and navigates the child tab navigator there.
    expect(landed.params).toMatchObject(toCameras)
  })

  it('POP_TO to Grids from a camera does not stack a second tab navigator', () => {
    // The tablet report: camera is already a containedTransparentModal;
    // navigate('/grids') pushed a fresh (tabs) on top, then the grid wall
    // was a third overlay. dismissTo('/grids') is POP_TO with screen:grids.
    const open = stackWithCameraOpen()
    const tabsKeyBefore = open.routes[0].key

    const next = settled(
      router.getStateForAction(open, StackActions.popTo(TABS, { screen: 'grids' }), options),
    )

    expect(next.routes).toHaveLength(1)
    expect(next.routes[next.index].key).toBe(tabsKeyBefore)
    expect(next.routes[next.index].params).toMatchObject({ screen: 'grids' })
  })

  it('POP_TO still rescues the cold-start deep link that had nothing to pop', () => {
    const deepLinked = stackFromDeepLink()
    expect(deepLinked.routes).toHaveLength(1)
    expect(deepLinked.routes[0].name).toBe(DETAIL)

    const next = settled(
      router.getStateForAction(deepLinked, StackActions.popTo(TABS, toCameras), options),
    )

    expect(next.routes).toHaveLength(1)
    expect(next.routes[next.index].name).toBe(TABS)
  })
})
