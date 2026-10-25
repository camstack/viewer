import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capMutate, capMutateOrThrow, capQuery } from './cap-query.js'
import {
  enabledEntries,
  NAVIGATION_VECTORS,
  type NavigationDirection,
  type NavigationEntry,
  type NavigationFeatures,
  type NavigationStatus,
  parseNavigationEntries,
  parseNavigationFeatures,
  parseNavigationStatus,
} from './navigation-controls.js'
import { createDriveCadence, type DriveCadence } from './navigation-drive-cadence.js'
import { RECONCILE_MS } from './reconcile.js'

export interface NavigationController {
  /** Feature flags for THIS device, or null while unknown / cap absent. */
  readonly features: NavigationFeatures | null
  readonly actions: readonly NavigationEntry[]
  readonly sounds: readonly NavigationEntry[]
  readonly status: NavigationStatus | null
  /** Hold-to-drive: one nudge now, then one per second until `stopDrive`. */
  readonly startDrive: (direction: NavigationDirection) => void
  /**
   * Proportional drive (the joystick). Same cadence as `startDrive` — the
   * first vector nudges now, later ones only replace what the next 1 Hz tick
   * sends — and a zero vector is a release. `stopDrive` covers both.
   */
  readonly driveVector: (pan: number, tilt: number) => void
  readonly stopDrive: () => void
  readonly driving: NavigationDirection | null
  readonly runAction: (actionId: string) => void
  readonly playSound: (soundId: number) => void
  readonly setLightOn: (on: boolean) => void
  readonly setLightMode: (mode: 'auto' | 'manual', level?: number) => void
  readonly setLightLevel: (level: number) => void
  /** The hub's refusal, when it refused (e.g. not an actuating role). */
  readonly error: string | null
}

const NO_ENTRIES: readonly NavigationEntry[] = Object.freeze([])

/**
 * Drive a `navigation` robot camera. Same shape as `usePtz`, with the one
 * thing PTZ never needed: the hold-to-drive cadence. The cap's `move` is a
 * MOMENTARY nudge; fluid driving is this hook sending one every second while
 * a direction is held (or a joystick is deflected) and a `stop` on release —
 * like the robot app. The ticker itself is `createDriveCadence`, shared by
 * the d-pad and the joystick so there is never more than one running.
 * `enabled` must be false unless the device is bound to the cap (see
 * `useDeviceCapNames`): probing a non-robot's cap would error.
 */
export function useNavigation(deviceId: number, enabled: boolean): NavigationController {
  const { controller, state } = useConnection()
  const [error, setError] = useState<string | null>(null)
  const [driving, setDriving] = useState<NavigationDirection | null>(null)
  const active = enabled && state === 'connected'

  const client = useCallback((): Record<string, unknown> | null => {
    const system = controller.getSystem()
    return system ? (system.trpcClient as unknown as Record<string, unknown>) : null
  }, [controller])

  const featuresQuery = useQuery<NavigationFeatures | null>({
    queryKey: ['v2', 'navigation', 'features', deviceId],
    enabled: active,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const c = client()
      return c ? parseNavigationFeatures(await capQuery(c, 'navigation', 'getFeatures', { deviceId })) : null
    },
  })
  const entriesQuery = useQuery<readonly NavigationEntry[]>({
    queryKey: ['v2', 'navigation', 'actions', deviceId],
    enabled: active,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const c = client()
      return c ? parseNavigationEntries(await capQuery(c, 'navigation', 'listActions', { deviceId })) : NO_ENTRIES
    },
  })
  const statusQuery = useQuery<NavigationStatus | null>({
    queryKey: ['v2', 'navigation', 'status', deviceId],
    enabled: active,
    staleTime: RECONCILE_MS,
    refetchInterval: RECONCILE_MS,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const c = client()
      return c ? parseNavigationStatus(await capQuery(c, 'navigation', 'getStatus', { deviceId })) : null
    },
  })
  const refetchStatus = statusQuery.refetch

  const mutate = useCallback(
    (method: string, input: Record<string, unknown>): void => {
      const c = client()
      if (!c) return
      setError(null)
      void capMutateOrThrow(c, 'navigation', method, { deviceId, ...input })
        .then(() => {
          void refetchStatus()
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    },
    [client, deviceId, refetchStatus],
  )

  // One cadence per (client, device): the sinks close over both, so a device
  // switch mid-drive disposes the old ticker (and halts that robot) before the
  // new one can start.
  const cadence = useMemo<DriveCadence>(
    () =>
      createDriveCadence({
        move: (vector) => {
          const c = client()
          if (c) void capMutate(c, 'navigation', 'move', { deviceId, pan: vector.pan, tilt: vector.tilt })
        },
        stop: () => {
          const c = client()
          if (c) void capMutate(c, 'navigation', 'stop', { deviceId })
        },
      }),
    [client, deviceId],
  )

  // Never leave a robot driving because the sheet closed mid-press.
  useEffect(() => () => cadence.dispose(), [cadence])

  const stopDrive = useCallback((): void => {
    setDriving(null)
    cadence.stop()
  }, [cadence])

  const startDrive = useCallback(
    (direction: NavigationDirection): void => {
      setDriving(direction)
      cadence.drive(NAVIGATION_VECTORS[direction])
    },
    [cadence],
  )

  const driveVector = useCallback(
    (pan: number, tilt: number): void => {
      setDriving(null)
      cadence.drive({ pan, tilt })
    },
    [cadence],
  )

  const entries = entriesQuery.data ?? NO_ENTRIES
  return useMemo<NavigationController>(
    () => ({
      features: featuresQuery.data ?? null,
      actions: enabledEntries(entries, 'action'),
      sounds: enabledEntries(entries, 'sound'),
      status: statusQuery.data ?? null,
      startDrive,
      driveVector,
      stopDrive,
      driving,
      runAction: (actionId) => mutate('runAction', { actionId }),
      playSound: (soundId) => mutate('playSound', { soundId }),
      setLightOn: (on) => mutate('setLightOn', { on }),
      setLightMode: (mode, level) => mutate('setLightMode', level === undefined ? { mode } : { mode, level }),
      setLightLevel: (level) => mutate('setLightLevel', { level }),
      error,
    }),
    [featuresQuery.data, entries, statusQuery.data, startDrive, driveVector, stopDrive, driving, mutate, error],
  )
}
