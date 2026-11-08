/**
 * condition-description — the one line under a condition field.
 *
 * The hub's `descriptor.description` is an ENGLISH schema comment ("Weekly
 * activation windows (invertible); absent = always active."), not operator
 * copy: drawing it raw leaked English into the Italian editor. A hint is drawn
 * only when this app has its own translation under `conditionHint.<id>`;
 * otherwise nothing is drawn — never the hub's text.
 *
 * Pure: the lookup is injected, so the rule stays testable without i18next.
 */
import type { NcConditionDescriptor } from '../../data/notification-center.js'

const HINT = 'v2.nc.rules.editor.conditionHint'

/** The translation key of one condition's hint line. */
export function conditionHintKey(descriptorId: string): string {
  return `${HINT}.${descriptorId}`
}

/** A key's translation, or `undefined` when this locale has none. */
export type NcHintLookup = (key: string) => string | undefined

/** The localised hint for a condition, or `null` — the hub's raw description is never returned. */
export function conditionDescriptionText(
  descriptor: Pick<NcConditionDescriptor, 'id'>,
  lookup: NcHintLookup,
): string | null {
  const text = lookup(conditionHintKey(descriptor.id))
  return text !== undefined && text.trim().length > 0 ? text : null
}
