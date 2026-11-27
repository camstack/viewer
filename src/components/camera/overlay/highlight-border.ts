/**
 * highlight-border — the border has no switch of its own: it is on when any
 * trigger (motion, audio, detection) is on (planning#749). The triggers are one
 * global document (`store/highlight-global.ts`, planning#751).
 *
 * Pure module — no React.
 */
import type { GridHighlightSettings } from '../../../store/grid-store.js'

/** The border draws when any trigger is on. */
export function highlightBorderEnabled(
  h: Pick<GridHighlightSettings, 'motion' | 'audio' | 'detection'>,
): boolean {
  return h.motion || h.audio !== 'off' || h.detection
}
