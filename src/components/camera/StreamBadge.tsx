/**
 * The glyph a camera gets when it has NEITHER a battery nor a link to report.
 *
 * The status card is where the stream numbers live, and the card is opened by
 * pressing a badge. A wired camera that reports no battery and no link showed
 * no badge at all — so on exactly the cameras an operator is most likely to be
 * debugging (the permanently-powered ones), the numbers were unreachable.
 *
 * It is deliberately NOT shown next to the other two. A third glyph on every
 * camera would be three taps to learn what two already say, and the stream
 * section is appended to those cards anyway. This is the fallback, and it looks
 * like what it opens: a chart.
 */
import React from 'react'
import { View } from 'react-native'

import { Activity } from '../../lib/icons.js'
import type { ColorTokens } from '../../theme/tokens.js'
import type { StatusGlyphTone } from './BatteryBadge.js'

export interface StreamBadgeProps {
  readonly colors: ColorTokens
  readonly size?: number
  /** The glyph's tone; defaults to the card footer's muted caption. */
  readonly neutral?: StatusGlyphTone
}

export function StreamBadge({ colors, size = 14, neutral = 'foregroundMuted' }: StreamBadgeProps): React.JSX.Element {
  return (
    <View accessible={false}>
      <Activity size={size} color={colors[neutral]} />
    </View>
  )
}

/**
 * Whether the fallback belongs on this camera: only when neither of the other
 * two badges is drawn. Exported so both hosts decide it the same way — the
 * rule is "neither", and two copies of it would drift the first time one of
 * the other badges changed its own visibility rule.
 */
export function streamBadgeVisible(input: {
  readonly batteryVisible: boolean
  readonly linkVisible: boolean
}): boolean {
  return !input.batteryVisible && !input.linkVisible
}
