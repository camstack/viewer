/**
 * HeaderMenuButton — the ☰ at the right of an inner screen's header. It opens
 * the same app drawer as the home bar's ☰.
 */
import React, { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppStore } from '../apps/app-store.js'
import { HEADER_BUTTON_SIZE } from '../components/screen-header-metrics.js'
import { GlassButton } from '../components/ui/GlassButton.js'
import { Menu } from '../lib/icons.js'

export const HEADER_MENU_TEST_ID = 'header-menu-button'

export const HeaderMenuButton = memo(function HeaderMenuButton(): React.JSX.Element {
  const { t } = useTranslation()
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen)
  return (
    <GlassButton
      icon={Menu}
      label={t('v2.apps.openMenu')}
      onPress={() => setDrawerOpen(true)}
      size={HEADER_BUTTON_SIZE}
      testID={HEADER_MENU_TEST_ID}
    />
  )
})
