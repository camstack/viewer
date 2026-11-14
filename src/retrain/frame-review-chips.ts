/**
 * What a frame TILE says about its review — pure. The server's per-box review
 * (`RetrainFrame.review`) folded into compact entries: one per
 * (state, class, approximate), counted, in the strip's order.
 *
 * The tile shows what the EDITOR's list shows (issue 557): every confirmed box,
 * `unchanged` included, AND every pipeline proposal still waiting as a draft.
 * It used to drop both — a frame whose boxes were all confirmed as proposed,
 * or one with only drafts, looked untouched in the overview.
 *
 * The class is the box's CURRENT `macroClass` (newer hubs), else its origin's
 * (older hubs); a box with neither is classless.
 */
import type { RetrainFrame, RetrainMacroClass } from '@camstack/types'
import { isRetrainMacroClass } from '../data/retrain-parse.js'
import { pipelineOriginRef } from './editor.js'
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

/** The facts about a frame its tile summarises. */
export type FrameReviewFacts = Pick<RetrainFrame, 'review' | 'pipelineBoxes' | 'dismissed'>

/**
 * The pipeline boxes the editor would open as drafts: those no confirmed box
 * started from and the operator did not dismiss. Matched by `origin.ref`, the
 * same identity `seedEditor` settles a proposal by.
 */
export function pendingDrafts(
  frame: FrameReviewFacts | undefined,
): NonNullable<RetrainFrame['pipelineBoxes']> {
  const decided = new Set<string>([
    ...(frame?.review?.boxes ?? []).flatMap((b) => (b.origin !== undefined ? [b.origin.ref] : [])),
    ...(frame?.dismissed ?? []).map((d) => d.ref),
  ])
  return (frame?.pipelineBoxes ?? []).filter((p) => !decided.has(pipelineOriginRef(p.trackId)))
}

export function summarizeFrameReview(
  frame: FrameReviewFacts | undefined,
  max: number = MAX_TILE_CHIPS,
): FrameReviewChips {
  const byKey = new Map<string, FrameReviewChip>()
  const count = (kind: BoxDiffKind, macroClass: RetrainMacroClass | null, approximate: boolean): void => {
    const key = `${kind}|${macroClass ?? ''}|${String(approximate)}`
    const existing = byKey.get(key)
    byKey.set(
      key,
      existing !== undefined
        ? { ...existing, count: existing.count + 1 }
        : { kind, macroClass, approximate, count: 1 },
    )
  }
  for (const box of frame?.review?.boxes ?? []) count(box.status, currentMacroClass(box), box.approximate)
  for (const draft of pendingDrafts(frame)) count('draft', draft.macroClass, false)
  const order = (kind: BoxDiffKind): number => BOX_DIFF_KINDS.indexOf(kind)
  const all = [...byKey.values()].sort(
    (a, b) => order(a.kind) - order(b.kind) || Number(a.approximate) - Number(b.approximate),
  )
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) }
}
