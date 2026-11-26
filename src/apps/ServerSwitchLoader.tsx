/**
 * ServerSwitchLoader — the full-page cover shown while `switchServer` runs: the
 * target server's name and a spinner, over everything, until the switch settles
 * (switched, needs sign-in or failed). The state lives in the app store because
 * the sheet that starts the switch is closed with the tap.
 */
import React from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useTheme } from '../theme/theme-provider.js'
import { SPACING } from '../theme/tokens.js'
import { useAppStore } from './app-store.js'

export function ServerSwitchLoader(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const target = useAppStore((s) => s.serverSwitch)
  if (target === null) return null
  const label = t('v2.servers.switching', { name: target.name })
  return (
    <View
      style={[styles.root, { backgroundColor: colors.background }]}
      testID="server-switch-loader"
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.label, { color: colors.foregroundMuted }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
  },
  label: { fontSize: 14 },
})
