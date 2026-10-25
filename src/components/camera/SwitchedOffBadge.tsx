/**
 * SwitchedOffBadge — "someone turned a function off here", on a camera tile.
 *
 * D62's fourth consequence, on the two surfaces where a quiet camera is
 * indistinguishable from a dead one: *a camera producing nothing because
 * somebody switched it off must not look like one that is broken.*
 *
 * The distinction is drawn in COLOUR and in kind, not only in text:
 *   • offline / unreachable → the status dot goes grey (nothing was chosen)
 *   • out of service → the status dot goes black (`stream-broker`, the whole
 *     camera; already rendered by `CameraStatusDot`)
 *   • a FUNCTION deliberately off → this amber badge, on a camera that is
 *     otherwise up and answering.
 *
 * Amber, because it is neither a fault (red) nor normal (green) — it is a state
 * an operator chose and might have forgotten.
 *
 * It counts rather than names: a tile has no room for five labels, the ids are
 * server vocabulary, and the count is enough to make somebody open the camera —
 * where the group spells each one out with its cost. Nothing here maps an id to
 * a word, so a switch the hub gains tomorrow is counted correctly today.
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { PowerOff } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS } from '../../theme/tokens.js'

export interface SwitchedOffBadgeProps {
  /** The ids the hub reported as switched off. Empty renders nothing. */
  readonly switchedOff: readonly string[]
  /** Compact form for the grid wall's overlay (no count text). */
  readonly compact?: boolean
  /** Accessible label — translated by the caller (the badge owns no copy). */
  readonly accessibilityLabel: string
}

export function SwitchedOffBadge({
  switchedOff,
  compact = false,
  accessibilityLabel,
}: SwitchedOffBadgeProps): React.JSX.Element | null {
  const { colors } = useTheme()
  if (switchedOff.length === 0) return null
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[styles.badge, { backgroundColor: colors.warning }]}
    >
      <PowerOff size={compact ? 9 : 10} color={colors.background} />
      {!compact ? (
        <Text style={[styles.count, { color: colors.background }]}>{switchedOff.length}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  count: { fontSize: 10, fontWeight: '700' },
})
