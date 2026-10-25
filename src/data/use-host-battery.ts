/**
 * Phone / tablet battery (the device RUNNING the viewer), via `expo-battery`.
 *
 * Not a camera battery — that is `useBattery` / `BatteryBadge`. Unsupported
 * platforms (most web embeds) answer `null` and the overlay does not mount.
 */
import { useEffect, useState } from 'react'
import { Platform } from 'react-native'
import * as Battery from 'expo-battery'

export interface HostBatteryStatus {
  /** 0–100. */
  readonly percentage: number
  readonly charging: boolean
}

/**
 * Live host battery, or `null` when the platform has no battery API / the read
 * failed. Subscribes to level + state changes while mounted.
 */
export function useHostBattery(): HostBatteryStatus | null {
  const [status, setStatus] = useState<HostBatteryStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const subs: { remove: () => void }[] = []

    const refresh = async (): Promise<void> => {
      try {
        const available = await Battery.isAvailableAsync()
        if (!available || cancelled) {
          if (!cancelled) setStatus(null)
          return
        }
        const [level, state] = await Promise.all([
          Battery.getBatteryLevelAsync(),
          Battery.getBatteryStateAsync(),
        ])
        if (cancelled) return
        if (!Number.isFinite(level) || level < 0) {
          setStatus(null)
          return
        }
        setStatus({
          percentage: Math.round(Math.min(1, Math.max(0, level)) * 100),
          charging:
            state === Battery.BatteryState.CHARGING ||
            state === Battery.BatteryState.FULL,
        })
      } catch {
        if (!cancelled) setStatus(null)
      }
    }

    void refresh()

    // Web often has no battery events; native gets level + charging updates.
    if (Platform.OS !== 'web') {
      try {
        subs.push(
          Battery.addBatteryLevelListener(() => {
            void refresh()
          }),
        )
        subs.push(
          Battery.addBatteryStateListener(() => {
            void refresh()
          }),
        )
      } catch {
        // Listener APIs missing — keep the one-shot read.
      }
    }

    return () => {
      cancelled = true
      for (const sub of subs) sub.remove()
    }
  }, [])

  return status
}
