/**
 * FaceCertaintyBadge — the certainty as ONE WORD, derived from a SINGLE
 * face's own `suggestedMatchScore` (never a group's) through the same tone
 * bands `face-confidence.ts` uses for `bestMatchScore`, so the colour means
 * the same thing everywhere in the app. See `face-cluster-review.ts`'s
 * `faceSuggestionCertainty`.
 *
 * It sits NEXT TO `FaceConfidenceBar`, not instead of it: the bar answers
 * "how much" at a glance across a grid, the word answers "so what" without
 * asking the operator to decode a fill length. Both take their tint from
 * `face-certainty-style.ts`, so they cannot disagree.
 */
import React, { memo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { FACE_CERTAINTY_LABEL_KEY, faceCertaintyTint } from './face-certainty-style.js'
import type { FaceSuggestionCertainty } from '../../data/face-cluster-review.js'

export interface FaceCertaintyBadgeProps {
  readonly certainty: FaceSuggestionCertainty
}

export const FaceCertaintyBadge = memo(function FaceCertaintyBadge({ certainty }: FaceCertaintyBadgeProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const tint = faceCertaintyTint(certainty, colors)
  return (
    <View style={[styles.badge, { backgroundColor: `${tint}22` }]}>
      <Text numberOfLines={1} style={[styles.label, { color: tint }]}>
        {t(FACE_CERTAINTY_LABEL_KEY[certainty])}
      </Text>
    </View>
  )
})

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderRadius: RADIUS.sm, paddingHorizontal: SPACING.xs, paddingVertical: 2 },
  label: { fontSize: 10, fontWeight: '700' },
})
