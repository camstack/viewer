/**
 * AudioLevelMeter — the player's live audio-level meter. A view-options overlay,
 * exactly like the bounding-box overlay: event-fed from the hub (the
 * `pipeline.audio-inference-result` dBFS stream via `useAudioLevel`), gated by a
 * position selector in the view-options menu.
 *
 * Layout ADAPTS to the chosen anchor (see `meterOrientation`):
 *   • corner  → a compact VU pill (increasing-height bars, short→tall).
 *   • top/bottom edge → a horizontal strip (equal bars, lit left→right).
 *   • left/right side → a vertical strip (equal bars, lit bottom→top).
 * Segments light up to the current level (green low → amber → red at the top);
 * above-level segments stay dim. While placed it always shows the frame, so the
 * operator sees the meter even in silence.
 *
 * INLINE adjustment: tap (or long-press) the meter and the host opens a quick
 * position picker right on the player (`AudioMeterPicker` — the same
 * `OverlayPositionPicker` as the overlay panel, which stays available too).
 * The meter has no place of its own: the overlay stack puts it at its anchor,
 * and the picker is a sibling of the stack because a card inside a stack would
 * be clipped by it. `position: 'off'` renders nothing.
 */
import React from 'react'
import { View, Pressable, Text, StyleSheet, type ViewStyle } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import { useAudioLevel } from '../../data/use-audio.js'
import { OverlayPositionPicker } from './overlay/OverlayPositionPicker.js'
import { useStyleScaler } from './overlay/OverlayFrame.js'
import { type OverlayPosition } from './overlay/overlay-position.js'
import {
  dbfsToLevel,
  meterOrientation,
  meterSegmentSize,
  meterRenderOrder,
  audioLevelColor,
  type AudioMeterOrientation,
} from './audio-level.js'

interface AudioLevelMeterProps {
  readonly deviceId: number
  /** Where the meter is anchored — it decides the meter's orientation (the
   *  stack decides where it is drawn); `off` renders nothing. Mount + subscribe
   *  only while placed (gated to the live edge by the caller). */
  readonly position: OverlayPosition
  /** Tap / long-press — the host opens {@link AudioMeterPicker}.
   *
   *  OMITTED = a read-only meter that never captures a touch. That is what a
   *  GRID TILE needs: a tap there toggles the tile's own controls, and a meter
   *  that opened a position picker over a 200pt cell would steal it. */
  readonly onPress?: () => void
}

/** The pill's flex container style for an orientation. */
function meterContainerStyle(orientation: AudioMeterOrientation): ViewStyle {
  if (orientation === 'vertical') {
    return { flexDirection: 'column', alignItems: 'center', gap: 4 }
  }
  if (orientation === 'horizontal') {
    return { flexDirection: 'row', alignItems: 'center', gap: 4 }
  }
  // compact — bars grow in height, so bottom-align them.
  return { flexDirection: 'row', alignItems: 'flex-end', gap: 3 }
}

export function AudioLevelMeter({ deviceId, position, onPress }: AudioLevelMeterProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const sx = useStyleScaler()
  const placed = position !== 'off'
  const dbfs = useAudioLevel(deviceId, placed)
  const level = dbfsToLevel(dbfs)
  const orientation = meterOrientation(position)
  /** Read-only host (a grid tile): draw the pill, take no touches. */
  const interactive = onPress !== undefined

  if (!placed || orientation === null) return null

  return (
    <View pointerEvents={interactive ? 'box-none' : 'none'}>
      <Pressable
        onPress={onPress}
        onLongPress={onPress}
        accessibilityRole={interactive ? 'button' : 'image'}
        accessibilityLabel={t('v2.cameraMenu.audioLevel')}
        style={[
          sx(styles.meter),
          sx(meterContainerStyle(orientation)),
          { backgroundColor: `${colors.background}B3` },
        ]}
      >
        {meterRenderOrder(orientation).map((logicalIndex) => {
          const lit = logicalIndex < level
          return (
            <View
              key={logicalIndex}
              style={[
                sx(styles.segment),
                sx(meterSegmentSize(orientation, logicalIndex)),
                {
                  backgroundColor: lit ? audioLevelColor(logicalIndex) : colors.foregroundDisabled,
                  opacity: lit ? 1 : 0.35,
                },
              ]}
            />
          )
        })}
      </Pressable>
    </View>
  )
}

interface AudioMeterPickerProps {
  readonly position: OverlayPosition
  readonly onPick: (next: OverlayPosition) => void
  readonly onClose: () => void
}

/** The inline position picker: a centred card over the player (dismissed by
 *  tapping the scrim). Mounted by the host as a sibling of the overlay stack. */
export function AudioMeterPicker({ position, onPick, onClose }: AudioMeterPickerProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View style={styles.pickerOverlay}>
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel={t('v2.cameraDetail.close')}
        onPress={onClose}
      />
      <View style={[styles.pickerCard, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
        <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
          {t('v2.cameraMenu.audioLevel')}
        </Text>
        <OverlayPositionPicker value={position} onChange={onPick} allowOff cellSize={34} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  meter: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
  },
  segment: {
    borderRadius: 2,
  },
  // Inline picker — a sibling of the stack, so it renders above the
  // video/gesture layer.
  pickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.lg,
    alignItems: 'center',
    gap: SPACING.xs,
  },
  pickerTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
})
