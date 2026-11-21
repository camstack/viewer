/**
 * use-camera-view-options — the ONE configuration binding behind the
 * view-options surface, wherever that surface is mounted.
 *
 * `CameraViewOptionsSurface` is hosted twice: by the single-camera view (as a
 * timeline panel) and by a GRID CELL (as a panel over the wall). The
 * operator's requirement is that they are the SAME menu — a change made from a
 * tile is the change the camera screen shows. The values it edits are resolved
 * here, and both hosts read back the same binding.
 *
 * The OVERLAY document is global (`overlay-config-store.ts`): one for every
 * stream. Only the highlight stays per camera.
 *
 * Hydration is part of the binding: a surface can be the FIRST to ask in a
 * session (a cold launch straight into a wall), and a store that has not been
 * loaded resolves to defaults — a menu that silently shows factory settings
 * over a configured document, and writes them back on the first tap.
 */
import { useCallback, useEffect, useMemo } from 'react'

import {
  useCameraPrefsStore,
  type CameraPref,
} from '../store/camera-prefs-store.js'
import { useOverlayConfigStore } from '../store/overlay-config-store.js'
import type { OverlayConfig } from '../components/camera/overlay/overlay-config.js'
import {
  withHighlightDefaults,
  type GridHighlightSettings,
} from '../store/grid-store.js'

/** The resolved (defaults-filled) configuration of one camera's menu. */
export interface ResolvedCameraViewOptions {
  /** What every stream draws over its picture (global). */
  readonly overlay: OverlayConfig
  /** This camera's highlight triggers (border) + cluster-label mode. */
  readonly highlight: GridHighlightSettings
}

/** The resolved configuration plus its writers — what a host hands the surface. */
export interface CameraViewOptionsBinding extends ResolvedCameraViewOptions {
  readonly setOverlay: (next: OverlayConfig) => void
  /** PATCH the highlight document — the surface sends only what changed. */
  readonly setHighlight: (patch: Partial<GridHighlightSettings>) => void
}

/** Resolve one camera's stored highlight into a complete value. Absence is the
 *  defaults, never undefined: every host draws something either way. */
export function resolveCameraHighlight(pref: CameraPref | undefined): GridHighlightSettings {
  return withHighlightDefaults(pref?.highlight)
}

/** Patch-merge onto the CURRENT resolved highlight (immutable). */
export function mergeHighlightPatch(
  current: GridHighlightSettings,
  patch: Partial<GridHighlightSettings>,
): GridHighlightSettings {
  return { ...current, ...patch }
}

/**
 * The global OVERLAY document alone — what a surface that DRAWS a stream needs,
 * without the writers a menu needs. A grid tile is a caller. Hydrates the
 * store, like the full binding.
 */
export function useOverlayConfig(): OverlayConfig {
  const overlay = useOverlayConfigStore((s) => s.overlay)
  const hydrate = useOverlayConfigStore((s) => s.hydrate)
  useEffect(() => {
    void hydrate()
  }, [hydrate])
  return overlay
}

/** The view-options binding of one camera: resolved config + its writers. */
export function useCameraViewOptions(deviceId: number): CameraViewOptionsBinding {
  const overlay = useOverlayConfig()
  const setOverlay = useOverlayConfigStore((s) => s.setOverlay)
  const storedHighlight = useCameraPrefsStore((s) => s.prefs.byId[deviceId]?.highlight)
  const setCameraHighlight = useCameraPrefsStore((s) => s.setCameraHighlight)
  const hydrate = useCameraPrefsStore((s) => s.hydrate)

  // Idempotent (the store returns early once hydrated) — every host may ask.
  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const highlight = useMemo(() => withHighlightDefaults(storedHighlight), [storedHighlight])

  const setHighlight = useCallback(
    (patch: Partial<GridHighlightSettings>) =>
      setCameraHighlight(deviceId, mergeHighlightPatch(highlight, patch)),
    [setCameraHighlight, deviceId, highlight],
  )

  return useMemo(
    () => ({ overlay, highlight, setOverlay, setHighlight }),
    [overlay, highlight, setOverlay, setHighlight],
  )
}
