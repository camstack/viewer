/**
 * ActionButtonsEditor — the buttons the rule's notification carries, each
 * running one Action (the admin's "Buttons on the notification"). A button
 * cannot define steps of its own.
 *
 * A button whose Action the hub no longer lists still shows it, marked
 * missing, rather than silently re-pointing at another. The id is generated
 * and never shown — it is what the audit line names when the button is tapped,
 * not something to author.
 */
import React, { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Section } from '../../../../../components/ui/Section.js'
import { SelectRow, type SelectOption } from '../../../../../components/ui/SelectRow.js'
import { ToggleRow } from '../../../../../components/ui/ToggleRow.js'
import {
  NC_ACTION_BUTTONS_MAX,
  NcNotificationActionIconSchema,
  type NcNotificationActionIcon,
  type NcRuleNotificationButton,
} from '../../../../../data/notification-center.js'
import type { NcListedAction } from '../../../../../data/listed-actions.js'
import { useTheme } from '../../../../../theme/theme-provider.js'
import { SPACING } from '../../../../../theme/tokens.js'
import { Hint } from '../SectionHint.js'
import { ActionLinkButton, ActionTextField } from './action-controls.js'
import { ActionPickerSheet } from './ActionPickerSheet.js'

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

function actionName(actions: readonly NcListedAction[] | undefined, id: string, missing: string, pending: string): string {
  if (id.trim().length === 0) return missing
  if (actions === undefined) return pending
  return actions.find((action) => action.id === id)?.name ?? missing
}

export interface ActionButtonRowProps {
  readonly button: NcRuleNotificationButton
  /** The hub's Actions; `undefined` while unanswered. */
  readonly actions: readonly NcListedAction[] | undefined
  readonly onChange: (next: NcRuleNotificationButton) => void
  readonly onRemove: () => void
}

export function ActionButtonRow({ button, actions, onChange, onRemove }: ActionButtonRowProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const canPick = actions !== undefined && actions.length > 0
  const iconOptions: readonly SelectOption<string>[] = [
    { value: UNSET, label: t(`${UI}.iconNone`) },
    ...NcNotificationActionIconSchema.options.map((icon: NcNotificationActionIcon) => ({
      value: icon,
      label: t(`${UI}.icon.${icon}`),
    })),
  ]
  const name = actionName(
    actions,
    button.actionId,
    t(`${UI}.actionMissing`, { id: button.actionId }),
    t(`${UI}.actionById`, { id: button.actionId }),
  )

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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(`${UI}.buttonActionLabel`)}
        onPress={() => {
          if (canPick) setOpen(true)
        }}
        style={{ paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md }}
      >
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }}>{t(`${UI}.buttonActionLabel`)}</Text>
        <Text style={{ color: colors.foreground, fontSize: 16, paddingVertical: SPACING.sm }}>{name}</Text>
      </Pressable>
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
      {open && actions !== undefined ? (
        <ActionPickerSheet
          title={t(`${UI}.pickAction`)}
          actions={actions}
          onPick={(actionId) => {
            onChange({ ...button, actionId })
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Section>
  )
}

export interface ActionButtonsFooterProps {
  readonly count: number
  /** No Action to run: a button would point at nothing. */
  readonly noActions: boolean
  readonly onAdd: () => void
}

/** The hint and the add control; adding stops at the hub's maximum. */
export function ActionButtonsFooter({ count, noActions, onAdd }: ActionButtonsFooterProps) {
  const { t } = useTranslation()
  return (
    <View style={{ paddingHorizontal: SPACING.xs }}>
      <Hint text={count === 0 ? `${t(`${UI}.buttonsEmpty`)} ${t(`${UI}.buttonsHint`)}` : t(`${UI}.buttonsHint`)} />
      <ActionLinkButton
        kind="add"
        label={t(`${UI}.addButton`)}
        onPress={onAdd}
        disabled={noActions || count >= NC_ACTION_BUTTONS_MAX}
      />
    </View>
  )
}
