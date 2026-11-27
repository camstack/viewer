/**
 * highlight-classes — the detection highlight's class selection (planning#751).
 *
 * The stored shape is unchanged: `detectionClasses` is a list, and EMPTY means
 * "any class" (every document written before the multiselect has it that way).
 * The editor is a plain label multiselect, so it shows that stored value as
 * what it means — every class selected — and writes "all selected" back as the
 * empty list. Selecting every class therefore matches ANY detection class,
 * including a label outside the editor's list.
 *
 * The list is `DETECTION_MACRO_CLASSES` of `grid-store.ts`.
 */
import { DETECTION_MACRO_CLASSES as HIGHLIGHT_DETECTION_CLASSES } from './grid-store.js'

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
