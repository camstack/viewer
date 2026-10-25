/**
 * The tier guard, mirrored from the server so the operator learns it here: a
 * label that is a macro class ("person") is a different tier from a label
 * ("postman", "Marco") and the server refuses it.
 */
import { RETRAIN_MACROS } from '../data/retrain-parse.js'
import type { EditorBox } from './editor.js'

const MACRO_SET: ReadonlySet<string> = new Set<string>(RETRAIN_MACROS)

/** The macro the text names, or `null` when it is a proper label (or empty). */
export function tierError(value: string | undefined): string | null {
  const trimmed = value?.trim().toLowerCase()
  if (trimmed === undefined || trimmed === '') return null
  return MACRO_SET.has(trimmed) ? trimmed : null
}

/** Does every CONFIRMED box pass the guard? A draft is never saved, so it cannot block. */
export function annotationsAreValid(boxes: readonly EditorBox[]): boolean {
  return boxes
    .filter((b) => !b.draft)
    .every(
      (b) =>
        tierError(b.label) === null && tierError(b.subLabel) === null && MACRO_SET.has(b.macroClass),
    )
}
