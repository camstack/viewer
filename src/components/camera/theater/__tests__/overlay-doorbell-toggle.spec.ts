/**
 * @vitest-environment jsdom
 *
 * The doorbell overlay switch is offered only for a camera with the doorbell
 * feature (the host passes `hasDoorbell`), and writes `doorbell` into the
 * camera's overlay document.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent } from '@testing-library/react'

import { mountScreen } from '../../../../testing/mount.js'
import { OVERLAY_DEFAULTS, type CameraOverlayConfig } from '../../overlay/overlay-config.js'
import { OverlaySettingsSections } from '../TimelineOverlayPanel.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

const HIGHLIGHT = { motion: true, audio: false, detection: false } as never

function mount(hasDoorbell: boolean | undefined, onChange: (c: CameraOverlayConfig) => void) {
  return mountScreen(
    React.createElement(OverlaySettingsSections, {
      deviceId: 7,
      context: 'single',
      config: OVERLAY_DEFAULTS,
      onChange,
      highlight: HIGHLIGHT,
      onSetHighlight: () => undefined,
      hasDoorbell,
    }),
  )
}

afterEach(cleanup)

describe('doorbell overlay switch', () => {
  it('is not offered for a camera without a doorbell', () => {
    const view = mount(undefined, () => undefined)
    expect(view.queryByText('Doorbell')).toBeNull()
  })

  it('is offered for a doorbell camera, off, and turns the overlay on', () => {
    const onChange = vi.fn()
    const view = mount(true, onChange)
    const label = view.getByText('Doorbell')
    const row = label.parentElement as HTMLElement
    fireEvent.click(row.querySelector('input[type="checkbox"], [role="switch"]') as HTMLElement)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ doorbell: true })
  })
})
