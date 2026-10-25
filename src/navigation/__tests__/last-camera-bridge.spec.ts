/**
 * @vitest-environment jsdom
 *
 * "Reopen the last camera" in the real tree: the memory is written by
 * navigating, spent once at launch, and it degrades to the normal launch on
 * both of the states the operator asked to be handled — a camera that is gone
 * and one that is disabled.
 *
 * Mounting is what makes these claims worth anything. The pure decision is
 * covered by value in `last-camera.spec.ts`; what cannot be proved there is
 * that the bridge asks it with the RIGHT inputs (the frozen startup value, a
 * camera list that has answered) and that the navigation actually happens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, waitFor } from '@testing-library/react'
import React from 'react'

import AsyncStorage from '@react-native-async-storage/async-storage'
import { View } from 'react-native'
import { mountScreen, TEST_SERVER_ID } from '../../testing/mount.js'
import { scopedStorageKey } from '../../store/server-scope.js'
import { routerCalls } from '../../testing/native-stubs/expo-router.js'
import { useCameras } from '../../data/use-cameras.js'
import { DEFAULTS, useSettingsStore } from '../../store/settings-store.js'
import { useLastCameraStore } from '../../store/last-camera-store.js'
import { LAST_CAMERA_STORAGE_KEY } from '../last-camera.js'

/** The mounted harness's hub copy of the remembered camera (`server-scope.ts`). */
const KEY = scopedStorageKey(LAST_CAMERA_STORAGE_KEY, TEST_SERVER_ID)
import { LastCameraWatcher, ReopenLastCameraBridge } from '../LastCameraBridge.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

/** Camera 9 is disabled; 404 is in nobody's list. */
const CAMERAS = [
  { id: 1, name: 'Front door', isCamera: true, online: true, disabled: false },
  { id: 5, name: 'Garden', isCamera: true, online: true, disabled: false },
  { id: 9, name: 'Garage', isCamera: true, online: true, disabled: true },
]

const HUB = { 'deviceManager.listAll': CAMERAS }

function setReopenSetting(reopenLastCamera: boolean): void {
  useSettingsStore.setState({
    settings: { ...DEFAULTS, stream: { ...DEFAULTS.stream, reopenLastCamera } },
    hydrated: true,
  })
}

/** The state the store is in after a launch that read `deviceId` off disk. */
function setRemembered(deviceId: number | null): void {
  useLastCameraStore.setState({
    startupDeviceId: deviceId,
    current: deviceId,
    hydrated: true,
  })
}

beforeEach(async () => {
  await AsyncStorage.clear()
  setReopenSetting(true)
  setRemembered(null)
})

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ settings: DEFAULTS, hydrated: false })
  useLastCameraStore.setState({ startupDeviceId: null, current: null, hydrated: false, serverId: TEST_SERVER_ID })
})

/** Microtask flushes, for the cases where there is nothing to wait FOR. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await act(async () => undefined)
  }
}

/** Rendered by the probe once the camera list has answered. */
const ANSWERED_TEST_ID = 'cameras-answered'

/**
 * Reports, from inside the tree, whether the camera list has ANSWERED.
 *
 * It shares the bridge's query (same client, same key), so the moment this
 * renders, the bridge has the same data on the same pass. Reported as a NODE
 * rather than a module variable: a render that writes to module scope is the
 * pattern React Compiler is entitled to skip.
 */
function CamerasAnsweredProbe(): React.ReactElement | null {
  const { data } = useCameras({ includeHidden: true })
  if (data === undefined) return null
  return React.createElement(View, { testID: ANSWERED_TEST_ID })
}

/**
 * Mount the launch bridge on the route a normal launch lands on, and wait for
 * the camera list rather than for a fixed number of flushes.
 *
 * Counting flushes was tried and it LIED. The list answers through an
 * AsyncStorage read, a promise chain and a react-query commit, and how many
 * microtask turns that takes varies between mounts in this harness — measured
 * here: identical back-to-back mounts settled on turns 1, 4 and 6 and did not
 * settle at all within twelve on the others. Every negative assertion in this
 * file (`expect(routerCalls()).toEqual([])`) is green for a bridge that never
 * got as far as deciding, so "did not navigate" has to mean "decided not to".
 */
async function launch(pathname = '/cameras'): Promise<void> {
  const { container } = mountScreen(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(ReopenLastCameraBridge),
      React.createElement(CamerasAnsweredProbe),
    ),
    { hub: HUB, pathname },
  )
  await waitFor(() => {
    expect(container.querySelector(`[data-testid="${ANSWERED_TEST_ID}"]`)).not.toBeNull()
  })
  // …and one more turn, for the render + effect the answer unlocks.
  await act(async () => undefined)
}

