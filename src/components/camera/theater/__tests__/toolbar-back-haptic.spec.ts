/**
 * @vitest-environment jsdom
 *
 * The player's back button ANSWERS THE TOUCH.
 *
 * `TimelineToolbarInline` renders the back arrow above the player; pressing it
 * runs `backToCameras`. Every sibling control in that same row already pulses
 * on press, and the back arrow was silent until `hapticTap()` was put in front
 * of `props.onBack()`. Nothing proved it afterwards, which is the failure this
 * file exists to prevent: a one-character edit to that handler is invisible in
 * review, ships as "no vibration on back", and no test noticed.
 *
 * So this asserts the OUTCOME, not the plumbing — a click on the rendered
 * button must reach the native `expo-haptics` call, through the real
 * `hapticTap` → `resolveUiHaptic` → `fireHaptic` chain, with nothing along it
 * stubbed except the native module at the very end. Asserting "hapticTap was
 * called" would pass with a driver that no-ops and a policy that returns null.
 *
 * The native module is intercepted at its STUB PATH rather than by the bare
 * `expo-haptics` specifier (`vitest.config.ts` aliases one to the other): the
 * quoted specifier in any file but `haptics-driver.ts` is a `check-haptics-imports`
 * offence, and a guard with a test-shaped hole is not a guard.
 *
 * Two properties, each breakable on its own:
 *  1. the press reaches the device, at the weight the rest of the app uses;
 *  2. the user's Vibration switch silences it — and the navigation still runs,
 *     because a silenced haptic must never take the back button with it.
 *
 * The web/PWA no-op is deliberately NOT mounted here. Forcing `Platform.OS`
 * means importing `testing/native-stubs/react-native.tsx` by path, and that
 * file re-exports the untyped `react-native-web`: the import drags it into
 * `tsc --noEmit` (`src/testing` is excluded from the program only until
 * something imports it) and costs two TS7016 errors — the standalone-CI trap
 * this repo has already been bitten by. `fireHaptic` guards web three times
 * over (an early return, a null module load, and a swallowed import throw), so
 * the cost is not worth the coverage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../../testing/mount.js'
import { useSettingsStore } from '../../../../store/settings-store.js'
import { TimelineToolbarInline } from '../TimelineToolbarInline.js'

/**
 * The one faked thing: the native module the driver dynamically imports. Shaped
 * exactly like `src/testing/native-stubs/expo-haptics.ts` (which this replaces)
 * so the driver's structural guard accepts it.
 */
const native = vi.hoisted(() => ({
  impactAsync: vi.fn((): Promise<void> => Promise.resolve()),
  notificationAsync: vi.fn((): Promise<void> => Promise.resolve()),
  selectionAsync: vi.fn((): Promise<void> => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}))

vi.mock('../../../../testing/native-stubs/expo-haptics.js', () => native)

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

/** The back arrow's `accessibilityLabel` — `v2.common.back`, and the test
 *  harness pins the locale to `en` (`native-stubs/expo-localization.ts`). */
const BACK_LABEL = 'Back'

/** What `hapticKindForIntent('tap')` resolves to, expressed in native terms. */
const LIGHT_IMPACT = native.ImpactFeedbackStyle.Light

afterEach(cleanup)

beforeEach(() => {
  native.impactAsync.mockClear()
  native.notificationAsync.mockClear()
  native.selectionAsync.mockClear()
  useSettingsStore.getState().setHaptics('uiFeedback', true)
})

/** Mount the toolbar with the three props it actually requires. */
function renderToolbar(onBack: () => void): HTMLElement {
  const { container } = mountScreen(
    React.createElement(TimelineToolbarInline, {
      onBack,
      dateLabel: () => 'Today',
      qualityLabel: 'Auto',
    }),
  )
  return container
}

/** The rendered back arrow, or a thrown error naming what was missing. */
function backButton(container: HTMLElement): Element {
  const el = container.querySelector(`[aria-label="${BACK_LABEL}"]`)
  if (el === null) throw new Error('the toolbar rendered no back button')
  return el
}

/** Let the driver's dynamic import + promise chain settle. */
async function settleDriver(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

describe("the player's back button", () => {
  it('pulses the device on press, at the ordinary tap weight', async () => {
    const onBack = vi.fn()
    const container = renderToolbar(onBack)

    fireEvent.click(backButton(container))

    // The outcome: the NATIVE call happened, with the light impact every other
    // ordinary press in this app resolves to. A medium impact here would mean
    // the back arrow shouts louder than arming a camera.
    await waitFor(() => expect(native.impactAsync).toHaveBeenCalledWith(LIGHT_IMPACT))
    expect(native.impactAsync).toHaveBeenCalledTimes(1)
    // And exactly once, through one path: a second wiring (in `backToCameras`,
    // say) would double-buzz a single press.
    expect(native.notificationAsync).not.toHaveBeenCalled()
    expect(native.selectionAsync).not.toHaveBeenCalled()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('stays silent when the user switched Vibration off — but still navigates', async () => {
    useSettingsStore.getState().setHaptics('uiFeedback', false)
    const onBack = vi.fn()
    const container = renderToolbar(onBack)

    fireEvent.click(backButton(container))
    await settleDriver()

    expect(native.impactAsync).not.toHaveBeenCalled()
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
