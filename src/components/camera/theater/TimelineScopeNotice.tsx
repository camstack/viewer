/**
 * TimelineScopeNotice — the line that says the timeline is drawing fewer
 * cameras than the view holds.
 *
 * The reason this exists is the reason the hub tags every batch row: fused into
 * a union, a camera nobody could read looks exactly like a camera that was
 * quiet. The heatmap grows a dashed rail and the calendar grows a `partial`
 * line, but neither can say HOW MANY cameras or WHY — and "why" splits into two
 * causes with opposite remedies (`timeline-scope-notice.ts`).
 *
 * Docked in the same chrome slot as `TimelineHistoryNotice`, and deliberately
 * NOT `TimelineFaultNotice`: nothing rejected and there is nothing to retry.
 * Borrowing the red grammar for an ordinary partial answer is exactly the
 * "two different situations, one visual language" defect `timeline-faults.ts`
 * was written to remove.
 *
 * Presentational only — the sentence is chosen by the pure rule.
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useTheme } from '../../../theme/theme-provider.js'
import { useTimelineScale } from './TimelineScaleProvider.js'
import { resolveScopeNotice, type ScopeNoticeInput } from './timeline-scope-notice.js'

/** The notice's root. Its own testID: this claim is "the surface SAID it is
 *  incomplete", and on react-native-web nothing else in the DOM distinguishes
 *  one muted line from another. */
export const TIMELINE_SCOPE_NOTICE_TEST_ID = 'timeline-scope-notice'

export type TimelineScopeNoticeProps = ScopeNoticeInput

export function TimelineScopeNotice(
  props: TimelineScopeNoticeProps,
): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ui = useTimelineScale()
  const notice = resolveScopeNotice(props)

  // A complete read draws NOTHING. A notice that shows on the common case is a
  // notice the operator stops reading.
  if (notice.kind === 'none') return null

  const message =
    notice.kind === 'overflow'
      ? t('v2.timeline.scopeOverflow', { count: notice.overflowCount })
      : notice.kind === 'both'
        ? t('v2.timeline.scopeUnreadableAndOverflow', {
            unreadable: notice.unreadableCount,
            overflow: notice.overflowCount,
          })
        : t('v2.timeline.scopeUnreadable', { count: notice.unreadableCount })

  return (
    <View
      testID={TIMELINE_SCOPE_NOTICE_TEST_ID}
      style={[
        styles.container,
        { backgroundColor: colors.background, borderBottomColor: colors.border },
      ]}
    >
      <Text
        numberOfLines={2}
        style={[
          styles.message,
          {
            color: colors.foregroundMuted,
            fontSize: ui.font.xs,
            paddingHorizontal: ui.space.md,
            paddingVertical: ui.space.sm,
          },
        ]}
      >
        {message}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    // The same hairline the fault band, the history notice and the playback bar
    // close with, so stacked chrome reads as one unit.
    borderBottomWidth: 1,
    // Under the fault band (10) and the playback bar's dropdown (15), and under
    // the history notice (9) — a partial read is the mildest of the three.
    zIndex: 8,
    elevation: 8,
  },
  message: {
    fontWeight: '600',
  },
})
