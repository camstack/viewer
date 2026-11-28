/**
 * AppRail — the narrow, always-visible column at the left of the drawer: one icon per
 * app the hub offered (`drawer-model`), the active one highlighted; a tap switches app.
 * It replaces the selector row and its sheet. While the list has not answered it draws
 * one inert placeholder, never "no apps" (D315). Each icon is labelled with the app's name.
 */
import React from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Layers } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import { RADIUS, SPACING } from '../theme/tokens.js'
import { appIconFor } from './app-icons.js'
import type { DrawerApp, RailState } from './drawer-model.js'

export const APP_RAIL_WIDTH = 56
const BUTTON_SIZE = 40

export interface AppRailProps {
  readonly state: RailState
  readonly apps: readonly DrawerApp[]
  readonly onPick: (id: string) => void
}

export function AppRail({ state, apps, onPick }: AppRailProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[styles.rail, { paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: colors.backgroundElevated, borderRightColor: colors.border }]}
      testID="drawer-app-rail"
      accessibilityRole="tablist"
    >
      <ScrollView contentContainerStyle={styles.column} showsVerticalScrollIndicator={false}>
        {state !== 'ready' ? (
          <View
            style={styles.button}
            testID="drawer-app-rail-pending"
            accessibilityRole="progressbar"
            accessibilityLabel={t(state === 'pending' ? 'v2.apps.loading' : 'v2.apps.unavailable')}
          >
            <Layers size={20} color={colors.foregroundDisabled} />
          </View>
        ) : (
          apps.map((app) => {
            const Icon = appIconFor(app.icon)
            return (
              <Pressable
                key={app.id}
                testID={`drawer-app-${app.id}`}
                onPress={() => onPick(app.id)}
                accessibilityRole="tab"
                accessibilityLabel={app.label}
                aria-selected={app.selected}
                style={[styles.button, app.selected ? { backgroundColor: colors.surfaceHover } : null]}
              >
                <Icon size={20} color={app.selected ? colors.primary : colors.foregroundMuted} />
              </Pressable>
            )
          })
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  rail: { width: APP_RAIL_WIDTH, borderRightWidth: StyleSheet.hairlineWidth },
  column: { alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.md },
  button: { width: BUTTON_SIZE, height: BUTTON_SIZE, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
})
