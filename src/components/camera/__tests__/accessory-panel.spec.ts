/**
 * @vitest-environment jsdom
 *
 * The camera accessory panel — ONE composition, three hosts, a local edit
 * mode for every session, and NO write to the hub's link set.
 *
 * Settled with the operator on 2026-09-22: the local list is an ADDITION to
 * the hub's linked devices, never a replacement. The "+" writes the camera's
 * prefs document; the hub is never asked to change what it links.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { CameraAccessoryPanel } from '../accessory-panel/CameraAccessoryPanel.js'
import { useCameraPrefsStore, cameraAccessoryPrefs } from '../../../store/camera-prefs-store.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)
beforeEach(() => {
  useCameraPrefsStore.getState().applyAccount({ byId: {}, order: [] })
})

const HERE = __dirname
const ROOT = join(HERE, '..', '..', '..', '..')
const SRC = (...parts: readonly string[]): string => readFileSync(join(ROOT, 'src', ...parts), 'utf8')
const ADD_SHEET = SRC('components', 'camera', 'accessory-panel', 'AccessoryAddSheet.tsx')
/** The sheet frame the add sheet (and the notification device picker) opens. */
const PICKER_SHEET = SRC('components', 'ui', 'PickerSheet.tsx')
const SHEET_MODAL = SRC('components', 'ui', 'SheetModal.tsx')

const CAMERA_ID = 701

interface FleetRow {
  readonly id: number
  readonly name: string
  readonly type: string
  readonly online: boolean
  readonly features: readonly string[]
  readonly location: string
  readonly parentDeviceId: null
  readonly isCamera?: boolean
  readonly disabled?: boolean
}

const CAMERA: FleetRow = {
  id: CAMERA_ID,
  name: 'Garden',
  type: 'camera',
  online: true,
  disabled: false,
  features: [],
  location: 'Garden',
  isCamera: true,
  parentDeviceId: null,
}
const LINKED_SIREN: FleetRow = {
  id: 800,
  name: 'Patio siren',
  type: 'siren',
  online: true,
  features: ['switch'],
  location: 'Garden',
  parentDeviceId: null,
}
const FOUNTAIN_PLUG: FleetRow = {
  id: 900,
  name: 'Fountain plug',
  type: 'switch',
  online: true,
  features: ['switch'],
  location: 'Garden',
  parentDeviceId: null,
}
const HUMIDITY: FleetRow = {
  id: 901,
  name: 'Humidity',
  type: 'sensor',
  online: true,
  features: ['humidity-sensor'],
  location: 'Garden',
  parentDeviceId: null,
}
const FLEET: readonly FleetRow[] = [CAMERA, LINKED_SIREN, FOUNTAIN_PLUG, HUMIDITY]

interface ListAllInput {
  readonly isCamera?: boolean
  readonly deviceIds?: readonly number[]
}

function hub(opts: { readonly admin: boolean; readonly linked: readonly number[] }): Record<string, unknown> {
  return {
    'auth.me': { id: 'u1', username: 'operator', isAdmin: opts.admin },
    'deviceManager.getLinkedDevices': {
      mode: 'auto',
      devices: FLEET.filter((d) => opts.linked.includes(d.id)).map((d) => ({
        deviceId: d.id,
        name: d.name,
        location: d.location,
        features: d.features,
      })),
    },
    // ONE stub answers every `listAll` shape the panel asks: the camera list,
    // the enrichment join, the local-additions join and the picker catalogue.
    'deviceManager.listAll': (input: unknown) => {
      const i = (input ?? {}) as ListAllInput
      if (i.isCamera === true) return FLEET.filter((d) => d.isCamera === true)
      if (Array.isArray(i.deviceIds)) return FLEET.filter((d) => i.deviceIds?.includes(d.id))
      return FLEET
    },
    'pipelineOrchestrator.getCameraSwitches': { deviceId: CAMERA_ID, switches: [] },
  }
}

function panel(): React.ReactElement {
  return React.createElement(CameraAccessoryPanel, { deviceId: CAMERA_ID, cameraName: 'Garden' })
}

describe('the pencil is for everyone', () => {
  it('a NON-admin gets the edit mode and the "+"', async () => {
    const { findByLabelText, findByText, queryByLabelText } = mountScreen(panel(), {
      hub: hub({ admin: false, linked: [800] }),
    })
    await findByText('Patio siren')
    expect(queryByLabelText('Add devices')).toBeNull()
    fireEvent.click(await findByLabelText('Customise the devices'))
    await findByLabelText('Add devices')
    await findByLabelText('Hide Patio siren')
  })

  it('a server-linked device can be hidden but never removed here', async () => {
    const { findByLabelText, queryByLabelText } = mountScreen(panel(), {
      hub: hub({ admin: false, linked: [800] }),
    })
    fireEvent.click(await findByLabelText('Customise the devices'))
    await findByLabelText('Hide Patio siren')
    expect(queryByLabelText('Remove Patio siren from this list')).toBeNull()
  })
})

