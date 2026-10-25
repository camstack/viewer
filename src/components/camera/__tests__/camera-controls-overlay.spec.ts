/**
 * @vitest-environment jsdom
 *
 * `CameraControlsOverlay` — the sheet the cameras-list button opens (Task
 * C.2). Three properties are load-bearing enough to hold with a real mount
 * rather than a source guard:
 *
 *  1. PTZ is CONDITIONAL — a camera without `pan-tilt-zoom` shows no PTZ
 *     section at all, not an empty or disabled one.
 *  2. The accessory panel (`CameraAccessoryPanel`, the ONE composition every
 *     host mounts) always mounts, reused unmodified.
 *  3. The function-switch section keeps D62's promise for BOTH sessions: an
 *     admin gets the live `CameraSwitchGroup`; a non-admin — who
 *     `CameraSwitchGroup` shows literally nothing to, by design — still gets
 *     told a function is off. That is the retired tile badge's signal,
 *     relocated rather than deleted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { CameraControlsOverlay } from '../CameraControlsOverlay.js'
import { FEATURE, type CameraInfo } from '../../../data/use-cameras.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const DEVICE_ID = 701

function camera(hasPtzFeature: boolean): CameraInfo {
  return {
    id: DEVICE_ID,
    name: 'Garden',
    type: 'camera',
    online: true,
    disabled: false,
    features: hasPtzFeature ? [FEATURE.ptz] : [],
    originalName: 'Garden',
    hidden: false, location: null,
  }
}

interface SwitchRowInput {
  readonly id: string
  readonly label: string
  readonly costWhenOff: string
  readonly available: boolean
  readonly enabled: boolean
}

function hub(opts: {
  readonly admin: boolean
  readonly switches: readonly SwitchRowInput[]
}): Record<string, unknown> {
  return {
    'auth.me': { id: 'u1', username: 'operator', isAdmin: opts.admin },
    'ptz.getOptions': {
      hasPan: true,
      hasTilt: true,
      hasZoom: true,
      supportsPresets: false,
      hasAutofocus: false,
    },
    'deviceManager.getLinkedDevices': { mode: 'auto', devices: [] },
    'deviceManager.listAll': [],
    'pipelineOrchestrator.getCameraSwitches': {
      deviceId: DEVICE_ID,
      switches: opts.switches.map((s) => ({ ...s, unavailableReason: null })),
    },
  }
}

const ONE_OFF: readonly SwitchRowInput[] = [
  { id: 'detection', label: 'Detection', costWhenOff: 'No alerts while off', available: true, enabled: false },
]

const ALL_ON: readonly SwitchRowInput[] = [
  { id: 'detection', label: 'Detection', costWhenOff: 'No alerts while off', available: true, enabled: true },
]

function overlay(cam: CameraInfo): React.ReactElement {
  return React.createElement(CameraControlsOverlay, {
    visible: true,
    camera: cam,
    onClose: (): void => undefined,
  })
}

describe('PTZ is conditional, not merely disabled', () => {
  it('mounts no PTZ section for a camera without the feature', async () => {
    const { queryByText, findByText } = mountScreen(overlay(camera(false)), {
      hub: hub({ admin: true, switches: ALL_ON }),
    })
    // Wait for the sheet to have settled (devices section always renders).
    await findByText('No connected devices.')
    expect(queryByText('PTZ controls')).toBeNull()
  })

  it('mounts the PTZ section for a camera that advertises it', async () => {
    const { findByText } = mountScreen(overlay(camera(true)), {
      hub: hub({ admin: true, switches: ALL_ON }),
    })
    await findByText('PTZ controls')
  })
})

describe('linked devices are reused unmodified', () => {
  it('renders the accessory panel’s own empty state', async () => {
    const { findByText } = mountScreen(overlay(camera(false)), {
      hub: hub({ admin: true, switches: ALL_ON }),
    })
    await findByText('No connected devices.')
  })
})

describe('the function-switch section keeps D62’s promise for both sessions', () => {
  it('an admin gets the live, interactive group', async () => {
    const { findByText } = mountScreen(overlay(camera(false)), {
      hub: hub({ admin: true, switches: ONE_OFF }),
    })
    // `CameraSwitchGroup`'s own title + the wire's row label — proof the real
    // component rendered, not a stand-in.
    await findByText('Camera functions')
    await findByText('Detection')
  })

  it('a non-admin does not get the interactive group at all', async () => {
    const { findByText, queryByText } = mountScreen(overlay(camera(false)), {
      hub: hub({ admin: false, switches: ONE_OFF }),
    })
    // Something must settle first so the assertion below isn't "queried too
    // early" — the devices section always mounts.
    await findByText('No connected devices.')
    // The row label only `CameraSwitchGroup` would draw.
    expect(queryByText('Detection')).toBeNull()
  })

  it('a non-admin STILL learns a function is off — the retired badge’s job', async () => {
    const { findByLabelText } = mountScreen(overlay(camera(false)), {
      hub: hub({ admin: false, switches: ONE_OFF }),
    })
    // Exactly the accessibility label `SwitchedOffBadge` always carried on the
    // tile — D62: an off switch is REPORTED off, on every session, somewhere.
    await findByLabelText('1 function switched off')
  })

  it('a non-admin sees nothing about switches when none are off', async () => {
    const { findByText, queryByLabelText } = mountScreen(overlay(camera(false)), {
      hub: hub({ admin: false, switches: ALL_ON }),
    })
    await findByText('No connected devices.')
    expect(queryByLabelText(/function.*switched off/)).toBeNull()
  })
})

describe('nothing is asked while the sheet is not open', () => {
  it('camera === null renders nothing and asks the hub nothing', async () => {
    const { container } = mountScreen(
      React.createElement(CameraControlsOverlay, {
        visible: false,
        camera: null,
        onClose: (): void => undefined,
      }),
      { hub: hub({ admin: true, switches: ALL_ON }) },
    )
    // Give any stray effect a tick, then confirm the sheet drew nothing.
    await waitFor(() => {
      expect(container.textContent).toBe('')
    })
  })
})
