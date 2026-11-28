/**
 * LaunchPreferenceSheet — "Open at launch": the app the viewer opens with, or
 * the last one used. Opened from the drawer's bottom block.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { AppLabel } from '@dominevo/types'

import { MenuRow } from '../components/ui/MenuRow.js'
import { PickerSheet, PickerSheetButton } from '../components/ui/PickerSheet.js'
import { useAppCatalog } from '../data/use-apps.js'
import { hapticTap } from '../lib/haptics.js'
import { Check, Settings, X } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import { useAppStore } from './app-store.js'
import { launchChoices } from './launch-choices.js'

export interface LaunchPreferenceSheetProps {
  readonly onClose: () => void
}

export function LaunchPreferenceSheet({ onClose }: LaunchPreferenceSheetProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { catalog } = useAppCatalog()
  const preference = useAppStore((s) => s.launchPreference)
  const setPreference = useAppStore((s) => s.setLaunchPreference)
  const translate = (label: AppLabel): string => t(label.key, { defaultValue: label.fallback })
  return (
    <PickerSheet
      title={t('v2.apps.openAtLaunch')}
      onClose={onClose}
      testID="launch-preference-sheet"
      headerRight={
        <PickerSheetButton label={t('v2.common.close')} onPress={onClose}>
          <X size={18} color={colors.foreground} />
        </PickerSheetButton>
      }
    >
      {launchChoices(catalog, translate).map((choice) => (
        <MenuRow
          key={choice.preference}
          testID={`launch-option-${choice.preference}`}
          icon={Settings}
          label={choice.label ?? t('v2.apps.launchLast')}
          selected={choice.preference === preference}
          onPress={() => {
            hapticTap()
            setPreference(choice.preference)
            onClose()
          }}
          trailing={choice.preference === preference ? <Check size={16} color={colors.primary} /> : null}
        />
      ))}
    </PickerSheet>
  )
}
