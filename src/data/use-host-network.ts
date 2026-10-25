/**
 * Internet link of the device RUNNING the viewer — wifi / cellular / offline and,
 * where the platform exposes it, wifi strength. See `host-network.ts` for the
 * permission analysis. `NetInfo` is already in the native binary
 * (`LiveViewWebView`, `GridLiveEmbed`), so this adds no native module.
 */
import { useEffect, useState } from 'react'
import NetInfo from '@react-native-community/netinfo'
import { toHostNetwork, type HostNetworkStatus } from './host-network.js'

export function useHostNetwork(): HostNetworkStatus | null {
  const [status, setStatus] = useState<HostNetworkStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const apply = (state: Parameters<typeof toHostNetwork>[0]): void => {
      if (!cancelled) setStatus(toHostNetwork(state))
    }
    NetInfo.fetch().then(apply, () => undefined)
    const unsubscribe = NetInfo.addEventListener(apply)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return status
}
