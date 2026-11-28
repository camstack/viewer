/**
 * AppTopStrip — the one thin strip over a framed app (Admin):
 * [menu] [back] title, where the route is (LOCAL / REMOTE) and a reload. Back goes back inside
 * the app while it has history, and at the app's root returns to the previous screen, or to
 * the Cameras tab when there is none; the drawer reaches everything else.
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { HeaderBackButton } from '../components/ScreenHeader.js'
import { Badge } from '../components/ui/Badge.js'
import { hapticTap } from '../lib/haptics.js'
import { Menu, RotateCw } from '../lib/icons.js'
import { backOrCameras } from '../navigation/back-or-cameras.js'
import { frameController } from './frame-controller.js'
import { frameCanGoBack } from './frame-history.js'
import { useAppStore } from './app-store.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING } from '../theme/tokens.js'

export const APP_STRIP_HEIGHT = 44

export interface AppTopStripProps {
  readonly title: string
  /** `null` while the route is not known: no badge rather than a wrong one. */
  readonly local: boolean | null
  readonly onMenu: () => void
  readonly onReload?: () => void
}

export function AppTopStrip({ title, local, onMenu, onReload }: AppTopStripProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const inFrameHistory = useAppStore((s) => frameCanGoBack(s.frameHistory))
  const onBack = (): void => {
    if (inFrameHistory && frameController.back()) return
    backOrCameras(router)
  }
  return (
    <View
      style={[
        styles.strip,
        { paddingTop: insets.top, height: APP_STRIP_HEIGHT + insets.top, backgroundColor: colors.backgroundElevated, borderBottomColor: colors.border },
      ]}
    >
      <Pressable
        testID="app-strip-menu"
        onPress={() => {
          hapticTap()
          onMenu()
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('v2.apps.openMenu')}
        style={styles.icon}
      >
        <Menu size={20} color={colors.foreground} />
      </Pressable>
      <HeaderBackButton size={32} testID="app-strip-back" onPress={onBack} />
      <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>
        {title}
      </Text>
      {local === null ? null : (
        <Badge size="sm" tone={local ? 'success' : 'warning'} label={t(local ? 'v2.apps.routeLocal' : 'v2.apps.routeRemote')} />
      )}
      <View style={styles.spacer} />
      {onReload !== undefined ? (
        <Pressable
          testID="app-strip-reload"
          onPress={onReload}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('v2.apps.reload')}
          style={styles.icon}
        >
          <RotateCw size={18} color={colors.foregroundMuted} />
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  spacer: { flex: 1 },
})
