/**
 * FaceConfidenceBar — the suggestion's confidence AS A BAR, restored on the
 * operator's request after a redesign replaced it with a bare word.
 *
 * ⚠ This is NOT the bar that was deleted on 2026-08-26. That one filled by a
 * quantity nobody could name — a cluster's vote agreement × its vote strength,
 * or its cohesion when nobody voted — so two crops of the same person showed
 * the same fill regardless of how well EACH matched. This one fills by a
 * single face's own `suggestedMatchScore` and nothing else, and it is tinted
 * by the same `faceCertaintyTint` bands the word uses, so bar and word can
 * never disagree.
 *
 * Deliberately 3 pt tall and captionless: it rides at the bottom edge of the
 * crop, adding no height to a grid tile (`ReviewTile`). The exact
 * percentage stays where it always was — in the detail modal, for the one
 * face the operator is actually doubtful about.
 */
import React, { memo } from 'react'
import { View, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { FACE_CERTAINTY_LABEL_KEY, faceCertaintyTint } from './face-certainty-style.js'
import type { FaceSuggestionCertainty } from '../../data/face-cluster-review.js'

export interface FaceConfidenceBarProps {
  /** 0..1. Values outside are clamped rather than overflowing the track. */
  readonly score: number
  readonly certainty: FaceSuggestionCertainty
  /** Track height in pt. Defaults to the 3 pt the grid cell uses. */
  readonly height?: number
}

export const FaceConfidenceBar = memo(function FaceConfidenceBar({
  score,
  certainty,
  height = 3,
}: FaceConfidenceBarProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const percent = Math.round(Math.max(0, Math.min(1, score)) * 100)
  const tint = faceCertaintyTint(certainty, colors)
  return (
    <View
      accessibilityRole="progressbar"
      // A 3 pt colour band is invisible to a screen reader; the word and the
      // number are what it announces.
      accessibilityLabel={`${t(FACE_CERTAINTY_LABEL_KEY[certainty])} ${String(percent)}%`}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={[styles.track, { height, backgroundColor: `${colors.foregroundMuted}33` }]}
    >
      <View style={[styles.fill, { height, width: `${percent}%`, backgroundColor: tint }]} />
    </View>
  )
})

const styles = StyleSheet.create({
  track: { width: '100%', overflow: 'hidden' },
  fill: { borderTopRightRadius: 1, borderBottomRightRadius: 1 },
})
