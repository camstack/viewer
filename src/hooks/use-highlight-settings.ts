/**
 * use-highlight-settings — the ONE binding of the global highlight document
 * (planning#751): what the border draws, wherever it is drawn or edited (a
 * camera, a wall, a grid menu). The per-camera and per-grid copies are gone.
 */
import { useCallback, useEffect, useMemo } from 'react'

import { highlightPatch, resolveHighlight } from '../store/highlight-global.js'
import type { GridHighlightSettings } from '../store/grid-store.js'
import { useSettingsStore, type HighlightAppearance } from '../store/settings-store.js'

export interface HighlightBinding {
  /** The triggers in the shared shape (detection ⇔ a label is selected). */
  readonly highlight: GridHighlightSettings
  /** The document itself — colours, thickness. */
  readonly appearance: HighlightAppearance
  /** PATCH the triggers — the surface sends only what changed. */
  readonly setHighlight: (patch: Partial<GridHighlightSettings>) => void
  /** Patch the document's own fields (a colour, a hold). */
  readonly patchAppearance: (patch: Partial<HighlightAppearance>) => void
}

export function useHighlightSettings(): HighlightBinding {
  const appearance = useSettingsStore((s) => s.settings.highlight)
  const hydrate = useSettingsStore((s) => s.hydrate)
  const patchHighlight = useSettingsStore((s) => s.patchHighlight)
  useEffect(() => {
    void hydrate()
  }, [hydrate])
  const highlight = useMemo(() => resolveHighlight(appearance), [appearance])
  const setHighlight = useCallback(
    (patch: Partial<GridHighlightSettings>) =>
      patchHighlight(highlightPatch(useSettingsStore.getState().settings.highlight, patch)),
    [patchHighlight],
  )
  return useMemo(
    () => ({ highlight, appearance, setHighlight, patchAppearance: patchHighlight }),
    [highlight, appearance, setHighlight, patchHighlight],
  )
}

/** The GLOBAL half of a trigger — its colour and its hold. Passed by the
 *  surfaces that edit the global highlight document; the reel and the share
 *  dialog edit a draft of their own and offer none. */
export interface HighlightGlobalRows {
  readonly appearance: HighlightAppearance
  readonly motionHoldSec: number
  readonly onPatchAppearance: (patch: Partial<HighlightAppearance>) => void
  readonly onMotionHold: (seconds: number) => void
}

/** The colour / hold rows' binding, for a surface that edits the global document. */
export function useHighlightGlobalRows(): HighlightGlobalRows {
  const { appearance, patchAppearance } = useHighlightSettings()
  const motionHoldSec = useSettingsStore((s) => s.settings.grid.motionHoldSec)
  const setGridDefault = useSettingsStore((s) => s.setGridDefault)
  const onMotionHold = useCallback((v: number) => setGridDefault('motionHoldSec', v), [setGridDefault])
  return useMemo(
    () => ({ appearance, motionHoldSec, onPatchAppearance: patchAppearance, onMotionHold }),
    [appearance, motionHoldSec, patchAppearance, onMotionHold],
  )
}
