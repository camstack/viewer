/**
 * Mounts the account-settings sync (`account-settings-sync.ts`). Renders
 * nothing.
 *
 * A bridge rather than a call inside a screen: a change must reach the hub
 * from wherever the operator made it, and a change made on another device
 * must arrive whatever screen this one resumed onto. Mounted once, beside the
 * other bridges, inside the connection provider because the port needs the
 * session.
 *
 *   bind     the engine follows the bound hub (`store/server-scope.ts`)
 *   poll     on every return to the foreground, and every 60 s while there
 *   flush    pending pushes go out when the app leaves the foreground
 */
import { useEffect, useMemo } from 'react'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useConnection } from '../connection/ConnectionProvider.js'
import { useServerScopeStore } from '../store/server-scope.js'
import { createAccountSettingsSync } from './account-settings-sync.js'
import { buildAccountSections } from './account-sections.js'
import { createHubAccountPort, type PreferencesClient } from './hub-account-port.js'
import { createInstallIdReader } from './install-id.js'
import { useAccountSyncStore } from './account-sync-store.js'

/** How often a foreground app asks the hub what changed. */
export const ACCOUNT_POLL_MS = 60_000

export function AccountSyncBridge(): null {
  const { controller } = useConnection()
  const serverId = useServerScopeStore((s) => s.serverId)

  const sync = useMemo(
    () =>
      createAccountSettingsSync({
        port: createHubAccountPort({
          // Documented type boundary: see `PreferencesClient`.
          client: () => (controller.getSystem()?.trpcClient as unknown as PreferencesClient | undefined) ?? null,
          deviceId: createInstallIdReader(AsyncStorage),
        }),
        sections: buildAccountSections(),
        storage: AsyncStorage,
        onStatus: (status) => useAccountSyncStore.getState().setStatus(status),
      }),
    [controller],
  )

  useEffect(() => {
    useAccountSyncStore.getState().setSync(sync)
    return () => {
      sync.stop()
      useAccountSyncStore.getState().setSync(null)
    }
  }, [sync])

  useEffect(() => {
    if (serverId === null) return undefined
    void sync.start(serverId)
    let timer: ReturnType<typeof setInterval> | null = null
    const startPolling = (): void => {
      if (timer === null) timer = setInterval(() => void sync.poll(), ACCOUNT_POLL_MS)
    }
    const stopPolling = (): void => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }
    if (AppState.currentState === 'active') startPolling()
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void sync.poll()
        startPolling()
      } else {
        stopPolling()
        void sync.flush()
      }
    })
    return () => {
      stopPolling()
      sub.remove()
    }
  }, [sync, serverId])

  return null
}
