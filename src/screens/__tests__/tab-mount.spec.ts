/**
 * @vitest-environment jsdom
 *
 * Mount smoke test for every bottom-tab screen.
 *
 * WHY THIS FILE EXISTS: OTA v1.0.336 shipped an Events tab and a Notifications
 * tab that threw on their first render — the operator saw the app disappear —
 * and a 2,917-test suite stayed green through it, because not one test mounted a
 * component. Nothing else in this repo can catch a mount crash.
 *
 * A screen here is expected to render with NOTHING answering on the wire (the
 * default `hub-stub` state) and again with a payload. Both matter: the first is
 * a cold start against an older hub, the second is the operator's normal day.
 *
 * Two device rules the browser does not have are enforced while these run, and
 * they are the whole reason the harness could catch v1.0.336 at all:
 *
 *   • `src/testing/hermes-globals.ts` deletes the built-ins Hermes lacks, so a
 *     module-evaluation throw (`Array.prototype.toSorted`) happens here too.
 *   • `src/testing/native-stubs/react-native.tsx` refuses a raw string under a
 *     view, which on a device is an uncaught "Text strings must be rendered
 *     within a <Text> component" and on the web is a legal text node.
 *
 * EVERY top-level tab is listed. A new tab without an entry here is a tab that
 * can crash on open with nothing to say so.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { NotificationCenterScreen } from '../notifications/NotificationCenterScreen.js'
import { LibraryScreen } from '../LibraryScreen.js'
import { CamerasScreen } from '../CamerasScreen.js'
import { GridsScreen } from '../GridsScreen.js'
import { SettingsScreen } from '../SettingsScreen.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

/** An admin session — the role that unlocks the MOST controls, so the widest
 *  render path is the one under test. */
const ME = {
  id: 'u1',
  username: 'operator',
  isAdmin: true,
  permissions: { isAdmin: true, allowedProviders: '*', allowedDevices: {} },
  scope: {
    isAdmin: true,
    allDevicesViewable: true,
    viewableDeviceCount: 2,
    device: {
      view: { all: true, deviceCount: 2 },
      create: { all: true, deviceCount: 2 },
      delete: { all: true, deviceCount: 2 },
    },
    system: ['view', 'create', 'delete'],
    capabilities: [],
    addons: [],
  },
}

const HUB_WITH_SESSION = { 'auth.me': ME }

const TABS: readonly (readonly [string, () => React.ReactElement])[] = [
  ['Cameras', () => React.createElement(CamerasScreen)],
  ['Grids', () => React.createElement(GridsScreen)],
  ['Library', () => React.createElement(LibraryScreen)],
  [
    'Notifications',
    () => React.createElement(NotificationCenterScreen, { embedded: true }),
  ],
  ['Settings', () => React.createElement(SettingsScreen)],
]

/**
 * Testing Library's automatic cleanup only runs when vitest `globals` are on,
 * and they are not. Without this, a screen stays mounted after its test and its
 * in-flight React Query work lands after jsdom has been torn down — reported as
 * a bare `ReferenceError: window is not defined` with no hint of which test.
 */
afterEach(cleanup)

/**
 * The assertion is STRUCTURAL, not textual: Cameras paints skeleton tiles with
 * no copy at all on a cold start, and demanding text would fail a screen that
 * is behaving. What is actually under test is that `mountScreen` returned —
 * a screen that throws never gets here, because nothing catches for it.
 */
function expectRendered(view: { container: HTMLElement }): void {
  expect(view.container.firstElementChild).not.toBeNull()
}

describe('tab screens mount', () => {
  for (const [name, element] of TABS) {
    it(`${name} renders with nothing on the wire`, () => {
      expectRendered(mountScreen(element()))
    })

    it(`${name} renders for a signed-in admin`, () => {
      expectRendered(mountScreen(element(), { hub: HUB_WITH_SESSION }))
    })
  }
})
