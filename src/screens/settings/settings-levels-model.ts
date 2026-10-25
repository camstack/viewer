/**
 * settings-levels-model — the pure half of Settings → App's two level
 * sections: what the account sync line says, and which hubs can be copied
 * from. RN-free, so the rules are unit tested.
 */
import type { AccountSyncStatus } from '../../account/account-settings-sync.js'

/** One line: an i18n key and its arguments. */
export interface SyncLine {
  readonly key: string
  readonly args?: Readonly<Record<string, string | number>>
  /** The line reports a failure (rendered in the danger colour). */
  readonly danger: boolean
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** What the sync status line says, `now` injected. */
export function syncStatusLine(status: AccountSyncStatus, now: number): SyncLine {
  switch (status.state) {
    case 'local-only':
      if (status.unavailable === 'hub') return { key: 'v2.settings.levels.localOnlyHub', danger: false }
      if (status.unavailable === 'credential') return { key: 'v2.settings.levels.localOnlyCredential', danger: false }
      return { key: 'v2.settings.levels.localOnly', danger: false }
    case 'syncing':
      return { key: 'v2.settings.levels.syncing', danger: false }
    case 'error':
      return { key: 'v2.settings.levels.syncError', args: { error: status.error ?? '' }, danger: true }
    case 'synced': {
      const ago = Math.max(0, now - (status.lastSyncedAt ?? now))
      if (ago < MINUTE_MS) return { key: 'v2.settings.levels.syncedNow', danger: false }
      if (ago < HOUR_MS)
        return { key: 'v2.settings.levels.syncedMinutes', args: { count: Math.floor(ago / MINUTE_MS) }, danger: false }
      if (ago < DAY_MS)
        return { key: 'v2.settings.levels.syncedHours', args: { count: Math.floor(ago / HOUR_MS) }, danger: false }
      return { key: 'v2.settings.levels.syncedDays', args: { count: Math.floor(ago / DAY_MS) }, danger: false }
    }
  }
}

/** A hub this device knows. */
export interface KnownHub {
  readonly id: string
  readonly signedIn: boolean
}

/** The hubs whose account settings can be copied here: signed in, not this one. */
export function copySourceHubs<H extends KnownHub>(hubs: readonly H[], activeId: string | null): readonly H[] {
  return hubs.filter((h) => h.signedIn && h.id !== activeId)
}
