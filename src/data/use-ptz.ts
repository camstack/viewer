import { useCallback, useMemo } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'

/** Per-camera PTZ availability, mirroring the server `ptz` cap's
 *  `getOptions` descriptor (`packages/types/src/capabilities/ptz.cap.ts`).
 *  The SDK does not re-export the type, so the fields the UI gates on are
 *  pinned here. */
export interface PtzOptions {
  readonly hasPan: boolean
  readonly hasTilt: boolean
  readonly hasZoom: boolean
  readonly supportsPresets: boolean
  readonly hasAutofocus: boolean
}

/** A relative PTZ nudge. Values are the server cap's `PtzMoveCommandSchema`
 *  axes (all optional; here we always send exactly one). */
interface PtzNudge {
  readonly pan?: number
  readonly tilt?: number
  readonly zoom?: number
  readonly speed?: number
}

/** Relative-move magnitude per tap (matches the V1 directional-pad feel). */
const PAN_STEP = 0.3
const TILT_STEP = 0.3
const ZOOM_STEP = 0.2

/**
 * What the hub said about this camera's home position — the same
 * `ptz.getHomePreset` the admin overlay gates Home on (`ptz-overlay.tsx`).
 *
 * Four answers, not a boolean (D315): only a hub that ANSWERED `none` means
 * "no home configured". `pending` (not asked yet / in the air) and `unknown`
 * (the hub could not answer — an older hub, a dropped socket) must never read
 * as absent, so both leave Home enabled and let `goHome` speak for itself.
 */
export type PtzHomeState = 'pending' | 'set' | 'none' | 'unknown'

/** A named PTZ preset, mirroring the server cap's `PtzPresetSchema`. */
export interface PtzPreset {
  readonly id: string
  readonly name: string
}

export interface PtzController {
  /** Per-camera availability, or null while loading / when the cap is absent. */
  readonly options: PtzOptions | null
  /** Whether directional controls should be enabled (cap present + any axis). */
  readonly available: boolean
  /** Whether the camera advertises named presets (`getOptions.supportsPresets`). */
  readonly supportsPresets: boolean
  /** Named presets (empty until loaded / when unsupported). */
  readonly presets: readonly PtzPreset[]
  /** Whether this camera has a home position to go to. */
  readonly home: PtzHomeState
  readonly panLeft: () => void
  readonly panRight: () => void
  readonly tiltUp: () => void
  readonly tiltDown: () => void
  readonly zoomIn: () => void
  readonly zoomOut: () => void
  readonly goHome: () => void
  /** Recall a named preset (`ptz.goToPreset`). Best-effort. */
  readonly goToPreset: (presetId: string) => void
}

/**
 * PTZ controller for a camera, backed by the device-scoped `ptz` cap reached
 * via `system.trpcClient.ptz`. Probes `getOptions` (cached) to drive which
 * controls render, and exposes relative-move actions wired to `ptz.move`.
 *
 * `enabled` should be false unless the camera advertises the `pan-tilt-zoom`
 * feature — querying a non-PTZ device's cap would error. Move calls are
 * best-effort (a failed nudge is non-fatal; the next tap retries) -- but
 * `goHome` is NOT, so `onError` is how its refusal reaches the operator.
 */
export function usePtz(
  deviceId: number,
  enabled: boolean,
  onError?: (message: string) => void,
): PtzController {
  const { controller, state } = useConnection()

  const optionsQuery: UseQueryResult<PtzOptions | null> = useQuery<PtzOptions | null>({
    queryKey: ['v2', 'ptz', 'options', deviceId],
    enabled: enabled && state === 'connected',
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return null
      try {
        return await system.trpcClient.ptz.getOptions.query({ deviceId })
      } catch {
        return null
      }
    },
  })

  const homeQuery: UseQueryResult<PtzHomeState> = useQuery<PtzHomeState>({
    queryKey: ['v2', 'ptz', 'home', deviceId],
    enabled: enabled && state === 'connected',
    // Short: the operator sets a home in the admin UI and then comes back here.
    staleTime: 60_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return 'unknown'
      try {
        const answer = await system.trpcClient.ptz.getHomePreset.query({ deviceId })
        // `source`, never `presetId === null`: a native home has no preset
        // and homes perfectly well (ptz.cap.ts).
        return answer.source === 'none' ? 'none' : 'set'
      } catch {
        return 'unknown'
      }
    },
  })
  const home: PtzHomeState = homeQuery.data ?? 'pending'

  const move = useCallback(
    (nudge: PtzNudge): void => {
      const system = controller.getSystem()
      if (!system) return
      void system.trpcClient.ptz.move.mutate({ deviceId, ...nudge }).catch(() => {
        // best-effort — a dropped nudge just means the next tap retries.
      })
    },
    [controller, deviceId],
  )

  const goHome = useCallback((): void => {
    // The button is disabled on `none`; this is the backstop for any other
    // caller — a press the hub has already told us it will refuse.
    if (home === 'none') return
    const system = controller.getSystem()
    if (!system) return
    // A nudge may be dropped silently -- the next tap retries. `goHome` may
    // not: the server now REFUSES when no home preset is configured for this
    // camera, and that refusal stands until somebody configures one. Swallowed,
    // the Home button would be dead and mute forever, which is exactly the
    // silent no-op the server change removed. Report it instead.
    void system.trpcClient.ptz.goHome.mutate({ deviceId }).catch((err: unknown) => {
      onError?.(err instanceof Error ? err.message : String(err))
    })
  }, [controller, deviceId, onError, home])

  const options = optionsQuery.data ?? null
  const supportsPresets = options?.supportsPresets ?? false

  // Presets are only fetched once the camera advertises support — a non-preset
  // camera never probes `getPresets`.
  const presetsQuery: UseQueryResult<readonly PtzPreset[]> = useQuery<readonly PtzPreset[]>({
    queryKey: ['v2', 'ptz', 'presets', deviceId],
    enabled: enabled && state === 'connected' && supportsPresets,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return []
      try {
        return await system.trpcClient.ptz.getPresets.query({ deviceId })
      } catch {
        return []
      }
    },
  })

  const goToPreset = useCallback(
    (presetId: string): void => {
      const system = controller.getSystem()
      if (!system) return
      void system.trpcClient.ptz.goToPreset.mutate({ deviceId, presetId }).catch(() => {
        // best-effort — a dropped recall just means the next tap retries.
      })
    },
    [controller, deviceId],
  )

  const presets = presetsQuery.data ?? EMPTY_PRESETS

  return useMemo<PtzController>(() => {
    const available =
      options !== null && (options.hasPan || options.hasTilt || options.hasZoom)
    return {
      options,
      available,
      supportsPresets,
      presets,
      home,
      panLeft: () => move({ pan: -PAN_STEP }),
      panRight: () => move({ pan: PAN_STEP }),
      tiltUp: () => move({ tilt: TILT_STEP }),
      tiltDown: () => move({ tilt: -TILT_STEP }),
      zoomIn: () => move({ zoom: ZOOM_STEP }),
      zoomOut: () => move({ zoom: -ZOOM_STEP }),
      goHome,
      goToPreset,
    }
  }, [options, supportsPresets, presets, home, move, goHome, goToPreset])
}

/** Stable empty reference so the controller memo doesn't churn while presets
 *  are loading or unsupported. */
const EMPTY_PRESETS: readonly PtzPreset[] = []
