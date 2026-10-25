// @vitest-environment jsdom
/**
 * The rename of a linked device happens IN THE ROW, with no second window.
 *
 * ## What it was, and what it cost
 *
 * *"Il rename dei devices blocca la ui, non si vede nulla ma blocca la
 * interfaccia"* — the operator, 2026-09-23.
 *
 * The rename called `usePrompt`, whose dialog is a `<Modal>` rendered by the
 * ROOT `ConfirmProvider`. Two of the three hosts that mount
 * `CameraAccessoryPanel` are themselves `<Modal>`s (`CameraControlsOverlay`,
 * the cameras-list sheet the operator was on). On iOS the root view
 * controller is already presenting that sheet, so UIKit refuses the second
 * presentation: nothing is drawn, the promise the row is awaiting never
 * settles, and the surface is left with an unresponsive window over it. This
 * repo has paid for the exact same shape once already — see
 * `events/track/__tests__/track-detail-modal-dialogs.spec.ts` (2026-09-06).
 *
 * The panel's OWN sheets (add, icon) never had it: they render inside the
 * panel's subtree, i.e. inside the presenting modal. Only the rename left it.
 *
 * ## What it is now
 *
 * The mechanism the operator asked for by name — the one
 * `CamerasManageScreen` uses: an inline `TextInput` in the row, draft held
 * locally, committed on blur or submit. No dialog exists to be presented from
 * anywhere, so no host can refuse it.
 *
 * ## What this pins, and what it cannot
 *
 * The UIKit refusal itself is unreachable from vitest — there is no view
 * controller here. What IS pinnable, and is the whole point, is that the
 * rename completes with NOTHING mounted above the panel: the field is in the
 * row, the write lands in the local prefs store, and no dialog (`role=alert`,
 * which is what the confirm card wears) is ever raised. Disarm the inline
 * field and every assertion below goes red.
 */
import React from 'react'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mountScreen } from '../../../../testing/mount.js'
import { cameraAccessoryPrefs, DEFAULTS, useCameraPrefsStore } from '../../../../store/camera-prefs-store.js'
import { AccessoryDeviceList } from '../AccessoryDeviceList.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERA_ID = 101
const LIGHT_ID = 900
/** The hub's own name for the accessory — what the row falls back to. */
const HUB_NAME = 'Faretto front door'

/** One camera, one linked light. `listAll` serves two different readers here
 *  (the camera list and the linked-device enrichment join) exactly as the hub
 *  does, discriminated on the input they actually send. */
const HUB = {
  'deviceManager.listAll': (input?: unknown) => {
    const isCamera =
      typeof input === 'object' && input !== null && (input as { isCamera?: boolean }).isCamera === true
    if (isCamera) {
      return [
        { id: CAMERA_ID, name: 'Front door', type: 'camera', online: true, isCamera: true, features: [] },
      ]
    }
    return [{ id: LIGHT_ID, type: 'light', online: true }]
  },
  'deviceManager.getLinkedDevices': {
    mode: 'manual',
    devices: [{ deviceId: LIGHT_ID, name: HUB_NAME, location: 'Front door', features: ['on'] }],
  },
} as const

function storedName(): string | undefined {
  return cameraAccessoryPrefs(useCameraPrefsStore.getState().prefs, CAMERA_ID).byId[LIGHT_ID]?.name
}

/** The rename control, whatever it is drawn as. */
function renameField(): HTMLElement {
  return screen.getByLabelText(`Rename ${HUB_NAME}`)
}

async function mountEditing(): Promise<void> {
  mountScreen(
    React.createElement(AccessoryDeviceList, {
      deviceId: CAMERA_ID,
      cameraName: 'Front door',
      editing: true,
    }),
    { hub: HUB },
  )
  await waitFor(() => {
    expect(renameField()).toBeTruthy()
  })
}

beforeEach(() => {
  useCameraPrefsStore.setState({ prefs: DEFAULTS })
})

afterEach(() => {
  cleanup()
  useCameraPrefsStore.setState({ prefs: DEFAULTS })
})

