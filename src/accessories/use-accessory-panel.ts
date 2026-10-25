/**
 * useAccessoryPanel — the composed rows of one camera's accessory panel, and
 * the five local edit operations over them.
 *
 * Reads: the hub's linked devices (`useLinkedDevices`), the operator's local
 * additions resolved to devices (`useLocalAccessories`), the camera's local
 * document (`camera-prefs-store`), and the role icon defaults. Decides
 * nothing itself — `composeAccessoryRows` is the rule, and every write goes
 * through one `accessory-prefs.ts` reducer applied to the LATEST stored
 * document inside the store.
 *
 * Nothing here touches the hub's link set. The only writes are to the local
 * prefs store.
 */
import { useMemo } from 'react'
import {
  isActuatingControlKind,
  pickAccessoryControl,
} from '../components/camera/accessory-controls/control-registry.js'
import { stripParentName } from '../components/camera/strip-parent-name.js'
import { useCameras } from '../data/use-cameras.js'
import { useLinkedDevices, type LinkedPanelDevice } from '../data/use-linked-devices.js'
import { EMPTY_ROLE_ICONS, useRoleIconDefaults } from '../data/use-role-display-defaults.js'
import { cameraAccessoryPrefs, useCameraPrefsStore } from '../store/camera-prefs-store.js'
import {
  composeAccessoryRows,
  shownOrder,
  type AccessoryPanelDevice,
  type AccessoryPanelRow,
} from './accessory-panel-rows.js'
import {
  moveAccessoryEntry,
  removeAccessoryEntry,
  setAccessoryAdditionsEntry,
  setAccessoryHiddenEntry,
  setAccessoryIconEntry,
  setAccessoryNameEntry,
  type CameraAccessoryPrefs,
} from './accessory-prefs.js'
import { NO_LOCAL_ACCESSORIES, useLocalAccessories } from './use-local-accessories.js'

/** The five local edit operations, plus removing a local addition (the
 *  inverse of adding — without it a wrong tap would be permanent). */
export interface AccessoryPanelActions {
  readonly setAdditions: (ids: readonly number[]) => void
  readonly remove: (id: number) => void
  readonly rename: (id: number, name: string) => void
  readonly setIcon: (id: number, icon: string | null) => void
  readonly setHidden: (id: number, hidden: boolean) => void
  readonly move: (id: number, delta: -1 | 1) => void
}

export interface AccessoryPanelState {
  readonly rows: readonly AccessoryPanelRow[]
  /** True until the hub's linked list has answered once. Local additions do
   *  not gate this: the server list is what the panel has always waited for. */
  readonly loading: boolean
  /** Ids the hub links — what the picker must not offer again. */
  readonly serverIds: readonly number[]
  readonly prefs: CameraAccessoryPrefs
  readonly actions: AccessoryPanelActions
}

/** Stable empty list so an unanswered server read does not churn the memo. */
const NO_SERVER_DEVICES: readonly LinkedPanelDevice[] = Object.freeze([])

/** The control registry's verdict, bound to the rule's device shape. */
export function accessoryActuates(device: AccessoryPanelDevice): boolean {
  return isActuatingControlKind(
    pickAccessoryControl({ type: device.type, features: device.features }).kind,
  )
}

export function useAccessoryPanel(deviceId: number, editing: boolean): AccessoryPanelState {
  const { data: linked, isLoading } = useLinkedDevices(deviceId)
  const prefs = useCameraPrefsStore((s) => cameraAccessoryPrefs(s.prefs, deviceId))
  const updateAccessories = useCameraPrefsStore((s) => s.updateCameraAccessories)
  const { data: local = NO_LOCAL_ACCESSORIES } = useLocalAccessories(prefs.added)
  const { data: roleIcons = EMPTY_ROLE_ICONS } = useRoleIconDefaults()
  // `includeHidden` — a camera hidden from the LIST is still the parent of the
  // accessories shown under it. Without this, hiding a camera silently stopped
  // its children's names from being trimmed.
  const { data: cameras = [] } = useCameras({ includeHidden: true })
  const parent = cameras.find((c) => c.id === deviceId)
  const parentName = parent?.name
  const parentOriginal = parent?.originalName

  const server = linked?.devices ?? NO_SERVER_DEVICES
  const rows = useMemo(
    () =>
      composeAccessoryRows({
        server,
        local,
        prefs,
        roleIcons,
        actuates: accessoryActuates,
        stripParent: (name) => stripParentName(name, parentName, parentOriginal),
        editing,
      }),
    [server, local, prefs, roleIcons, parentName, parentOriginal, editing],
  )

  const actions = useMemo<AccessoryPanelActions>(
    () => ({
      setAdditions: (ids) => updateAccessories(deviceId, (p) => setAccessoryAdditionsEntry(p, ids)),
      remove: (id) => updateAccessories(deviceId, (p) => removeAccessoryEntry(p, id)),
      rename: (id, name) => updateAccessories(deviceId, (p) => setAccessoryNameEntry(p, id, name)),
      setIcon: (id, icon) => updateAccessories(deviceId, (p) => setAccessoryIconEntry(p, id, icon)),
      setHidden: (id, hidden) =>
        updateAccessories(deviceId, (p) => setAccessoryHiddenEntry(p, id, hidden)),
      // The move is relative to the order the panel SHOWS (edit mode, hidden
      // rows included) — see `moveAccessoryEntry`.
      move: (id, delta) =>
        updateAccessories(deviceId, (p) => moveAccessoryEntry(p, shownOrder(rows), id, delta)),
    }),
    [deviceId, rows, updateAccessories],
  )

  const serverIds = useMemo(() => server.map((d) => d.id), [server])

  return {
    rows,
    loading: isLoading && linked === undefined,
    serverIds,
    prefs,
    actions,
  }
}
