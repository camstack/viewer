/**
 * condition-taxonomy — the CANONICAL copy, re-exported.
 *
 * This file was a local duplicate of `@camstack/types` →
 * `src/notification/condition-taxonomy.ts` (the logic was written here and
 * hoisted there so the admin UI stopped rendering every list condition as a
 * free-text box). Its own header carried the TODO that ends it: *"collapse it
 * into a re-export as soon as that dependency is bumped"*. The dependency was
 * pinned at `@camstack/types@0.1.42`, which predates the hoist; it is
 * `^1.2.89` now (`camstack/package.json`), and the installed package ships
 * `dist/notification/condition-taxonomy`. So the copy is gone.
 *
 * The re-export is EXPLICIT rather than `export *`: this app uses the picker
 * model and nothing else of that module (the viewer has no "base conditions"
 * split any more — every condition a kind can use is always shown).
 *
 * Group header labels still resolve via the i18n key
 * `v2.nc.rules.editor.taxonomy.<key>` with the shared model's English label as
 * the `defaultValue` — that binding lives at the call site (`ConditionField`),
 * not in the model, which is why nothing about it had to be hoisted.
 */
export { knownValues, pickerForCondition } from '@camstack/types/client'
export type { TaxonomyGroup, TaxonomyOption, TaxonomyPicker } from '@camstack/types'
