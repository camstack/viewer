/**
 * FullScreenFrame — the root of a stacked, full-screen route (the remote, a
 * device's detail).
 *
 * The TOP inset is spent by `ScreenHeader`, the BOTTOM one by the body's
 * scroll content ({@link fullScreenBottomPad}); this frame spends the SIDES, so
 * in landscape neither the header nor the body sits under the notch or the
 * rounded corners. One component, so the two full-screen screens cannot drift.
 */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING } from '../theme/tokens.js'

/** Bottom padding of a full-screen body's scroll content: the home indicator plus a gap. */
export function fullScreenBottomPad(insetBottom: number): number {
  return insetBottom + SPACING['2xl']
}

export interface FullScreenFrameProps {
  readonly testID?: string
  readonly children: React.ReactNode
}

export function FullScreenFrame({ testID, children }: FullScreenFrameProps): React.JSX.Element {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[styles.root, { backgroundColor: colors.background, paddingLeft: insets.left, paddingRight: insets.right }]}
      testID={testID}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({ root: { flex: 1 } })
