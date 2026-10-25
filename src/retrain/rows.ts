/**
 * The subject list's rows — pure, so the canvas and the list read one answer.
 *
 * Live boxes first, in editor order; removed proposals (deleted by the operator)
 * after them as ghost rows, only under the "show removed" switch.
 */
import type { EditorBox, EditorState } from './editor.js'
import { BOX_DIFF_KINDS, type BoxDiff, type BoxDiffKind, type LiveReview, type RemovedGhost } from './live-review.js'

export type SubjectRow =
  | { readonly type: 'box'; readonly key: string; readonly box: EditorBox; readonly diff: BoxDiff }
  | { readonly type: 'removed'; readonly key: string; readonly ghost: RemovedGhost }

const UNCHANGED: BoxDiff = { kind: 'unchanged', approximate: false }

export function buildRows(
  editor: EditorState,
  review: LiveReview,
  showRemoved: boolean,
): readonly SubjectRow[] {
  const boxes = editor.boxes.map(
    (box): SubjectRow => ({
      type: 'box',
      key: box.key,
      box,
      diff: review.byKey.get(box.key) ?? UNCHANGED,
    }),
  )
  if (!showRemoved) return boxes
  return [
    ...boxes,
    ...review.removed.map((ghost): SubjectRow => ({ type: 'removed', key: `removed:${ghost.ref}`, ghost })),
  ]
}

/** The summary badges the collapsed sheet shows: non-zero kinds, in the strip's order. */
export function summaryEntries(
  counts: Readonly<Record<BoxDiffKind, number>>,
): readonly { readonly kind: BoxDiffKind; readonly count: number }[] {
  return BOX_DIFF_KINDS.filter((kind) => (counts[kind] ?? 0) > 0).map((kind) => ({
    kind,
    count: counts[kind],
  }))
}
