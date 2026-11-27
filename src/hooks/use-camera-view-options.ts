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
 * The OVERLAY document (`overlay-config-store.ts`) and the HIGHLIGHT document
 * (`use-highlight-settings.ts`) are both global: one for every stream.
 *
 * Hydration is part of the binding: a surface can be the FIRST to ask in a
 * session (a cold launch straight into a wall), and a store that has not been
 * loaded resolves to defaults — a menu that silently shows factory settings
 * over a configured document, and writes them back on the first tap.
 */
import { useEffect, useMemo } from 'react'

import { useOverlayConfigStore } from '../store/overlay-config-store.js'
import type { OverlayConfig } from '../components/camera/overlay/overlay-config.js'
import type { GridHighlightSettings } from '../store/grid-store.js'
import { useHighlightSettings } from './use-highlight-settings.js'

/** The resolved (defaults-filled) configuration of a camera's menu. */
export interface ResolvedCameraViewOptions {
  /** What every stream draws over its picture (global). */
  readonly overlay: OverlayConfig
  /** The border triggers (global) + cluster-label mode. */
  readonly highlight: GridHighlightSettings
}

/** The resolved configuration plus its writers — what a host hands the surface. */
export interface CameraViewOptionsBinding extends ResolvedCameraViewOptions {
  readonly setOverlay: (next: OverlayConfig) => void
  /** PATCH the highlight document — the surface sends only what changed. */
  readonly setHighlight: (patch: Partial<GridHighlightSettings>) => void
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

/** The view-options binding: both global documents + their writers. */
export function useCameraViewOptions(): CameraViewOptionsBinding {
  const overlay = useOverlayConfig()
  const setOverlay = useOverlayConfigStore((s) => s.setOverlay)
  const { highlight, setHighlight } = useHighlightSettings()
  return useMemo(
    () => ({ overlay, highlight, setOverlay, setHighlight }),
    [overlay, highlight, setOverlay, setHighlight],
  )
}
