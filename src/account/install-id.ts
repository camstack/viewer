/**
 * This install's stable id — the `deviceId` every account write carries
 * (`preferences.put`, `updatedByDevice` on the hub's row). Opaque: it names
 * an install, never a person, and it is not a secret (it is only a label on a
 * row the user already owns), so `Math.random` is enough.
 *
 * Device level (`store/storage-levels.ts`): generated once, kept until the app
 * is reinstalled or its storage is cleared.
 */
import type { AccountSyncStorage } from './account-settings-sync.js'

export const INSTALL_ID_KEY = '@camstack/v2/install-id'

/** The hub's bound on a writer's id (`PREFERENCES_MAX_DEVICE_ID_LENGTH`). */
const MAX_LENGTH = 64

export function newInstallId(random: () => number = Math.random): string {
  const part = (): string => Math.floor(random() * 0x1_0000_0000).toString(16).padStart(8, '0')
  return `viewer-${part()}${part()}${part()}`
}

function usable(raw: string | null): raw is string {
  return raw !== null && raw.length > 0 && raw.length <= MAX_LENGTH
}

/**
 * The id, created on first use. Memoised per storage: concurrent first calls
 * share one generation, so two writes never stamp two different ids. A storage
 * that cannot be written still yields an id for this run.
 */
export function createInstallIdReader(storage: AccountSyncStorage): () => Promise<string> {
  let pending: Promise<string> | null = null
  const read = async (): Promise<string> => {
    let stored: string | null = null
    try {
      stored = await storage.getItem(INSTALL_ID_KEY)
    } catch {
      stored = null
    }
    if (usable(stored)) return stored
    const id = newInstallId()
    try {
      await storage.setItem(INSTALL_ID_KEY, id)
    } catch {
      // Kept in memory for this run; the next start makes another.
    }
    return id
  }
  return () => {
    pending ??= read()
    return pending
  }
}
