/**
 * How a box on the canvas, and its chip in the list, is painted — ONE mapping
 * from the review diff to theme tokens (the admin's `retrain-box-look.ts`, in
 * the viewer's spelling), so the stroke, the chip and the badge of one box never
 * disagree.
 *
 * - The STROKE is the diff: added = success, removed = danger (a dotted ghost),
 *   reclassified = warning, adjusted = info, unchanged = neutral, draft = primary.
 * - `model-error` is NOT `removed`: it keeps the danger colour but is an OUTLINE
 *   (dashed 2 px stroke, an outline badge) where a removed ghost is dotted and a
 *   filled badge.
 *
 * Pure: it names tokens (`ColorTokens` keys), the component reads the colour.
 */
import type { BadgeLook, BadgeTone } from '../components/ui/badge-colors.js'
import type { ColorTokens } from '../theme/tokens.js'
import type { BoxDiffKind } from './live-review.js'

export type StrokeStyle = 'solid' | 'dashed' | 'dotted'

export interface BoxLook {
  /** The `ColorTokens` key of the stroke. */
  readonly stroke: keyof ColorTokens
  readonly strokeStyle: StrokeStyle
  readonly strokeWidth: number
  readonly tone: BadgeTone
  readonly badgeLook: BadgeLook
  /** An approximate verdict reads dashed on its badge. */
  readonly translationKey: string
  readonly fallback: string
}

const LOOKS: Readonly<Record<BoxDiffKind, BoxLook>> = {
  added: look('success', 'solid', 2, 'success', 'fill', 'added', 'Added'),
  removed: look('danger', 'dotted', 2, 'danger', 'fill', 'removed', 'Removed'),
  reclassified: look('warning', 'solid', 2, 'warning', 'fill', 'reclassified', 'Reclassified'),
  adjusted: look('info', 'solid', 2, 'info', 'fill', 'adjusted', 'Adjusted'),
  unchanged: look('foregroundMuted', 'solid', 2, 'neutral', 'fill', 'unchanged', 'Unchanged'),
  'model-error': look('danger', 'dashed', 3, 'danger', 'outline', 'modelError', 'Model error'),
  draft: look('primary', 'dashed', 2, 'primary', 'outline', 'draft', 'Draft'),
}

function look(
  stroke: keyof ColorTokens,
  strokeStyle: StrokeStyle,
  strokeWidth: number,
  tone: BadgeTone,
  badgeLook: BadgeLook,
  key: string,
  fallback: string,
): BoxLook {
  return {
    stroke,
    strokeStyle,
    strokeWidth,
    tone,
    badgeLook,
    translationKey: `v2.retrain.review.${key}`,
    fallback,
  }
}

export function boxLook(kind: BoxDiffKind): BoxLook {
  return LOOKS[kind]
}

/** Opacity of every box another box's emphasis dims. */
export const DIMMED_OPACITY = 0.35
/** Opacity of the faint "where the proposal was" ghost. */
export const ORIGIN_GHOST_OPACITY = 0.55
/** Extra stroke width of the selected / hovered box. */
export const EMPHASIS_EXTRA = 1.5

/** `+n added`, `-n removed` ... the glyph the collapsed summary leads each count with. */
export const SUMMARY_SYMBOL: Readonly<Record<BoxDiffKind, string>> = {
  added: '+',
  removed: '−',
  reclassified: '~',
  adjusted: '↔',
  unchanged: '=',
  'model-error': '!',
  draft: '?',
}
