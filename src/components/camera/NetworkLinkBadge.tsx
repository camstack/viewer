/**
 * NetworkLinkBadge — the camera's own link, as an icon plus the signal.
 *
 * Sits next to `BatteryBadge` in the card footer and the detail toolbar. A
 * wireless link shows the wifi glyph and its signal; a poor signal takes the
 * warning colour so it reads at a glance. A wire draws nothing here — the
 * footer is for what can change — and an `unknown` link is the absence of a
 * read, never a wire, so it draws nothing either. A wireless link whose signal
 * is not known yet shows the glyph alone rather than a fabricated 0 %.
 */
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Radio, Wifi } from '../../lib/icons.js'
import type { NetworkLinkStatus } from '../../data/use-network-link.js'
import type { ColorTokens } from '../../theme/tokens.js'
import type { StatusGlyphTone } from './BatteryBadge.js'

/** At or below this the badge turns to the warning colour. */
export const WEAK_SIGNAL_PCT = 30

export interface NetworkLinkBadgeProps {
  readonly link: NetworkLinkStatus | null | undefined
  readonly colors: ColorTokens
  /** Icon size in px; the label tracks it. Defaults to the card footer's 14. */
  readonly size?: number
  /** Glyph only — colour carries weak/strong where a row has no room for the figure. */
  readonly compact?: boolean
  /** The colour of a healthy link. Defaults to the muted caption. */
  readonly neutral?: StatusGlyphTone
}

/**
 * Whether this badge draws anything at all — a wire and an unread link draw
 * nothing (see the header). Exported because a HOST that wraps the glyph in a
 * button must not create an empty, labelled, pressable target around it.
 */
export function networkLinkBadgeVisible(link: NetworkLinkStatus | null | undefined): boolean {
  return link != null && (link.type === 'wifi' || link.type === 'cellular')
}

export function NetworkLinkBadge({
  link,
  colors,
  size = 14,
  compact = false,
  neutral = 'foregroundMuted',
}: NetworkLinkBadgeProps): React.JSX.Element | null {
  if (!networkLinkBadgeVisible(link) || !link) return null
  const signal = link.signalPercent
  const weak = signal !== null && signal <= WEAK_SIGNAL_PCT
  // `warning`, as the header says: a weak signal is a caution, not a failure.
  const color = weak ? colors.warning : colors[neutral]
  const Icon = link.type === 'cellular' ? Radio : Wifi
  return (
    <View style={styles.row}>
      <Icon size={size} color={color} />
      {signal === null || compact ? null : (
        <Text style={[styles.text, { color, fontSize: Math.max(9, size - 3) }]}>
          {Math.round(signal)}%
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  text: { fontWeight: '600' },
})
