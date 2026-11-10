/**
 * ActionPickerSheet — pick one existing Action by name. The hook editor and
 * the button editor both open it; creating an Action stays on the hub's
 * Actions page (the viewer has no screen for that).
 */
import React, { useState } from 'react'
import { Pressable, ScrollView, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { PickerSheet, PickerSheetButton } from '../../../../../components/ui/PickerSheet.js'
import { X } from '../../../../../lib/icons.js'
import type { NcListedAction } from '../../../../../data/listed-actions.js'
import { useTheme } from '../../../../../theme/theme-provider.js'
import { SPACING } from '../../../../../theme/tokens.js'

const UI = 'v2.nc.rules.editor.actions'

export interface ActionPickerSheetProps {
  readonly title: string
  readonly actions: readonly NcListedAction[]
  readonly onPick: (actionId: string) => void
  readonly onClose: () => void
}

export function ActionPickerSheet({ title, actions, onPick, onClose }: ActionPickerSheetProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = needle.length === 0 ? actions : actions.filter((action) => action.name.toLowerCase().includes(needle))

  return (
    <PickerSheet
      testID="rule-action-picker"
      title={title}
      onClose={onClose}
      headerRight={
        <PickerSheetButton onPress={onClose} label={t('v2.common.close')}>
          <X size={18} color={colors.foreground} />
        </PickerSheetButton>
      }
      search={{ value: query, onChange: setQuery, placeholder: t(`${UI}.actionSearchPlaceholder`) }}
    >
      <ScrollView contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg }}>
        {shown.length === 0 ? (
          <Text style={{ color: colors.foregroundSubtle, fontSize: 13, paddingVertical: SPACING.md }}>
            {t(`${UI}.actionNoMatch`)}
          </Text>
        ) : (
          shown.map((action) => (
            <Pressable
              key={action.id}
              accessibilityRole="button"
              accessibilityLabel={action.name}
              onPress={() => onPick(action.id)}
              style={{ paddingVertical: SPACING.md }}
            >
              <Text style={{ color: colors.foreground, fontSize: 16 }}>{action.name}</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </PickerSheet>
  )
}
