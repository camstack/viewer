/**
 * EditorScroll — the body of every rule-editor route: header, then a scroll
 * that the keyboard never covers.
 *
 * `KeyboardAwareScrollView` pads the content by the keyboard and scrolls the
 * focused field into view on iOS AND Android (an edge-to-edge window is not
 * resized for the keyboard), and `keyboardShouldPersistTaps="handled"` lets a
 * template variable chip insert on the FIRST tap while the keyboard is up
 * instead of spending it on a dismiss.
 */
import React from 'react'
import { View } from 'react-native'
import { ScreenHeader } from '../../../components/ScreenHeader.js'
import { KeyboardAwareScrollView } from '../../../components/ui/KeyboardInset.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'

export interface EditorScrollProps {
  readonly title: string
  readonly onBack: () => void
  readonly children: React.ReactNode
}

export function EditorScroll({ title, onBack, children }: EditorScrollProps) {
  const { colors } = useTheme()
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={title} onBack={onBack} bordered />
      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: SPACING.xl, paddingBottom: SPACING['3xl'], gap: SPACING.xl }}
      >
        {children}
      </KeyboardAwareScrollView>
    </View>
  )
}
