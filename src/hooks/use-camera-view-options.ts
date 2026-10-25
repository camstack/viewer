/**
 * use-camera-view-options — the ONE per-camera configuration binding behind the
 * view-options surface, wherever that surface is mounted.
 *
 * ## Why this is a hook and not two copies of six lines
 *
 * `CameraViewOptionsSurface` is now hosted twice: by the single-camera view
 * (as a timeline panel) and by a GRID CELL (as a panel over the wall). The
 * operator's requirement is that they are the SAME menu — a change made from a
 * tile is the change the camera screen shows, and a section added to the menu
 * appears in both places without a second edit.
 *
 * Sharing the component alone would not have given that. The values it edits
 * were resolved inline in `CameraDetailScreen` — `stored ?? OVERLAY_DEFAULTS`,
 * `withHighlightDefaults(stored)`, a patch-merge writer and a `hydrate()`
 * effect — four decisions a second host would have had to reproduce, and the
 * moment one of them differed (a forgotten hydrate; a writer that replaces
 * instead of merging) the two hosts would disagree about a document they share.
 * They live here instead, and both hosts read back the same binding.
 *
 * Hydration is part of the binding for exactly that reason: the grid can be the
 * FIRST surface to ask for a camera's prefs in a session (a cold launch
 * straight into a wall), and prefs that have not been loaded resolve to
 * defaults — a menu that silently shows factory settings over a configured
 * camera, and writes them back on the first tap.
 */
import { useCallback, useEffect, useMemo } from 'react'

import {
  useCameraPrefsStore,
  type CameraPref,
} from '../store/camera-prefs-store.js'
import {
  OVERLAY_DEFAULTS,
  type CameraOverlayConfig,
} from '../components/camera/overlay/overlay-config.js'
import {
  withHighlightDefaults,
  type GridHighlightSettings,
} from '../store/grid-store.js'

/** The resolved (defaults-filled) per-camera configuration. */
export interface ResolvedCameraViewOptions {
  /** What this camera draws over its picture. */
  readonly overlay: CameraOverlayConfig
  /** This camera's highlight triggers (border) + cluster-label mode. */
  readonly highlight: GridHighlightSettings
}

/** The resolved configuration plus its writers — what a host hands the surface. */
export interface CameraViewOptionsBinding extends ResolvedCameraViewOptions {
  readonly setOverlay: (next: CameraOverlayConfig) => void
  /** PATCH the highlight document — the surface sends only what changed. */
  readonly setHighlight: (patch: Partial<GridHighlightSettings>) => void
}

/** Resolve one camera's stored prefs into a complete configuration. Absence is
 *  the defaults, never undefined: every host draws something either way. */
export function resolveCameraViewOptions(
  pref: CameraPref | undefined,
): ResolvedCameraViewOptions {
  return {
    overlay: pref?.overlay ?? OVERLAY_DEFAULTS,
    highlight: withHighlightDefaults(pref?.highlight),
  }
}

/** Patch-merge onto the CURRENT resolved highlight (immutable). */
export function mergeHighlightPatch(
  current: GridHighlightSettings,
  patch: Partial<GridHighlightSettings>,
): GridHighlightSettings {
  return { ...current, ...patch }
}

/**
 * The resolved per-camera OVERLAY document alone — what a surface that DRAWS
 * this camera needs, without the writers a menu needs.
 *
 * A grid tile is the caller: the wall paints each camera's own motion regions,
 * motion badge, audio meter, occupancy chips and stats, because the cell menu
 * offers those per camera and a control nothing paints is a dead control. It
 * takes the same hydrate as the full binding — a wall can be the FIRST surface
 * to ask for prefs in a session, and un-hydrated prefs resolve to defaults, so
 * a tile would quietly draw the factory overlay over a configured camera.
 */
export function useCameraOverlay(deviceId: number): CameraOverlayConfig {
  const storedOverlay = useCameraPrefsStore((s) => s.prefs.byId[deviceId]?.overlay)
  const hydrate = useCameraPrefsStore((s) => s.hydrate)
  useEffect(() => {
    void hydrate()
  }, [hydrate])
  return storedOverlay ?? OVERLAY_DEFAULTS
}

/** The per-camera view-options binding: resolved config + its writers. */
export function useCameraViewOptions(deviceId: number): CameraViewOptionsBinding {
  const storedOverlay = useCameraPrefsStore((s) => s.prefs.byId[deviceId]?.overlay)
  const storedHighlight = useCameraPrefsStore((s) => s.prefs.byId[deviceId]?.highlight)
  const setCameraOverlay = useCameraPrefsStore((s) => s.setCameraOverlay)
  const setCameraHighlight = useCameraPrefsStore((s) => s.setCameraHighlight)
  const hydrate = useCameraPrefsStore((s) => s.hydrate)

  // Idempotent (the store returns early once hydrated) — every host may ask.
  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const overlay = storedOverlay ?? OVERLAY_DEFAULTS
  const highlight = useMemo(() => withHighlightDefaults(storedHighlight), [storedHighlight])

  const setOverlay = useCallback(
    (next: CameraOverlayConfig) => setCameraOverlay(deviceId, next),
    [setCameraOverlay, deviceId],
  )
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
