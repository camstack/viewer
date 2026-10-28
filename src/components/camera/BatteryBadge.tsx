/**
 * BatteryBadge — a battery camera's charge, as an icon plus a percentage.
 *
 * Extracted from `CameraCard` on 2026-08-01 so the camera DETAIL can show it
 * too. It was only ever on the list, which meant the one screen where you watch
 * a battery camera was the one screen that never told you its charge.
 *
 * The three states are encoded in the icon, not in the number: charging, low,
 * and normal read at a glance in a toolbar where the percentage may be clipped.
 * Low also takes `danger`; the others wear the neutral tone of their row. A `binary` battery reports no percentage at all — some cameras
 * only say "ok" or "low" — so the text is omitted rather than showing a
 * fabricated figure.
 *
 * Size is a prop because this now renders in two very different places: a card
 * footer at rest and a dense toolbar that scales with the drawer width.
 */
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { BatteryCharging, BatteryFull, BatteryLow } from '../../lib/icons.js'
import type { BatteryStatus } from '../../data/use-battery.js'
import type { ColorTokens } from '../../theme/tokens.js'

/** At or below this the badge turns to the danger colour. */
export const LOW_BATTERY_PCT = 20

/** The neutral glyph tone: the card footer's muted caption, or a toolbar's icon colour. */
export type StatusGlyphTone = 'foreground' | 'foregroundMuted'

/**
 * The badge's colour. Only LOW has a status meaning (`danger`); charging is told
 * by its glyph and stays neutral — it used to borrow `info`, a blue no other
 * header control wears (operator, 2026-10-23).
 */
export function batteryBadgeColor(
  battery: Pick<BatteryStatus, 'charging' | 'level'>,
  colors: ColorTokens,
  neutral: StatusGlyphTone = 'foregroundMuted',
): string {
  const charging = battery.charging === 'dc' || battery.charging === 'solar'
  return !charging && battery.level <= LOW_BATTERY_PCT ? colors.danger : colors[neutral]
}

export interface BatteryBadgeProps {
  readonly battery: BatteryStatus
  readonly colors: ColorTokens
  /** Icon size in px; the label tracks it. Defaults to the card footer's 14. */
  readonly size?: number
  /** Glyph only — colour and icon carry the state where a row has no room for the figure. */
  readonly compact?: boolean
  /** The colour of a battery with nothing to warn about. Defaults to the muted caption. */
  readonly neutral?: StatusGlyphTone
}

export function BatteryBadge({
  battery,
  colors,
  size = 14,
  compact = false,
  neutral = 'foregroundMuted',
}: BatteryBadgeProps): React.JSX.Element {
  // Only a power source the camera REPORTED lights the charging glyph.
  const charging = battery.charging === 'dc' || battery.charging === 'solar'
  const low = battery.level <= LOW_BATTERY_PCT
  const color = batteryBadgeColor(battery, colors, neutral)
  const Icon = charging ? BatteryCharging : low ? BatteryLow : BatteryFull
  return (
    <View style={styles.row}>
      <Icon size={size} color={color} />
      {battery.binary || compact ? null : (
        <Text style={[styles.text, { color, fontSize: Math.max(9, size - 3) }]}>
          {Math.round(battery.level)}%
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  text: { fontWeight: '600' },
})