describe('the rename is a field in the row, not a window over the app', () => {
  it('is a text input the operator can type into', async () => {
    await mountEditing()
    // A `Pressable` renders as a div here; the point of the change is that the
    // editable surface IS the row.
    expect(renameField().tagName.toLowerCase()).toBe('input')
    expect((renameField() as HTMLInputElement).value).toBe(HUB_NAME)
  })

  it('writes the local name on blur, with no dialog raised', async () => {
    await mountEditing()
    fireEvent.change(renameField(), { target: { value: 'Luce cancello' } })
    fireEvent.blur(renameField())
    await waitFor(() => {
      expect(storedName()).toBe('Luce cancello')
    })
    // The confirm/prompt card is the only `alert` in this tree. If the rename
    // still went through the root surface, one would be here.
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('commits on submit too, so the keyboard’s done key finishes the job', async () => {
    await mountEditing()
    fireEvent.change(renameField(), { target: { value: 'Portone' } })
    fireEvent.keyDown(renameField(), { key: 'Enter', code: 'Enter', keyCode: 13 })
    await waitFor(() => {
      expect(storedName()).toBe('Portone')
    })
  })

  it('an emptied field CLEARS the override — it does not store a blank name', async () => {
    useCameraPrefsStore.setState({
      prefs: {
        ...DEFAULTS,
        byId: {
          ...DEFAULTS.byId,
          [CAMERA_ID]: {
            accessories: { added: [], order: [], byId: { [LIGHT_ID]: { name: 'Vecchio' } } },
          },
        },
      },
    })
    mountScreen(
      React.createElement(AccessoryDeviceList, {
        deviceId: CAMERA_ID,
        cameraName: 'Front door',
        editing: true,
      }),
      { hub: HUB },
    )
    const field = await screen.findByLabelText('Rename Vecchio')
    expect((field as HTMLInputElement).value).toBe('Vecchio')
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.blur(field)
    await waitFor(() => {
      expect(storedName()).toBeUndefined()
    })
    // …and the field must now SHOW what the row fell back to. Leaving the
    // three spaces on screen beside a row the rest of the app calls
    // "Faretto front door" is the field lying about the state it just wrote —
    // the draft is re-seeded whenever the row's label moves under it.
    await waitFor(() => {
      expect((screen.getByLabelText(`Rename ${HUB_NAME}`) as HTMLInputElement).value).toBe(HUB_NAME)
    })
  })

  it('re-seeds when the name changes from OUTSIDE the field', async () => {
    // A profile sync, a second surface, or the row simply being recomposed:
    // whatever moves the label, the field follows it. Without this the
    // operator types into a box showing a name nothing else agrees with.
    await mountEditing()
    fireEvent.change(renameField(), { target: { value: 'a mezzo scrivere' } })
    useCameraPrefsStore.getState().updateCameraAccessories(CAMERA_ID, (p) => ({
      ...p,
      byId: { ...p.byId, [LIGHT_ID]: { name: 'Luce vialetto' } },
    }))
    await waitFor(() => {
      expect((screen.getByLabelText('Rename Luce vialetto') as HTMLInputElement).value).toBe(
        'Luce vialetto',
      )
    })
  })

  it('never writes the hub — the name lives in the viewer’s prefs only', async () => {
    const { hubCalls } = await import('../../../../testing/hub-stub.js')
    await mountEditing()
    fireEvent.change(renameField(), { target: { value: 'Luce cancello' } })
    fireEvent.blur(renameField())
    await waitFor(() => {
      expect(storedName()).toBe('Luce cancello')
    })
    expect(hubCalls().filter((c) => c.kind === 'mutate')).toHaveLength(0)
  })
})

describe('the other edit operations of the row survive the change', () => {
  it('still offers the icon, reorder and hide controls beside the field', async () => {
    await mountEditing()
    expect(screen.getByLabelText(`Change the icon of ${HUB_NAME}`)).toBeTruthy()
    expect(screen.getByLabelText(`Move ${HUB_NAME} up`)).toBeTruthy()
    expect(screen.getByLabelText(`Move ${HUB_NAME} down`)).toBeTruthy()
    expect(screen.getByLabelText(`Hide ${HUB_NAME}`)).toBeTruthy()
    // A server-linked row is never removable here — only a local addition is.
    expect(screen.queryByLabelText(`Remove ${HUB_NAME} from this list`)).toBeNull()
  })
})
