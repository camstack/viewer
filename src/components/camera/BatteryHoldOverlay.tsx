/**
 * BatteryHoldOverlay — the play button that IS the wake.
 *
 * Drawn over the frozen snapshot of a battery camera the viewer has
 * deliberately not dialled (see `live/battery-stream-gate.ts`). It exists
 * because the poster alone is ambiguous: a still picture with no chrome reads
 * as a broken stream, and the transport that would explain it
 * (`StreamOverlayControls` on the detail screen, none at all on a grid tile) is
 * hidden until the operator taps the stage — a tap they have no reason to make
 * on what looks like a dead camera.
 *
 * So the disc is unconditional, centred, and says out loud what pressing it
 * costs: the camera is asleep and this will wake it. One press, one wake, on
 * purpose.
 *
 * The hint is suppressed on a `compact` surface (a grid cell, which can be
 * 150 pt wide) — a sentence there would cover the picture it annotates. The
 * disc still carries the whole meaning in its accessibility label.
 */
import React, { memo, useCallback } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'

import { hapticAction } from '../../lib/haptics.js'
import { Play } from '../../lib/icons.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'

export interface BatteryHoldOverlayProps {
  /** Start the stream — and, deliberately, wake the camera. */
  readonly onStart: () => void
  /** Grid-cell sizing: smaller disc, no sentence. */
  readonly compact?: boolean
}

export const BatteryHoldOverlay = memo(function BatteryHoldOverlay({
  onStart,
  compact = false,
}: BatteryHoldOverlayProps) {
  const { t } = useTranslation()

  // `hapticAction`, not `hapticTap`: this press has a CONSEQUENCE out in the
  // world (a camera comes out of low-power mode), which is the distinction the
  // two levels encode.
  const onPress = useCallback(() => {
    hapticAction()
    onStart()
  }, [onStart])

  const size = compact ? 44 : 64

  return (
    // `box-none`: the backdrop must not swallow the taps that belong to the
    // surface underneath (the grid cell's own reveal gesture, the detail
    // stage's controls toggle). Only the disc and the hint are touchable.
    <View style={styles.root} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t('v2.battery.startStreamA11y')}
        hitSlop={12}
        style={[
          styles.disc,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      >
        <Play size={compact ? 20 : 28} color="#fafaf9" fill="#fafaf9" />
      </Pressable>
      {compact ? null : (
        <Text style={styles.hint} numberOfLines={3}>
          {t('v2.battery.holdHint')}
        </Text>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
  },
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    // Fixed dark scrim rather than a theme token: this sits on an arbitrary
    // camera frame, not on the app's background, so contrast has to come from
    // the disc itself in both themes.
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(250,250,249,0.5)',
  },
  hint: {
    color: '#fafaf9',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: 260,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(0,0,0,0.55)',
    overflow: 'hidden',
  },
})
