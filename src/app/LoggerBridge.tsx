import React, { useEffect } from 'react'
import { useServer } from './ServerProvider.js'
import { useDeviceSettingsStore } from '../store/device-settings-store.js'
import { configureLogShipping, setLogVerbose, log } from '../lib/logger.js'

/** Headless bridge that wires the unified logger to app state:
 *  - debug-mode flag → logger verbosity (capture/ship `debug` logs)
 *  - active server + token → batched log shipping to the hub
 *  Rendered once near the top of the tree (inside ServerProvider). */
export function LoggerBridge({ children }: { children: React.ReactNode }) {
  const { server, token } = useServer()
  // A DEVICE setting: debug mode is this install's diagnostic, never part of
  // the account settings (`device-settings-store.ts`).
  const debugMode = useDeviceSettingsStore((s) => s.settings.debugMode)
  const hydrateDeviceSettings = useDeviceSettingsStore((s) => s.hydrate)

  useEffect(() => {
    void hydrateDeviceSettings()
  }, [hydrateDeviceSettings])

  useEffect(() => {
    setLogVerbose(debugMode)
    log.info('app', `debug mode ${debugMode ? 'ON (verbose)' : 'off'}`)
  }, [debugMode])

  const serverUrl = server?.serverUrl ?? null
  useEffect(() => {
    if (serverUrl && token) {
      configureLogShipping({ serverUrl, token })
      log.info('app', 'log shipping configured', { serverUrl })
    } else {
      configureLogShipping(null)
    }
  }, [serverUrl, token])

  return <>{children}</>
}