describe('the launch reopens the camera the operator was watching', () => {
  it('pushes the remembered camera once the list has confirmed it', async () => {
    setRemembered(5)
    await launch()
    expect(routerCalls()).toEqual([{ kind: 'push', target: '/camera/5' }])
  })

  it('pushes — so the back arrow still lands on the camera list', async () => {
    setRemembered(5)
    await launch()
    expect(routerCalls().every((c) => c.kind !== 'replace')).toBe(true)
  })

  it('does nothing at all with the setting off — the default launch', async () => {
    setReopenSetting(false)
    setRemembered(5)
    await launch()
    expect(routerCalls()).toEqual([])
  })

  it('does nothing when the last page was not a camera', async () => {
    setRemembered(null)
    await launch()
    expect(routerCalls()).toEqual([])
  })

  /**
   * The claim the whole two-field store exists for, and the one a naive
   * implementation gets wrong in production rather than in a test.
   *
   * By the time the camera list answers, the watcher has ALREADY seen
   * `/cameras` and cleared the live value — that is correct, `/cameras` is a
   * changed page. A bridge that read the live value would therefore find
   * `null` on every real launch and quietly never reopen anything, while every
   * test that seeds both fields to the same number passes.
   */
  it('reads the camera the app STARTED with, not the one navigation has since cleared', async () => {
    useLastCameraStore.setState({ startupDeviceId: 5, current: null, hydrated: true, serverId: TEST_SERVER_ID })
    await launch()
    expect(routerCalls()).toEqual([{ kind: 'push', target: '/camera/5' }])
  })

  it('fires at most once, however many times it re-renders', async () => {
    setRemembered(5)
    await launch()
    await settle()
    expect(routerCalls()).toEqual([{ kind: 'push', target: '/camera/5' }])
  })
})

describe('the two edge cases degrade to the normal launch, never to a broken screen', () => {
  it('a camera that no longer exists is not opened', async () => {
    setRemembered(404)
    await launch()
    expect(routerCalls()).toEqual([])
  })

  it('a DISABLED camera is not opened', async () => {
    setRemembered(9)
    await launch()
    expect(routerCalls()).toEqual([])
  })

  it('and neither of them is mistaken for a hub that had not answered yet', async () => {
    // The one case with nothing to wait for, and the point of the test: a hub
    // that answers NOTHING must leave the launch waiting, not conclude "gone"
    // from silence — so this settles on flushes deliberately.
    setRemembered(5)
    mountScreen(React.createElement(ReopenLastCameraBridge), { hub: {}, pathname: '/cameras' })
    await settle()
    expect(routerCalls()).toEqual([])
  })
})

describe('the memory follows the operator', () => {
  async function navigateTo(pathname: string): Promise<void> {
    mountScreen(React.createElement(LastCameraWatcher), { hub: HUB, pathname })
    await settle()
  }

  it('opening a single stream stores that camera', async () => {
    useLastCameraStore.setState({ startupDeviceId: null, current: null, hydrated: true, serverId: TEST_SERVER_ID })
    await navigateTo('/camera/5')
    expect(await AsyncStorage.getItem(KEY)).toBe('5')
  })

  it('going to another page KEEPS it — leaving is not finishing', async () => {
    // Revised 2026-09-04. This asserted CLEAR and called it "the whole
    // semantics"; it was also why pressing Cameras from Grids could never
    // return the operator to the camera they had been watching — the value was
    // gone the moment they navigated away.
    await AsyncStorage.setItem(KEY, '5')
    useLastCameraStore.setState({ startupDeviceId: 5, current: 5, hydrated: true, serverId: TEST_SERVER_ID })
    await navigateTo('/events')
    expect(await AsyncStorage.getItem(KEY)).toBe('5')
  })

  it('and an explicit forget() is what clears it', async () => {
    // The two gestures that mean "done with this camera": backing out, and
    // pressing Cameras while already on one.
    await AsyncStorage.setItem(KEY, '5')
    useLastCameraStore.setState({ startupDeviceId: 5, current: 5, hydrated: true, serverId: TEST_SERVER_ID })
    useLastCameraStore.getState().forget()
    await vi.waitFor(async () => {
      expect(await AsyncStorage.getItem(KEY)).toBeNull()
    })
  })

  it('and it writes NOTHING before the previous session has been read back', async () => {
    // The load-bearing gate. Until hydrate has captured the previous session's
    // value, ANY write is a write over something nobody has read yet — and the
    // feature would then work only when the disk read happened to win the race.
    //
    // Exercised with a navigation that WOULD write (a camera, not a page):
    // asserting on a page here proves nothing, because clearing an
    // already-empty memory is deduped away and looks identical to the gate
    // holding.
    await AsyncStorage.setItem(KEY, '5')
    useLastCameraStore.setState({ startupDeviceId: null, current: null, hydrated: false, serverId: TEST_SERVER_ID })
    await navigateTo('/camera/9')
    expect(await AsyncStorage.getItem(KEY)).toBe('5')
    expect(useLastCameraStore.getState().current).toBeNull()
  })

  it('a real hydrate then finds that value and freezes it for the launch', async () => {
    await AsyncStorage.setItem(KEY, '5')
    useLastCameraStore.setState({ startupDeviceId: null, current: null, hydrated: false, serverId: TEST_SERVER_ID })
    await act(async () => {
      await useLastCameraStore.getState().hydrate()
    })
    expect(useLastCameraStore.getState().startupDeviceId).toBe(5)

    // …and the app's own first navigation no longer disturbs it — which is now
    // true of the STORED value too, not only of the frozen startup one.
    await navigateTo('/cameras')
    expect(useLastCameraStore.getState().startupDeviceId).toBe(5)
    expect(await AsyncStorage.getItem(KEY)).toBe('5')
  })
})
