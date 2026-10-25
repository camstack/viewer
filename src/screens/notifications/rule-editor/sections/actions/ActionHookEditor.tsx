/**
 * ActionHookEditor — one hook edge of the rule (on activation / deactivation /
 * trigger / trigger off) and its bindings: each runs a SHARED sequence by id,
 * or one inline step ("Single action"). The admin's `HookSection`.
 *
 * Adding stops at the hub's cap per edge; a sequence binding can only be added
 * once the hub has listed at least one sequence (it would point at nothing).
 */
import React from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Section } from '../../../../../components/ui/Section.js'
import { SelectRow } from '../../../../../components/ui/SelectRow.js'
import {
  addBinding,
  canAddBinding,
  newDoBindingForm,
  newSequenceBindingForm,
  removeBinding,
  replaceBinding,
} from '../../../../../components/notifications/rule-action-edit.js'
import type {
  NcActionsFormState,
  NcBindingForm,
  NcHookKey,
} from '../../../../../components/notifications/rule-action-form.js'
import type { NcSharedSequence } from '../../../../../data/notification-center.js'
import { useTheme } from '../../../../../theme/theme-provider.js'
import { SPACING } from '../../../../../theme/tokens.js'
import { Hint } from '../SectionHint.js'
import { ActionLinkButton } from './action-controls.js'
import { ActionStepEditor } from './ActionStepEditor.js'
import { sequenceOptions, UNSET_SEQUENCE } from './sequence-options.js'
import { SectionLabel } from '../../../../../components/ui/SectionLabel.js'

const UI = 'v2.nc.rules.editor.actions'

export interface ActionHookEditorProps {
  readonly hook: NcHookKey
  readonly form: NcActionsFormState
  /** The hub's shared sequences; `undefined` while unanswered. */
  readonly sequences: readonly NcSharedSequence[] | undefined
  readonly onChange: (next: NcActionsFormState) => void
}

export function ActionHookEditor({ hook, form, sequences, onChange }: ActionHookEditorProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const bindings = form[hook]
  const room = canAddBinding(form, hook)
  const firstSequence = sequences?.[0]?.id

  const card = (binding: NcBindingForm, index: number): React.ReactElement => {
    const set = (next: NcBindingForm): void => onChange(replaceBinding(form, hook, index, next))
    const remove = (): void => onChange(removeBinding(form, hook, index))
    if (binding.kind === 'do') {
      return (
        <Section key={binding.editId}>
          <ActionStepEditor
            title={t(`${UI}.doTitle`)}
            removeLabel={t(`${UI}.removeBinding`)}
            step={binding.step}
            onChange={(step) => set({ ...binding, step })}
            onRemove={remove}
          />
        </Section>
      )
    }
    return (
      <Section key={binding.editId}>
        <SelectRow<string>
          label={t(`${UI}.sequenceLabel`)}
          options={sequenceOptions(sequences, binding.sequenceId, t)}
          value={binding.sequenceId.trim()}
          onChange={(sequenceId) => {
            if (sequenceId !== UNSET_SEQUENCE && sequenceId !== binding.sequenceId) set({ ...binding, sequenceId })
          }}
        />
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md }}>
          <ActionLinkButton kind="remove" label={t(`${UI}.removeBinding`)} onPress={remove} />
        </View>
      </Section>
    )
  }

  return (
    <View style={{ gap: SPACING.md }} testID={`rule-actions-hook-${hook}`}>
      <SectionLabel inset>{t(`${UI}.hook.${hook}.title`)}</SectionLabel>
      <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 17, paddingHorizontal: SPACING.xs }}>
        {t(`${UI}.hook.${hook}.hint`)}
      </Text>
      {bindings.length === 0 ? <Hint text={t(`${UI}.hookEmpty`)} /> : null}
      {bindings.map(card)}
      <View style={{ paddingHorizontal: SPACING.xs }}>
        <ActionLinkButton
          kind="add"
          label={t(`${UI}.addSequenceBinding`)}
          disabled={!room || firstSequence === undefined}
          onPress={() =>
            onChange(addBinding(form, hook, (siblings) => newSequenceBindingForm(siblings, firstSequence ?? '')))
          }
        />
        <ActionLinkButton
          kind="add"
          label={t(`${UI}.addDoBinding`)}
          disabled={!room}
          onPress={() => onChange(addBinding(form, hook, newDoBindingForm))}
        />
      </View>
    </View>
  )
}
