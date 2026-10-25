/**
 * condition-field-keys — which `NcConditions` key a `number` widget may write.
 *
 * The widget used to be hard-wired to the one descriptor its valueType had
 * when it was written (`number` → `minDwellSeconds`). A second descriptor of
 * that valueType would have rendered the FIRST one's value and written into
 * the FIRST one's key — a silent corruption of an unrelated condition. With a
 * guard, a descriptor this build does not know renders nothing instead (the
 * sibling `number01` / `stringList` branches already work this way).
 *
 * The zone lists no longer need a guard: `zones` / `zonesExclude` are ONE
 * scope field (`rule-scope-form.ts`), never a per-valueType widget.
 */
import type { NcConditions } from '../../data/notification-center.js'

/** `NcConditions` keys whose value is a plain non-negative number. */
export const NC_NUMBER_CONDITION_KEYS = ['minDwellSeconds'] as const satisfies readonly (keyof NcConditions)[]
export type NcNumberConditionKey = (typeof NC_NUMBER_CONDITION_KEYS)[number]

/** Narrow a catalog descriptor id to a `number`-widget conditions key (no cast). */
export function isNumberConditionKey(id: string): id is NcNumberConditionKey {
  return NC_NUMBER_CONDITION_KEYS.some((key) => key === id)
}
