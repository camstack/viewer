/**
 * ActionHookEditor — one hook edge of the rule (on activation / deactivation /
 * trigger / trigger off) and the Actions it starts, in order. The admin's
 * `HookSection`. Adding stops at the hub's cap per edge, and only once the hub
 * has listed at least one Action (an id would otherwise point at nothing).
 */
import React, { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Section } from '../../../../../components/ui/Section.js'
import { SectionLabel } from '../../../../../components/ui/SectionLabel.js'
import {
  addAction,
  canAddAction,
  moveAction,
  removeAction,
  replaceAction,
} from '../../../../../components/notifications/rule-action-edit.js'
import type { NcActionsFormState, NcHookKey } from '../../../../../components/notifications/rule-action-form.js'
import type { NcListedAction } from '../../../../../data/listed-actions.js'
import { useTheme } from '../../../../../theme/theme-provider.js'
import { SPACING } from '../../../../../theme/tokens.js'
import { Hint } from '../SectionHint.js'
import { ActionLinkButton } from './action-controls.js'
import { ActionPickerSheet } from './ActionPickerSheet.js'

const UI = 'v2.nc.rules.editor.actions'

type Picker =
  | { readonly kind: 'add' }
  | { readonly kind: 'replace'; readonly index: number }

export interface ActionHookEditorProps {
  readonly hook: NcHookKey
  readonly form: NcActionsFormState
  /** The hub's Actions; `undefined` while unanswered. */
  readonly actions: readonly NcListedAction[] | undefined
  readonly onChange: (next: NcActionsFormState) => void
}

function actionName(actions: readonly NcListedAction[] | undefined, id: string, missing: string, pending: string): string {
  if (actions === undefined) return pending
  return actions.find((action) => action.id === id)?.name ?? missing
}

export function ActionHookEditor({ hook, form, actions, onChange }: ActionHookEditorProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ids = form[hook]
  const room = canAddAction(form, hook)
  const canPick = actions !== undefined && actions.length > 0
  const [picker, setPicker] = useState<Picker | null>(null)

  const pick = (actionId: string): void => {
    if (picker === null) return
    onChange(
      picker.kind === 'add' ? addAction(form, hook, actionId) : replaceAction(form, hook, picker.index, actionId),
    )
    setPicker(null)
  }

  return (
    <View style={{ gap: SPACING.md }} testID={`rule-actions-hook-${hook}`}>
      <SectionLabel inset>{t(`${UI}.hook.${hook}.title`)}</SectionLabel>
      <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 17, paddingHorizontal: SPACING.xs }}>
        {t(`${UI}.hook.${hook}.hint`)}
      </Text>
      {ids.length === 0 ? <Hint text={t(`${UI}.hookEmpty`)} /> : null}
      {ids.map((id, index) => (
        <Section key={`${hook}#${index}`}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(`${UI}.actionLabel`)}
            onPress={() => {
              if (canPick) setPicker({ kind: 'replace', index })
            }}
            style={{ paddingHorizontal: SPACING.xl, paddingTop: SPACING.lg }}
          >
            <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }}>{t(`${UI}.actionLabel`)}</Text>
            <Text style={{ color: colors.foreground, fontSize: 16, paddingVertical: SPACING.sm }}>
              {actionName(actions, id, t(`${UI}.actionMissing`, { id }), t(`${UI}.actionById`, { id }))}
            </Text>
          </Pressable>
          <View style={{ flexDirection: 'row', paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md, gap: SPACING.lg }}>
            <ActionLinkButton
              kind="up"
              label={t(`${UI}.moveUp`)}
              disabled={index === 0}
              onPress={() => onChange(moveAction(form, hook, index, -1))}
            />
            <ActionLinkButton
              kind="down"
              label={t(`${UI}.moveDown`)}
              disabled={index === ids.length - 1}
              onPress={() => onChange(moveAction(form, hook, index, 1))}
            />
            <ActionLinkButton
              kind="remove"
              label={t(`${UI}.removeBinding`)}
              onPress={() => onChange(removeAction(form, hook, index))}
            />
          </View>
        </Section>
      ))}
      <View style={{ paddingHorizontal: SPACING.xs }}>
        <ActionLinkButton
          kind="add"
          label={t(`${UI}.addAction`)}
          disabled={!room || !canPick}
          onPress={() => setPicker({ kind: 'add' })}
        />
      </View>
      {picker !== null && actions !== undefined ? (
        <ActionPickerSheet
          title={t(`${UI}.pickAction`)}
          actions={actions}
          onPick={pick}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </View>
  )
}
