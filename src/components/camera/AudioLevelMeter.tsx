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
 * INLINE adjustment: tap (or long-press) the meter to open a quick position
 * picker right on the player — the same `OverlayPositionPicker` as the overlay
 * panel, which stays available too. `position: 'off'` renders nothing.
 */
import React, { useState, useCallback } from 'react'
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
  anchorBands,
  audioLevelColor,
  type AudioMeterOrientation,
} from './audio-level.js'

interface AudioLevelMeterProps {
  readonly deviceId: number
  /** Where the meter is anchored; `off` renders nothing. Mount + subscribe only
   *  while placed (gated to the live edge by the caller). */
  readonly position: OverlayPosition
  /** Adjust the anchor inline from the on-player picker (the sheet grid shares
   *  the same setter).
   *
   *  OMITTED = a read-only meter that never captures a touch. That is what a
   *  GRID TILE needs: a tap there toggles the tile's own controls, and a meter
   *  that opened a position picker over a 200pt cell would steal it. */
  readonly onSetPosition?: (position: OverlayPosition) => void
}

/** Absolute-placement style for the meter's outer container derived from the
 *  anchor's vertical + horizontal bands. Edge anchors pin to that edge; a
 *  `center` band pins BOTH opposing edges and centres the content between them
 *  (RN honours left+right / top+bottom together as a stretch the child centres
 *  within). */
function placementStyle(position: OverlayPosition): ViewStyle {
  const bands = anchorBands(position)
  if (bands === null) return {}
  const style: ViewStyle = {}
  if (bands.vertical === 'top') style.top = SPACING.md
  else if (bands.vertical === 'bottom') style.bottom = SPACING.md
  else {
    style.top = SPACING.md
    style.bottom = SPACING.md
    style.justifyContent = 'center'
  }
  if (bands.horizontal === 'left') style.left = SPACING.md
  else if (bands.horizontal === 'right') style.right = SPACING.md
  else {
    style.left = SPACING.md
    style.right = SPACING.md
    style.alignItems = 'center'
  }
  return style
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

export function AudioLevelMeter({ deviceId, position, onSetPosition }: AudioLevelMeterProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const sx = useStyleScaler()
  const [pickerOpen, setPickerOpen] = useState(false)
  const placed = position !== 'off'
  const dbfs = useAudioLevel(deviceId, placed)
  const level = dbfsToLevel(dbfs)
  const orientation = meterOrientation(position)

  const closePicker = useCallback(() => setPickerOpen(false), [])
  const togglePicker = useCallback(() => setPickerOpen((o) => !o), [])
  const onPick = useCallback(
    (next: OverlayPosition) => {
      onSetPosition?.(next)
      setPickerOpen(false)
    },
    [onSetPosition],
  )
  /** Read-only host (a grid tile): draw the pill, take no touches. */
  const interactive = onSetPosition !== undefined

  if (!placed || orientation === null) return null

  return (
    <>
      <View
        style={[styles.anchor, placementStyle(position)]}
        pointerEvents={interactive ? 'box-none' : 'none'}
      >
        <Pressable
          onPress={interactive ? togglePicker : undefined}
          onLongPress={interactive ? togglePicker : undefined}
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

      {pickerOpen ? (
        <View style={styles.pickerOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel={t('v2.cameraDetail.close')}
            onPress={closePicker}
          />
          <View style={[styles.pickerCard, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
              {t('v2.cameraMenu.audioLevel')}
            </Text>
            <OverlayPositionPicker value={position} onChange={onPick} allowOff cellSize={34} />
          </View>
        </View>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  // Positioning frame — the anchor pins the meter to the chosen edge/corner or
  // centres it along an axis; the inner `meter` is the VU pill.
  anchor: {
    position: 'absolute',
  },
  meter: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
  },
  segment: {
    borderRadius: 2,
  },
  // Inline picker — a centred card over the player (dismissed by tapping the
  // scrim). Sibling of the meter so it renders above the video/gesture layer.
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
