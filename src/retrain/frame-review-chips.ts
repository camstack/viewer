/**
 * What a frame TILE says about its review — pure. The server's per-box review
 * (`RetrainFrame.review`) folded into compact entries: one per
 * (state, class, approximate), counted, in the strip's order. `unchanged` is
 * not work done and is left out.
 *
 * The class is the box's CURRENT `macroClass` (newer hubs), else its origin's
 * (older hubs); a box with neither is classless.
 */
import type { RetrainFrame, RetrainMacroClass } from '@camstack/types'
import { isRetrainMacroClass } from '../data/retrain-parse.js'
import { BOX_DIFF_KINDS, type BoxDiffKind } from './live-review.js'

export interface FrameReviewChip {
  readonly kind: BoxDiffKind
  readonly macroClass: RetrainMacroClass | null
  readonly approximate: boolean
  readonly count: number
}

export interface FrameReviewChips {
  readonly shown: readonly FrameReviewChip[]
  /** Chips beyond the cap, folded into "+n". */
  readonly more: number
}

/** Chips a tile shows before folding the rest. */
export const MAX_TILE_CHIPS = 4

/**
 * The class a review box carries NOW. A newer hub sends `macroClass`; an older
 * one does not, and the published types may not declare it yet — so it is read
 * structurally and falls back to the origin's class.
 */
export function currentMacroClass(
  box: NonNullable<RetrainFrame['review']>['boxes'][number],
): RetrainMacroClass | null {
  const record: object = box
  if ('macroClass' in record && isRetrainMacroClass(record.macroClass)) return record.macroClass
  return box.origin?.macroClass ?? null
}

export function summarizeFrameReview(
  review: RetrainFrame['review'] | undefined,
  max: number = MAX_TILE_CHIPS,
): FrameReviewChips {
  const byKey = new Map<string, FrameReviewChip>()
  for (const box of review?.boxes ?? []) {
    if (box.status === 'unchanged') continue
    const macroClass = currentMacroClass(box)
    const key = `${box.status}|${macroClass ?? ''}|${String(box.approximate)}`
    const existing = byKey.get(key)
    byKey.set(
      key,
      existing !== undefined
        ? { ...existing, count: existing.count + 1 }
        : { kind: box.status, macroClass, approximate: box.approximate, count: 1 },
    )
  }
  const order = (kind: BoxDiffKind): number => BOX_DIFF_KINDS.indexOf(kind)
  const all = [...byKey.values()].sort(
    (a, b) => order(a.kind) - order(b.kind) || Number(a.approximate) - Number(b.approximate),
  )
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) }
}
