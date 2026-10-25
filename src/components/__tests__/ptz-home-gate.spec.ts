/**
 * @vitest-environment jsdom
 *
 * PTZ Home is disabled, with a hint, when the camera has no home position —
 * read from the same `ptz.getHomePreset` the admin overlay gates on
 * (`ptz-overlay.tsx`). 2026-09-25, 3836: the viewer drew Home
 * unconditionally, so the operator discovered the missing configuration by
 * pressing it and reading a refusal.
 *
 * Only a hub that ANSWERED `none` disables it (D315): a question still in the
 * air, or one an older hub cannot answer, must not read as "not configured".
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { hubCalls, type HubResponses } from '../../testing/hub-stub.js'
import { PtzControls } from '../camera/PtzControls.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const DEVICE_ID = 3836
const HOME_LABEL = 'Home position'
const NO_HOME_HINT = /No home position set/

const OPTIONS = {
  hasPan: true,
  hasTilt: true,
  hasZoom: false,
  supportsPresets: false,
  hasAutofocus: false,
}

function mount(hub: HubResponses): void {
  mountScreen(React.createElement(PtzControls, { deviceId: DEVICE_ID, hasFeature: true }), {
    hub: { 'ptz.getOptions': OPTIONS, 'ptz.goHome': null, ...hub },
  })
}

function homeButton(): HTMLElement {
  return screen.getByLabelText(HOME_LABEL)
}

function isDisabled(el: HTMLElement): boolean {
  return el.getAttribute('aria-disabled') === 'true'
}

async function pressHome(): Promise<number> {
  fireEvent.click(homeButton())
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  return hubCalls().filter((c) => c.path === 'ptz.goHome').length
}

describe('PTZ Home follows the camera’s home position', () => {
  it('is disabled, with a hint, when the hub answers that no home is set', async () => {
    mount({ 'ptz.getHomePreset': { presetId: null, source: 'none' } })
    await waitFor(() => {
      expect(isDisabled(homeButton())).toBe(true)
    })
    expect(screen.getByText(NO_HOME_HINT)).toBeTruthy()
    expect(await pressHome()).toBe(0)
  })

  it('is enabled when a home is configured', async () => {
    mount({ 'ptz.getHomePreset': { presetId: '1', source: 'operator' } })
    await waitFor(() => {
      expect(hubCalls().some((c) => c.path === 'ptz.getHomePreset')).toBe(true)
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(isDisabled(homeButton())).toBe(false)
    expect(screen.queryByText(NO_HOME_HINT)).toBeNull()
    expect(await pressHome()).toBe(1)
  })

  it('stays enabled while the question is unanswered — pending is not "none"', async () => {
    mount({ 'ptz.getHomePreset': () => new Promise(() => undefined) })
    await waitFor(() => {
      expect(screen.getByLabelText(HOME_LABEL)).toBeTruthy()
    })
    expect(isDisabled(homeButton())).toBe(false)
    expect(screen.queryByText(NO_HOME_HINT)).toBeNull()
  })

  it('stays enabled when the hub cannot answer (an older hub) — unknown is not "none"', async () => {
    mount({})
    await waitFor(() => {
      expect(hubCalls().some((c) => c.path === 'ptz.getHomePreset')).toBe(true)
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(isDisabled(homeButton())).toBe(false)
  })
})
