/** A one-line state for an editor route: loading, missing, unknown section. */
import React from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'

export function EditorNotice({ message }: { readonly message?: string }) {
  const { colors } = useTheme()
  return (
    <View style={{ paddingVertical: SPACING['3xl'], alignItems: 'center' }}>
      {message === undefined ? (
        <ActivityIndicator size="small" color={colors.foregroundSubtle} />
      ) : (
        <Text style={{ color: colors.foregroundSubtle, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
          {message}
        </Text>
      )}
    </View>
  )
}
