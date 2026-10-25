/**
 * The ONE account-settings sync of the running app, and its status for the
 * Settings screen. `AccountSyncBridge` creates and binds it; the Settings
 * section reads the status and calls `copyFrom`.
 */
import { create } from 'zustand'
import type { AccountSync, AccountSyncStatus } from './account-settings-sync.js'

interface AccountSyncState {
  readonly sync: AccountSync | null
  readonly status: AccountSyncStatus
  setSync: (sync: AccountSync | null) => void
  setStatus: (status: AccountSyncStatus) => void
}

export const LOCAL_ONLY_STATUS: AccountSyncStatus = Object.freeze({
  state: 'local-only',
  lastSyncedAt: null,
  error: null,
})

export const useAccountSyncStore = create<AccountSyncState>((set) => ({
  sync: null,
  status: LOCAL_ONLY_STATUS,
  setSync: (sync) => set({ sync, status: sync?.status() ?? LOCAL_ONLY_STATUS }),
  setStatus: (status) => set({ status }),
}))
