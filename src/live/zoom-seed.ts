/**
 * Where a gesture starts from: the LIVE transform, never the committed one.
 *
 * `committedScale` is what the last gesture or step LEFT behind. A reset or a
 * double tap writes it at once while `scale` animates to it for 300 ms, so a
 * pinch that began in that window seeded from a number the picture had not
 * reached yet and the frame jumped. The picture the fingers are holding is the
 * live one; a gesture seeds from it and commits it.
 */
export interface LiveTransform {
  readonly scale: number
  readonly tx: number
  readonly ty: number
}

export interface GestureSeed {
  /** Scale the pinch multiplies. */
  readonly startScale: number
  readonly savedTx: number
  readonly savedTy: number
}

export function seedFromLive(live: LiveTransform, minScale: number, maxScale: number): GestureSeed {
  'worklet'
  return {
    startScale: Math.max(minScale, Math.min(maxScale, live.scale)),
    savedTx: live.tx,
    savedTy: live.ty,
  }
}
