/**
 * AppSelectorSheet — the apps the hub offered, the active one ticked; a tap
 * switches to it (`goApp` of the drawer). The same sheet pattern as the server
 * switch, opened from the drawer's selector row.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'

import { MenuRow } from '../components/ui/MenuRow.js'
import { PickerSheet, PickerSheetButton } from '../components/ui/PickerSheet.js'
import { Check, X } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import { appIconFor } from './app-icons.js'
import type { DrawerApp } from './drawer-model.js'

export interface AppSelectorSheetProps {
  readonly apps: readonly DrawerApp[]
  readonly onPick: (id: string) => void
  readonly onClose: () => void
}

export function AppSelectorSheet({ apps, onPick, onClose }: AppSelectorSheetProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <PickerSheet
      title={t('v2.apps.apps')}
      onClose={onClose}
      testID="app-selector-sheet"
      headerRight={
        <PickerSheetButton label={t('v2.common.close')} onPress={onClose}>
          <X size={18} color={colors.foreground} />
        </PickerSheetButton>
      }
    >
      {apps.map((app) => (
        <MenuRow
          key={app.id}
          testID={`drawer-app-${app.id}`}
          icon={appIconFor(app.icon)}
          label={app.label}
          selected={app.selected}
          onPress={() => onPick(app.id)}
          trailing={app.selected ? <Check size={16} color={colors.primary} /> : null}
        />
      ))}
    </PickerSheet>
  )
}
