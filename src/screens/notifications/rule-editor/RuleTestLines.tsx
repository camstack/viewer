/**
 * RuleTestLines — renders the i18n lines `rule-test-result.ts` decides.
 *
 * The first line is the verdict and reads as one; the rest are what the
 * operator needs to read it honestly (plan notes, hub notes), subdued.
 */
import React from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../theme/theme-provider.js'
import type { RuleTestLine } from '../../../components/notifications/rule-test-result.js'

export interface RuleTestLinesProps {
  readonly lines: readonly RuleTestLine[]
}

export function RuleTestLines({ lines }: RuleTestLinesProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View style={{ gap: 4 }}>
      {lines.map((line, index) => (
        <Text
          key={`${line.key}:${String(index)}`}
          style={{
            color: index === 0 ? colors.foreground : colors.foregroundSubtle,
            fontSize: index === 0 ? 13 : 12,
            lineHeight: index === 0 ? 18 : 16,
          }}
        >
          {t(line.key, line.params)}
        </Text>
      ))}
    </View>
  )
}
