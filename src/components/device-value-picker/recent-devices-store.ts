/**
 * The devices one picker field offered last, most recent first — EPHEMERAL
 * (memory only, this session): a convenience the picker is whole without, so
 * it carries no persisted key (`storage-levels.ts`).
 */
import { create } from 'zustand'

import { pushRecent } from './device-value-picker-model.js'

interface RecentDevicesState {
  readonly byField: Readonly<Record<string, readonly number[]>>
  readonly push: (field: string, deviceId: number) => void
}

export const useRecentDevicesStore = create<RecentDevicesState>((set) => ({
  byField: {},
  push: (field, deviceId) =>
    set((s) => ({ byField: { ...s.byField, [field]: pushRecent(s.byField[field] ?? [], deviceId) } })),
}))

const NO_RECENTS: readonly number[] = []

/** The field's recents and a recorder; a field with no key remembers nothing. */
export function useRecentDevices(field: string | undefined): {
  readonly ids: readonly number[]
  readonly push: (deviceId: number) => void
} {
  const ids = useRecentDevicesStore((s) => (field === undefined ? NO_RECENTS : (s.byField[field] ?? NO_RECENTS)))
  const pushTo = useRecentDevicesStore((s) => s.push)
  return {
    ids,
    push: (deviceId) => {
      if (field !== undefined) pushTo(field, deviceId)
    },
  }
}
