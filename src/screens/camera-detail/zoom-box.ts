/**
 * The picture's box height as a pure function of the live scale and a plain
 * parameter record.
 *
 * The screen used to build this rule as a `useCallback` closed over six
 * values, so any of them changing (the safe-area frame jittering `maxHeight`,
 * a settings flip) minted a new `heightFor`, which rebuilt the pinch and the
 * whole gesture tree in the middle of a pinch. Now the record lives in ONE
 * shared value and the rule is a function of it: the callback is stable for the
 * life of the screen and a parameter change is just a new value.
 */
import { growBoxHeight } from '../../live/zoom-render.js'

export interface ZoomBoxParams {
  readonly fill: boolean
  readonly winHeight: number
  readonly isWideDetail: boolean
  readonly wideStreamH: number
  readonly pinchExpandsHeight: boolean
  readonly defaultHeight: number
  readonly maxHeight: number
  readonly growScale: number
}

export function zoomBoxHeight(scale: number, p: ZoomBoxParams): number {
  'worklet'
  if (p.fill) return p.winHeight
  if (p.isWideDetail) return p.wideStreamH
  if (!p.pinchExpandsHeight) return p.defaultHeight
  return growBoxHeight(scale, {
    rest: p.defaultHeight,
    max: p.maxHeight,
    growScale: p.growScale,
  })
}
