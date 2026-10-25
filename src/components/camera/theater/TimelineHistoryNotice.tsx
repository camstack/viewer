/**
 * TimelineHistoryNotice — the theater's "there is more" line.
 *
 * `TRACKS_MAX_ROWS` (`use-device-tracks.ts`) used to be a silent ceiling: a
 * busy camera's history stopped at its row bound with nothing on screen to
 * say so — "no more footage" and "more footage, just not fetched yet" read as
 * the identical timeline. `useDeviceTracks` now returns `hasMoreHistory`; this
 * is the one place that fact reaches the operator, with the action that
 * resolves it (`loadMoreHistory`).
 *
 * Docked in the SAME chrome slot as `TimelineFaultNotice` — directly under
 * it — but deliberately NOT that component. `hasMoreHistory` is not a
 * failure: `timeline-faults.ts`'s own rule is "an empty result is not a
 * fault", and the mirror of that holds here too — MORE data existing is
 * ordinary, not an error. Borrowing the red alert grammar for it would be
 * exactly the kind of "two different situations, one visual language" bug
 * that module was written to remove, aimed at a third situation instead of
 * being fixed.
 *
 * Presentational only: the caller (`TheaterTimeline`) owns the loading state
 * and the load-more action.
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { ChevronDown } from '../../../lib/icons.js'
import { hapticTap } from '../../../lib/haptics.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { useTimelineScale } from './TimelineScaleProvider.js'

export interface TimelineHistoryNoticeProps {
  /** `hasMoreHistory` from `useDeviceTracks` — false renders nothing. */
  readonly visible: boolean
  /** `isLoadingMoreHistory` — disables the chip mid-fetch so a second tap
   *  cannot fire a second overlapping request. */
  readonly loading: boolean
  readonly onLoadMore: () => void
}

export function TimelineHistoryNotice({
  visible,
  loading,
  onLoadMore,
}: TimelineHistoryNoticeProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ui = useTimelineScale()

  // Healthy/exhausted history draws NOTHING — same discipline as the fault
  // band: a notice that shows on the common case teaches the operator to
  // ignore it on the day it matters.
  if (!visible) return null

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, borderBottomColor: colors.border },
      ]}
    >
      <View
        style={[
          styles.row,
          { paddingHorizontal: ui.space.md, paddingVertical: ui.space.sm, gap: ui.space.sm },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.message, { color: colors.foregroundMuted, fontSize: ui.font.xs }]}
        >
          {t('v2.timeline.moreHistory')}
        </Text>
        <Pressable
          onPress={() => {
            hapticTap()
            onLoadMore()
          }}
          // A second press while the first chunk is still loading would only
          // fire an overlapping fetch for the same continuation cursor.
          disabled={loading}
          style={[
            styles.chip,
            {
              height: ui.control.button,
              borderRadius: ui.radius.lg,
              paddingHorizontal: ui.space.md,
              gap: ui.space.xs,
              backgroundColor: colors.surface,
              opacity: loading ? 0.6 : 1,
            },
          ]}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityState={{ disabled: loading }}
          accessibilityLabel={t(
            loading ? 'v2.timeline.loadingMoreHistory' : 'v2.timeline.loadMoreHistory',
          )}
        >
          <ChevronDown size={ui.icon.sm} color={colors.foreground} />
          <Text
            style={[styles.chipStrong, { color: colors.foreground, fontSize: ui.font.xs }]}
          >
            {t(loading ? 'v2.timeline.loadingMoreHistory' : 'v2.timeline.loadMoreHistory')}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    // The SAME hairline the fault band and the playback bar close with, so
    // stacked chrome reads as one unit rather than three unrelated bars.
    borderBottomWidth: 1,
    // Under the fault band (zIndex 10) and the playback bar's dropdown (15),
    // over the body.
    zIndex: 9,
    elevation: 9,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  message: {
    flex: 1,
    fontWeight: '600',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipStrong: {
    fontWeight: '700',
    letterSpacing: 0.3,
  },
})
