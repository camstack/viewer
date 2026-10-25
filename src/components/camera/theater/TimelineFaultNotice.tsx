/**
 * TimelineFaultNotice — the ONE place the theater says something did not load.
 *
 * ## Why one component and not three
 *
 * The screen used to answer that question in two grammars and stay silent on a
 * third. The stream's failure was a red reason string plus a retry chip stuffed
 * into the playback band's trailing slot, where it displaced the speed
 * selector; the events query's failure was a red-bordered card floating over
 * the scroller, whose border read to the operator as a stray red line under the
 * cards; a recordings-coverage failure produced nothing at all and was
 * indistinguishable from a camera with no footage.
 *
 * So the notice is a BAND, docked immediately under the playback bar, and it is
 * the same band whatever failed. It is drawn as the bar's second row — same
 * scale tokens, same chip shapes, same bottom hairline — because the operator
 * asked for one thing, not for three things that happen to be adjacent.
 *
 * ## Why it takes space instead of floating
 *
 * The old card floated so it would not hide the stale cards it was describing.
 * That is the right instinct for something drawn OVER a list and the wrong one
 * for chrome: floating chrome has to guess at the room above it, which is the
 * exact mistake `TimelinePlaybackBar` was created to stop making. Laid out by
 * the column it owns its height, and the scroller simply gets what is left.
 *
 * ## Reach
 *
 * The camera-detail screen lays a full-bleed gesture layer over the video, so a
 * control drawn on the picture is visible and inert (the operator's "pulsante
 * non cliccabile"). This band is chrome, outside that layer — its retry and
 * dismiss buttons actually respond, which is the whole reason the stream fault
 * was pulled onto the bar in the first place.
 *
 * Presentational: the parent owns the fault list, the retry and the dismissal.
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { RefreshCw, TriangleAlert, X } from '../../../lib/icons.js'
import { hapticTap } from '../../../lib/haptics.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { useTimelineScale } from './TimelineScaleProvider.js'
import type { FaultSource, TimelineFault } from './timeline-faults.js'

export interface TimelineFaultNoticeProps {
  /** Already resolved and ordered by `resolveTimelineFaults`. Empty ⟹ nothing
   *  renders, not even the band. */
  readonly faults: readonly TimelineFault[]
  readonly onRetry: (source: FaultSource) => void
  readonly onDismiss: (source: FaultSource) => void
}

/** The generic message per source, used when the subsystem gave no reason. */
const MESSAGE_KEY: Readonly<Record<FaultSource, string>> = {
  stream: 'v2.timeline.faultStream',
  recordings: 'v2.timeline.faultRecordings',
  events: 'v2.timeline.faultEvents',
}

export function TimelineFaultNotice({
  faults,
  onRetry,
  onDismiss,
}: TimelineFaultNoticeProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ui = useTimelineScale()

  // A healthy timeline shows NO band. The old events notice earned its keep by
  // staying silent on a day that was merely empty, and that property is the
  // reason this one is worth reading at all.
  if (faults.length === 0) return null

  const chip = {
    height: ui.control.button,
    borderRadius: ui.radius.lg,
    paddingHorizontal: ui.space.md,
    gap: ui.space.xs,
  }

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, borderBottomColor: colors.border },
      ]}
      accessibilityRole="alert"
    >
      {faults.map((fault) => {
        const retrying = fault.phase === 'retrying'
        // The subsystem's own words when it had any — an error with no text
        // reads as a UI glitch rather than as a stream that is down.
        const message = fault.reason ?? t(MESSAGE_KEY[fault.source])
        return (
          <View
            key={fault.source}
            style={[
              styles.row,
              { paddingHorizontal: ui.space.md, paddingVertical: ui.space.sm, gap: ui.space.sm },
            ]}
          >
            <TriangleAlert size={ui.icon.sm} color={colors.danger} />
            <Text
              numberOfLines={1}
              style={[styles.message, { color: colors.foreground, fontSize: ui.font.xs }]}
            >
              {message}
            </Text>
            <Pressable
              onPress={() => {
                hapticTap()
                onRetry(fault.source)
              }}
              // A second press while the first attempt runs would only cancel
              // and restart it, which looks like the button doing nothing.
              disabled={retrying}
              style={[
                styles.chip,
                chip,
                { backgroundColor: colors.danger, opacity: retrying ? 0.6 : 1 },
              ]}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityState={{ disabled: retrying }}
              accessibilityLabel={`${t('v2.timeline.loadRetry')} — ${message}`}
            >
              <RefreshCw size={ui.icon.sm} color={colors.primaryForeground} />
              <Text
                style={[
                  styles.chipStrong,
                  { color: colors.primaryForeground, fontSize: ui.font.xs },
                ]}
              >
                {retrying ? t('v2.timeline.loadRetrying') : t('v2.timeline.loadRetry')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                hapticTap()
                onDismiss(fault.source)
              }}
              style={[styles.chip, { width: ui.control.button, height: ui.control.button }]}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`${t('v2.timeline.faultDismiss')} — ${message}`}
            >
              <X size={ui.icon.sm} color={colors.foregroundMuted} />
            </Pressable>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    // The SAME hairline the playback bar closes with, so the two read as one
    // stack of chrome rather than as a band with a red line under it.
    borderBottomWidth: 1,
    // Under the playback bar's speed dropdown (zIndex 15), over the body.
    zIndex: 10,
    elevation: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  /** Shrinkable, so the retry is never squeezed out by a long reason. */
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
