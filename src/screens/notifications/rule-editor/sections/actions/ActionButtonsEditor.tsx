/**
 * ActionButtonsEditor — the buttons the rule's notification carries, each
 * running one SHARED sequence by id (the admin's "Buttons on the
 * notification"). A button cannot define steps of its own.
 *
 * A button whose sequence the hub no longer lists still shows it, marked
 * missing, rather than silently re-pointing at another. The id is generated
 * and never shown — it is what the audit line names when the button is tapped,
 * not something to author.
 */
import React from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Section } from '../../../../../components/ui/Section.js'
import { SelectRow, type SelectOption } from '../../../../../components/ui/SelectRow.js'
import { ToggleRow } from '../../../../../components/ui/ToggleRow.js'
import {
  NC_ACTION_BUTTONS_MAX,
  NcNotificationActionIconSchema,
  type NcNotificationActionIcon,
  type NcRuleNotificationButton,
  type NcSharedSequence,
} from '../../../../../data/notification-center.js'
import { SPACING } from '../../../../../theme/tokens.js'
import { Hint } from '../SectionHint.js'
import { ActionLinkButton, ActionTextField } from './action-controls.js'
import { sequenceOptions, UNSET_SEQUENCE } from './sequence-options.js'

const UI = 'v2.nc.rules.editor.actions'
/** The select's "no icon" value — never a real icon. */
const UNSET = ''

function withIcon(button: NcRuleNotificationButton, raw: string): NcRuleNotificationButton {
  const { icon: _dropped, ...rest } = button
  const parsed = NcNotificationActionIconSchema.safeParse(raw)
  return parsed.success ? { ...rest, icon: parsed.data } : rest
}

function withDestructive(button: NcRuleNotificationButton, destructive: boolean): NcRuleNotificationButton {
  const { destructive: _dropped, ...rest } = button
  return destructive ? { ...rest, destructive: true } : rest
}

export interface ActionButtonRowProps {
  readonly button: NcRuleNotificationButton
  /** The hub's shared sequences; `undefined` while unanswered. */
  readonly sequences: readonly NcSharedSequence[] | undefined
  readonly onChange: (next: NcRuleNotificationButton) => void
  readonly onRemove: () => void
}

export function ActionButtonRow({ button, sequences, onChange, onRemove }: ActionButtonRowProps) {
  const { t } = useTranslation()
  const iconOptions: readonly SelectOption<string>[] = [
    { value: UNSET, label: t(`${UI}.iconNone`) },
    ...NcNotificationActionIconSchema.options.map((icon: NcNotificationActionIcon) => ({
      value: icon,
      label: t(`${UI}.icon.${icon}`),
    })),
  ]

  return (
    <Section>
      <View style={{ paddingHorizontal: SPACING.xl, paddingVertical: SPACING.lg }}>
        <ActionTextField
          label={t(`${UI}.buttonLabelLabel`)}
          value={button.label}
          onChangeText={(label) => onChange({ ...button, label })}
          invalid={button.label.trim().length === 0}
        />
      </View>
      <SelectRow<string>
        label={t(`${UI}.buttonSequenceLabel`)}
        options={sequenceOptions(sequences, button.sequenceId, t)}
        value={button.sequenceId.trim()}
        onChange={(sequenceId) => {
          if (sequenceId !== UNSET_SEQUENCE && sequenceId !== button.sequenceId) onChange({ ...button, sequenceId })
        }}
      />
      <SelectRow<string>
        label={t(`${UI}.buttonIconLabel`)}
        options={iconOptions}
        value={button.icon ?? UNSET}
        onChange={(raw) => onChange(withIcon(button, raw))}
      />
      <ToggleRow
        label={t(`${UI}.destructiveLabel`)}
        description={t(`${UI}.destructiveHint`)}
        value={button.destructive === true}
        onValueChange={(next) => onChange(withDestructive(button, next))}
      />
      <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md }}>
        <ActionLinkButton kind="remove" label={t(`${UI}.removeButton`)} onPress={onRemove} />
      </View>
    </Section>
  )
}

export interface ActionButtonsFooterProps {
  readonly count: number
  /** No shared sequence to run: a button would point at nothing. */
  readonly noSequences: boolean
  readonly onAdd: () => void
}

/** The hint and the add control; adding stops at the hub's maximum. */
export function ActionButtonsFooter({ count, noSequences, onAdd }: ActionButtonsFooterProps) {
  const { t } = useTranslation()
  return (
    <View style={{ paddingHorizontal: SPACING.xs }}>
      <Hint text={count === 0 ? `${t(`${UI}.buttonsEmpty`)} ${t(`${UI}.buttonsHint`)}` : t(`${UI}.buttonsHint`)} />
      <ActionLinkButton
        kind="add"
        label={t(`${UI}.addButton`)}
        onPress={onAdd}
        disabled={noSequences || count >= NC_ACTION_BUTTONS_MAX}
      />
    </View>
  )
}
