/**
 * device-picker-group-store — how the device picker's sheet groups its list
 * ("Group by": Zone | Location | None) — an ACCOUNT setting, cached per hub
 * (`server-scope.ts`) and synced by `account/account-settings-sync.ts`.
 *
 * One value for every device picker in the app: an operator who prefers rooms
 * to zones prefers them in the rule editor and in the digest alike. The
 * decisions (what each mode draws, and why an unanswered zone read groups by
 * location) are `device-picker-model.ts`; this only keeps the choice.
 *
 * Every read and write is guarded: storage that throws, or holds something
 * this build does not know, is the default (`zone`) — never an error the
 * picker has to render.
 */
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { onServerScopeChange, scopedStorageKey, whenServerScoped } from './server-scope.js'

import {
  parsePickerGroupBy,
  PICKER_DEFAULT_GROUP_BY,
  type PickerGroupBy,
} from '../components/notifications/device-picker-model.js'

export const DEVICE_PICKER_GROUP_KEY = 'camstack.v2.device-picker.group-by'

interface DevicePickerGroupState {
  readonly groupBy: PickerGroupBy
  readonly hydrated: boolean
  /** The hub `groupBy` belongs to; `null` before the first load. */
  readonly serverId: string | null
  hydrate: () => Promise<void>
  setGroupBy: (next: PickerGroupBy) => void
  /** Adopt a value from the account (validated here). */
  applyAccount: (raw: unknown) => void
}

function persist(serverId: string | null, groupBy: PickerGroupBy): void {
  if (serverId === null) return
  try {
    void AsyncStorage.setItem(scopedStorageKey(DEVICE_PICKER_GROUP_KEY, serverId), groupBy).catch(() => undefined)
  } catch {
    // Storage unavailable: the choice holds for this session only.
  }
}

async function readScoped(serverId: string): Promise<PickerGroupBy> {
  try {
    const raw = await AsyncStorage.getItem(scopedStorageKey(DEVICE_PICKER_GROUP_KEY, serverId))
    return raw === null ? PICKER_DEFAULT_GROUP_BY : parsePickerGroupBy(raw)
  } catch {
    return PICKER_DEFAULT_GROUP_BY
  }
}

export const useDevicePickerGroupStore = create<DevicePickerGroupState>((set, get) => ({
  groupBy: PICKER_DEFAULT_GROUP_BY,
  hydrated: false,
  serverId: null,
  hydrate: async () => {
    if (get().hydrated) return
    const serverId = await whenServerScoped()
    const groupBy = await readScoped(serverId)
    // A choice made before hydration finished wins over the stored one.
    if (get().hydrated) return
    set({ groupBy, serverId, hydrated: true })
  },
  setGroupBy: (next) => {
    set({ groupBy: next, hydrated: true })
    persist(get().serverId, next)
  },
  applyAccount: (raw) => {
    const groupBy = typeof raw === 'string' ? parsePickerGroupBy(raw) : PICKER_DEFAULT_GROUP_BY
    set({ groupBy })
    persist(get().serverId, groupBy)
  },
}))

onServerScopeChange((serverId) => {
  void readScoped(serverId).then((groupBy) => useDevicePickerGroupStore.setState({ groupBy, serverId, hydrated: true }))
})
