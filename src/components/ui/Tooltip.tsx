/**
 * Tooltip — universal hover tooltip for icon-only controls.
 *
 * WEB: wraps the child in a hover-sensitive area (`Pressable` `onHoverIn`/
 * `onHoverOut` — RN-web maps these to mouse hover) and, after a short dwell
 * (`TOOLTIP_SHOW_DELAY_MS`), floats a themed label ABOVE the child, centered
 * via the measured widths (`tooltipLeftOffset`, pure + unit-tested).
 *
 * NATIVE: a pass-through — there is no hover, and no popup is needed; the
 * caller sets the SAME string as the wrapped control's `accessibilityLabel`
 * so VoiceOver/TalkBack read it.
 *
 * Single universal file by design (no `.web.tsx` fork): the platform branch
 * lives inside, and the web-only hook component is only mounted on web.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Text, Pressable, Platform, StyleSheet } from 'react-native'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS, TYPOGRAPHY } from '../../theme/tokens.js'
import { GlassPanel } from './GlassPanel.js'
import { TOOLTIP_SHOW_DELAY_MS, TOOLTIP_GAP, tooltipLeftOffset } from './tooltip-position.js'

interface TooltipProps {
  /** Localized tooltip text. Callers must also pass the same string as the
   *  wrapped control's `accessibilityLabel` (the native "tooltip"). */
  readonly label: string
  readonly children: React.ReactNode
}

export function Tooltip({ label, children }: TooltipProps) {
  // Platform is fixed for the app's lifetime, so the branch never flips
  // between renders (hooks stay unconditional inside WebTooltip).
  if (Platform.OS !== 'web') return <>{children}</>
  return <WebTooltip label={label}>{children}</WebTooltip>
}

/** Web-only implementation (hover + floating label). */
function WebTooltip({ label, children }: TooltipProps) {
  const { colors } = useTheme()
  const [visible, setVisible] = useState(false)
  const [anchorW, setAnchorW] = useState(0)
  const [tipW, setTipW] = useState(0)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (showTimer.current) clearTimeout(showTimer.current) }, [])

  const onHoverIn = useCallback(() => {
    if (showTimer.current) clearTimeout(showTimer.current)
    showTimer.current = setTimeout(() => setVisible(true), TOOLTIP_SHOW_DELAY_MS)
  }, [])
  const onHoverOut = useCallback(() => {
    if (showTimer.current) clearTimeout(showTimer.current)
    setVisible(false)
  }, [])

  return (
    <Pressable
      accessible={false}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      onLayout={(e) => setAnchorW(e.nativeEvent.layout.width)}
    >
      {children}
      {visible ? (
        <GlassPanel
          pointerEvents="none"
          radius={RADIUS.md}
          onLayout={(e) => setTipW(e.nativeEvent.layout.width)}
          style={[
            styles.tip,
            {
              left: tooltipLeftOffset(anchorW, tipW),
              // Painted only once measured — avoids a one-frame off-center flash.
              opacity: tipW > 0 ? 1 : 0,
            },
          ]}
        >
          <Text style={[styles.tipText, { color: colors.foreground }]} numberOfLines={1}>
            {label}
          </Text>
        </GlassPanel>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  tip: {
    position: 'absolute',
    bottom: '100%',
    marginBottom: TOOLTIP_GAP,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    zIndex: 100,
  },
  tipText: {
    fontSize: TYPOGRAPHY.size.sm,
    fontWeight: TYPOGRAPHY.weight.regular,
  },
})
