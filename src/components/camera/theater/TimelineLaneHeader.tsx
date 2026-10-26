/**
 * TimelineLaneHeader — the row of icons over the three activity lanes, so a
 * line at the edge of the screen says WHAT it is without a trip to the legend.
 *
 * Fixed at the top of the body (it does not scroll with the lanes) on a soft
 * backdrop, so a lane sliding under it does not run into the icons. It is a
 * label, not a control: `pointerEvents="none"`, like the lanes it names.
 *
 * Only the lanes that are actually drawn get an icon (a deselected activity
 * layer is simply not painted — `ActivityLanes`), in the same slots
 * (`timeline-lanes-layout.ts`), so each icon sits exactly over its line.
 */
import React, { memo } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Move, Video, Volume2, type LucideIcon } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { paintKind, usePaletteView, type PaletteView } from '../../../../shared/palette.js'
import {
  LANE_ORDER,
  LANE_RIGHT_INSET_PX,
  LANE_SLOT_PX,
  LANES_WIDTH_PX,
  laneSlotLeft,
  type LaneKey,
} from './timeline-lanes-layout.js'

export const LANE_HEADER_TEST_ID = 'timeline-lane-header'
export const LANE_HEADER_HEIGHT_PX = 24
const ICON_PX = 14

const LANE_ICON: Readonly<Record<LaneKey, LucideIcon>> = {
  audio: Volume2,
  recording: Video,
  motion: Move,
}

/** The colour of a lane's mark and its icon — one palette entry, both themes. */
export function laneColor(lane: LaneKey, view: PaletteView): string {
  if (lane === 'audio') return paintKind(view, 'audio')
  if (lane === 'recording') return paintKind(view, 'recording')
  return paintKind(view, 'motion')
}

/** The lanes that are drawn, left to right. Recording always is. */
export function visibleLanes(showAudio: boolean, showMotion: boolean): readonly LaneKey[] {
  return LANE_ORDER.filter(
    (lane) => lane === 'recording' || (lane === 'audio' ? showAudio : showMotion),
  )
}

export interface TimelineLaneHeaderProps {
  readonly showAudio: boolean
  readonly showMotion: boolean
}

export const TimelineLaneHeader = memo(function TimelineLaneHeader({
  showAudio,
  showMotion,
}: TimelineLaneHeaderProps): React.JSX.Element {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const palette = usePaletteView()
  return (
    <View
      testID={LANE_HEADER_TEST_ID}
      pointerEvents="none"
      style={[styles.wrap, { right: LANE_RIGHT_INSET_PX - SPACING.md }]}
    >
      <View style={[styles.pill, { backgroundColor: `${colors.background}E6`, borderColor: colors.borderSubtle }]}>
        <View style={styles.slots}>
          {visibleLanes(showAudio, showMotion).map((lane) => {
            const Icon = LANE_ICON[lane]
            return (
              <View
                key={lane}
                accessibilityLabel={t(`v2.theater.lane.${lane}`)}
                style={[styles.slot, { left: laneSlotLeft(lane) }]}
              >
                <Icon size={ICON_PX} color={laneColor(lane, palette)} />
              </View>
            )
          })}
        </View>
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: SPACING.sm,
  },
  pill: {
    height: LANE_HEADER_HEIGHT_PX,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  slots: {
    width: LANES_WIDTH_PX,
    height: LANE_HEADER_HEIGHT_PX,
  },
  slot: {
    position: 'absolute',
    top: 0,
    width: LANE_SLOT_PX,
    height: LANE_HEADER_HEIGHT_PX,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
