/**
 * The retrain class picker's model — pure. The SAME taxonomy the notification
 * rules use (`classPickerItems`), walked in two steps: the MACRO class first
 * (only those the trainer uses), then a sub-class of that macro as the label.
 */
import type { RetrainMacroClass } from '@camstack/types'
import type { NcTaxonomy } from '../data/notification-center.js'
import { RETRAIN_OFFERED_MACROS } from '../data/retrain-parse.js'
import { classPickerItems } from '../components/notifications/rule-scope-form.js'
import type { PickerItem } from '../components/notifications/device-picker-model.js'
import type { BoxDiff } from './live-review.js'

/** The macros offered, named by the taxonomy when it lists them, else by `fallbackName`. */
export function macroPickerItems(
  taxonomy: NcTaxonomy | undefined,
  fallbackName: (macro: RetrainMacroClass) => string,
): PickerItem<string>[] {
  const listed = new Map((classPickerItems(taxonomy)?.items ?? []).map((i) => [i.id, i.name]))
  return RETRAIN_OFFERED_MACROS.map((macro) => ({
    id: macro,
    name: listed.get(macro) ?? fallbackName(macro),
    type: 'macro',
  }))
}

/** The taxonomy entries under one macro (the macro itself excluded: it is not a label). */
export function subClassPickerItems(
  taxonomy: NcTaxonomy | undefined,
  macro: RetrainMacroClass,
): PickerItem<string>[] {
  return (classPickerItems(taxonomy)?.items ?? [])
    .filter((item) => item.type === macro && item.id !== macro)
    .map((item) => ({ ...item, type: macro }))
}

/** The class a box originally carried and the one it carries now, as display text. */
export interface OriginalClassText {
  readonly original: string
  readonly current: string
}

export interface OriginalClassInput {
  readonly diff: BoxDiff | undefined
  readonly macroClass: RetrainMacroClass
  readonly label: string | undefined
  readonly macroName: (macro: RetrainMacroClass) => string
}

/**
 * "cat → dog", or "animal/cat → person" when the macro changed too. Only a
 * RECLASSIFIED box with a known original says anything; otherwise `null`.
 */
export function originalClassText(input: OriginalClassInput): OriginalClassText | null {
  const { diff, macroClass, label, macroName } = input
  if (diff?.kind !== 'reclassified' || diff.originMacroClass === undefined) return null
  const originLabel = diff.originLabel ?? ''
  const nowLabel = label ?? ''
  const macroChanged = diff.originMacroClass !== macroClass
  if (!macroChanged && originLabel === nowLabel) return null
  const side = (macro: RetrainMacroClass, text: string): string => {
    if (macroChanged) return text === '' ? macroName(macro) : `${macroName(macro)}/${text}`
    return text === '' ? macroName(macro) : text
  }
  return {
    original: side(diff.originMacroClass, originLabel),
    current: side(macroClass, nowLabel),
  }
}
