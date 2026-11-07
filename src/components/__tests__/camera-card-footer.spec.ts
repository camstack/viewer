/**
 * @vitest-environment jsdom
 *
 * The Cameras-page card footer: two glass buttons (PiP window, controls), no
 * child-device state icons.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mountScreen } from '../../testing/mount.js'
import { SnapshotOverviewProvider } from '../../data/SnapshotOverviewProvider.js'
import { CameraCard } from '../CameraCard.js'
import type { CameraInfo } from '../../data/use-cameras.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const DEVICE_ID = 7

const CAMERA: CameraInfo = {
  id: DEVICE_ID,
  name: 'Porch',
  type: 'camera',
  online: true,
  disabled: false,
  features: [],
  originalName: 'Porch',
  hidden: false,
  location: null,
}

interface Handlers {
  readonly onPress: () => void
  readonly onOpenControls: () => void
  readonly onOpenOverlay: () => void
}

function card(handlers: Handlers): React.ReactElement {
  return React.createElement(SnapshotOverviewProvider, {
    deviceIds: [DEVICE_ID],
    enabled: true,
    children: React.createElement(CameraCard, {
      camera: CAMERA,
      ...handlers,
      isFavourite: false,
      onToggleFavourite: () => {},
    }),
  })
}

function handlers(): Handlers {
  return { onPress: vi.fn(), onOpenControls: vi.fn(), onOpenOverlay: vi.fn() }
}

describe('camera card footer', () => {
  it('opens the overlay from its glass button without navigating', () => {
    const h = handlers()
    const { getByLabelText } = mountScreen(card(h))
    fireEvent.click(getByLabelText('Play in the movable window'))
    expect(h.onOpenOverlay).toHaveBeenCalledTimes(1)
    expect(h.onOpenControls).not.toHaveBeenCalled()
    expect(h.onPress).not.toHaveBeenCalled()
  })

  it('opens the controls from its glass button without navigating', () => {
    const h = handlers()
    const { getByLabelText } = mountScreen(card(h))
    fireEvent.click(getByLabelText('Camera controls'))
    expect(h.onOpenControls).toHaveBeenCalledTimes(1)
    expect(h.onOpenOverlay).not.toHaveBeenCalled()
    expect(h.onPress).not.toHaveBeenCalled()
  })

  it('draws both footer actions as GlassButtons and no child-device state icons', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'components', 'CameraCard.tsx'), 'utf8')
    expect(src.match(/<GlassButton\b/g) ?? []).toHaveLength(2)
    expect(src).not.toMatch(/ChildStateIcons|childStates|use-children-states|KIND_ICON/)
  })
})
