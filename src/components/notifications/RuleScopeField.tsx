/**
 * RuleScopeField — one scope axis of a rule (its devices, or its detection
 * classes) as ONE field (D641): a segmented pre-selector "All | Only these |
 * All except these" and, for the two list modes, ONE picker underneath. The
 * two stored lists never sit side by side as two fields.
 *
 * The decisions are `rule-scope-model.ts` (byte-identical to the admin's
 * copy); this draws them, as the admin's `RuleScopeField.tsx` does:
 *
 *  - All draws no picker — there is nothing to pick — only a line saying so.
 *  - A mode switch moves nothing: the list left behind stays in the draft, and
 *    what Save will clear is SAID under the picker, never done quietly.
 *  - A legacy rule carrying BOTH lists opens in Only with a notice naming its
 *    exclusions and a "Remove exclusions" action (D49): they are never
 *    dropped by a read or a save, only by the operator.
 *  - "All except these" is drawn only when the hub serves the exclusion
 *    (`exceptOffered`), or when the rule is already in it.
 *
 * The picker is the caller's (`renderPicker`), so devices and classes keep
 * their own list, words and grouping.
 */
import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { SegmentedControl, type SegmentOption } from '../ui/SegmentedControl.js'
import { PickerLine } from './ItemPicker.js'
import { RULE_SCOPE_MODE_LABEL_KEYS } from './rule-scope-form.js'
import {
  RULE_SCOPE_MODES,
  removeRuleScopeExclusions,
  ruleScopeClearedOnSave,
  ruleScopeLegacyExclusions,
  ruleScopeList,
  setRuleScopeList,
  switchRuleScopeMode,
  type RuleScopeDraft,
  type RuleScopeId,
  type RuleScopeMode,
} from './rule-scope-model.js'

/** The list mode a picker is drawn for. */
export type RuleScopeListMode = Exclude<RuleScopeMode, 'all'>

export interface RuleScopeFieldProps<Id extends RuleScopeId> {
  readonly draft: RuleScopeDraft<Id>
  readonly onChange: (next: RuleScopeDraft<Id>) => void
  /** The hub serves the exclude condition for this axis and rule. */
  readonly exceptOffered: boolean
  /** What All means, said in place of the picker ("Every camera"). */
  readonly everyLabel: string
  /** The one picker, over the active mode's list. */
  readonly renderPicker: (
    value: readonly Id[],
    onChange: (next: Id[]) => void,
    mode: RuleScopeListMode,
  ) => React.ReactNode
  /** An id as the notices name it (a camera's name, a class's label). */
  readonly describe: (id: Id) => string
  readonly testID?: string
}

export function RuleScopeField<Id extends RuleScopeId>({
  draft,
  onChange,
  exceptOffered,
  everyLabel,
  renderPicker,
  describe,
  testID,
}: RuleScopeFieldProps<Id>): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const options: readonly SegmentOption<RuleScopeMode>[] = RULE_SCOPE_MODES.filter(
    (mode) => mode !== 'except' || exceptOffered || draft.mode === 'except',
  ).map((mode) => ({ value: mode, label: t(RULE_SCOPE_MODE_LABEL_KEYS[mode]) }))
  const legacy = ruleScopeLegacyExclusions(draft)
  const cleared = ruleScopeClearedOnSave(draft)
  const listMode: RuleScopeListMode | null = draft.mode === 'all' ? null : draft.mode

  return (
    <View style={{ gap: SPACING.sm }} testID={testID}>
      <SegmentedControl<RuleScopeMode>
        options={options}
        value={draft.mode}
        onChange={(mode) => onChange(switchRuleScopeMode(draft, mode))}
      />
      {listMode === null ? (
        <PickerLine text={everyLabel} />
      ) : (
        // Keyed on the mode: each list is its own picker, and the widening
        // warning of one must not follow the operator into the other.
        <View key={listMode}>
          {renderPicker(ruleScopeList(draft), (next) => onChange(setRuleScopeList(draft, next)), listMode)}
        </View>
      )}
      {legacy.length > 0 ? (
        <View testID="scope-legacy-exclusions" style={{ gap: SPACING.xs }}>
          <PickerLine
            warning
            text={t('v2.nc.rules.scope.legacyExclusions', { items: legacy.map(describe).join(', ') })}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => onChange(removeRuleScopeExclusions(draft))}
            style={{ alignSelf: 'flex-start', paddingVertical: SPACING.xs }}
          >
            <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>
              {t('v2.nc.rules.scope.removeExclusions')}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {cleared.length > 0 ? (
        <View testID="scope-cleared-on-save">
          <PickerLine text={t('v2.nc.rules.scope.clearedOnSave', { items: cleared.map(describe).join(', ') })} />
        </View>
      ) : null}
    </View>
  )
}