describe('the "+" is a LOCAL addition', () => {
  it('saving writes the prefs document and sends the hub NO mutation', async () => {
    const { findByLabelText, findByText } = mountScreen(panel(), {
      hub: hub({ admin: false, linked: [800] }),
    })
    fireEvent.click(await findByLabelText('Customise the devices'))
    fireEvent.click(await findByLabelText('Add devices'))
    // The picker: the fountain plug is suggested (same room); the linked siren
    // is NOT offered again; the humidity reading is withheld (no control).
    const plug = await findByText(/Fountain plug/)
    expect(await waitFor(() => document.body.textContent)).not.toContain('Patio siren (Garden)')
    expect(document.body.textContent).not.toContain('Humidity')
    fireEvent.click(plug)
    fireEvent.click(await findByLabelText('Keep these additions'))

    await waitFor(() => {
      expect(cameraAccessoryPrefs(useCameraPrefsStore.getState().prefs, CAMERA_ID).added).toEqual([900])
    })
    // The row is drawn from the local document, flagged as such… In EDIT mode
    // the name is the inline rename FIELD, not a text node (the prompt it
    // replaced could not be presented from a modal host — see
    // `accessory-panel/__tests__/accessory-rename-inline.spec.ts`), so the row
    // is identified by the field that carries its name.
    expect((await findByLabelText('Rename Fountain plug')) as HTMLInputElement).toHaveProperty(
      'value',
      'Fountain plug',
    )
    await findByText(/Added here/)
    // …and the hub was never asked to change anything.
    expect(hubCalls().filter((c) => c.kind === 'mutate')).toEqual([])
  })

  it('a local addition survives the hub unlinking everything; a server row does not', async () => {
    useCameraPrefsStore.getState().updateCameraAccessories(CAMERA_ID, (p) => ({ ...p, added: [900] }))
    const { findByText, queryByText } = mountScreen(panel(), {
      hub: hub({ admin: false, linked: [] }),
    })
    await findByText('Fountain plug')
    expect(queryByText('Patio siren')).toBeNull()
  })
})

describe('customisations apply to both origins, and hide is local', () => {
  it('a hidden device leaves the view and comes back in edit mode', async () => {
    const { findByLabelText, queryByText } = mountScreen(panel(), {
      hub: hub({ admin: false, linked: [800] }),
    })
    fireEvent.click(await findByLabelText('Customise the devices'))
    fireEvent.click(await findByLabelText('Hide Patio siren'))
    await findByLabelText('Show Patio siren')
    fireEvent.click(await findByLabelText('Done customising'))
    await waitFor(() => {
      expect(queryByText('Patio siren')).toBeNull()
    })
    expect(cameraAccessoryPrefs(useCameraPrefsStore.getState().prefs, CAMERA_ID).byId[800]).toEqual({ hidden: true })
    expect(hubCalls().filter((c) => c.kind === 'mutate')).toEqual([])
    // Still there for the operator to bring back — as the edit mode's rename
    // field, which is what the name is drawn as once the pencil is on.
    fireEvent.click(await findByLabelText('Customise the devices'))
    expect((await findByLabelText('Rename Patio siren')) as HTMLInputElement).toHaveProperty(
      'value',
      'Patio siren',
    )
  })
})

describe('the function switches live in the panel', () => {
  it('an admin gets the live group inside the same panel', async () => {
    const { findByText } = mountScreen(panel(), {
      hub: {
        ...hub({ admin: true, linked: [800] }),
        'pipelineOrchestrator.getCameraSwitches': {
          deviceId: CAMERA_ID,
          switches: [
            { id: 'detection', label: 'Detection', costWhenOff: 'No alerts', available: true, enabled: true, unavailableReason: null },
          ],
        },
      },
    })
    await findByText('Camera functions')
    await findByText('Detection')
  })

  it('a non-admin still learns a function is off — the badge, inside the panel', async () => {
    const { findByLabelText } = mountScreen(panel(), {
      hub: {
        ...hub({ admin: false, linked: [800] }),
        'pipelineOrchestrator.getCameraSwitches': {
          deviceId: CAMERA_ID,
          switches: [
            { id: 'detection', label: 'Detection', costWhenOff: 'No alerts', available: true, enabled: false, unavailableReason: null },
          ],
        },
      },
    })
    await findByLabelText('1 function switched off')
  })
})

describe('one composition, three hosts', () => {
  it('the three hosts mount CameraAccessoryPanel and nothing composes the bricks again', () => {
    const hosts = [
      'src/components/camera/CameraControlsOverlay.tsx',
      'src/components/camera/theater/TimelineLinkedDevicesPanel.tsx',
      'src/components/grid/GridCellPanelOverlay.tsx',
    ]
    expect([...filesMounting(ROOT, '<CameraAccessoryPanel')].sort()).toEqual([...hosts].sort())
    // The switch group has exactly ONE mount: the panel. The camera menu that
    // used to duplicate it does not.
    expect(filesMounting(ROOT, '<CameraSwitchGroup')).toEqual([
      'src/components/camera/accessory-panel/CameraAccessoryPanel.tsx',
    ])
    expect(filesMounting(ROOT, '<AccessoryAddSheet')).toEqual([
      'src/components/camera/accessory-panel/AccessoryDeviceList.tsx',
    ])
  })
})

describe('the keyboard does not cover the picker (inherited from the old sheet)', () => {
  it('lays itself out around the keyboard, closes the keyboard before the sheet, and drops the covered inset', () => {
    // The frame is shared (`ui/PickerSheet.tsx`, D636): the add sheet opens it.
    expect(ADD_SHEET).toContain('<PickerSheet')
    // The keyboard avoidance itself lives in the shared sheet frame, always on.
    expect(PICKER_SHEET).toContain('<SheetModal')
    expect(SHEET_MODAL).toContain('<KeyboardInsetView')
    expect(PICKER_SHEET).toContain('if (keyboardUp) {')
    expect(PICKER_SHEET).toContain('Keyboard.dismiss()')
    expect(PICKER_SHEET).toContain('paddingBottom: (keyboardUp ? 0 : insets.bottom) + SPACING.md')
    expect(ADD_SHEET).toContain('keyboardShouldPersistTaps="handled"')
  })
})

/** Every file under `src/` that mounts `<Component`, repo-relative. */
function filesMounting(root: string, needle: string): readonly string[] {
  const out = execFileSync('grep', ['-rl', '--include=*.tsx', needle, join(root, 'src')], {
    encoding: 'utf8',
  })
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.slice(root.length + 1))
    .sort()
}
