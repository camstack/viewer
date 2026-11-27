/**
 * highlight-classes — the detection highlight's class selection (planning#751),
 * shared by the viewer app and the embed player so both read it the same way.
 *
 * The stored shape: `detectionClasses` is a list and EMPTY means "any class"
 * (every document written before the multiselect has it that way). The editor
 * is a plain label multiselect, so it shows that stored value as what it
 * means (every class ticked) and writes "all ticked" back as the empty list.
 * Ticking every class therefore matches ANY detection class, including a label
 * outside the list.
 *
 * The list is the detector's macro classes (`MACRO_LABELS`, the set behind
 * `DETECTION_MACRO_CLASSES` upstream) plus `face` and `plate`. Those two are
 * not macro labels: they are the detail classes the detection feed reports for
 * a face crop and a plate read, and the highlight has always been selectable
 * on them.
 */
import { MACRO_LABELS } from '@camstack/types/client'

export const HIGHLIGHT_DETECTION_CLASSES: readonly string[] = [...MACRO_LABELS.map((l) => l.id), 'face', 'plate']

function coversAll(selected: readonly string[]): boolean {
  return HIGHLIGHT_DETECTION_CLASSES.every((c) => selected.includes(c))
}

/** What the editor shows as ticked for a stored list. */
export function classesForEditor(stored: readonly string[]): readonly string[] {
  return stored.length === 0 ? HIGHLIGHT_DETECTION_CLASSES : stored
}

/** The stored list for an editor selection (all ticked = the "any" spelling).
 *  An empty selection is not stored: the caller turns detection off instead. */
export function classesFromEditor(selected: readonly string[]): string[] {
  return coversAll(selected) ? [] : [...selected]
}

/** Does a detection labelled `label` light the border? */
export function matchesDetectionClass(stored: readonly string[], label: string): boolean {
  return stored.length === 0 || coversAll(stored) || stored.includes(label)
}
