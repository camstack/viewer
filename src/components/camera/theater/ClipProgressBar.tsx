/**
 * ClipProgressBar — WHERE inside the held file the picture is, and the drag
 * that moves it.
 *
 * The second row of the playback band while a clip holds the frame. It is
 * not the timeline's scrub: that drag browses the clip LIST (which is how the
 * next clip is found — `clips-surface.ts`), and this one seeks INSIDE the
 * file on the file's own axis (`clip-progress.ts`). Two gestures, two
 * controls, and the timeline's `scrub` verdict is left exactly as it is.
 *
 * What it draws is what it KNOWS. A position before the first report is a
 * dash, a length the broker has not measured (and the catalog cannot vouch
 * for) is drawn as unknown — an empty track with no fill and no drag, never
 * a fill of 0 %, which would say the file is empty (D393). The drag needs a
 * known length to turn a fraction into milliseconds, so it is offered only
 * then.
 *
 * Laid out by the band, like every control on it (`docked-timeline-chrome`):
 * a row with its own height, no absolute layer, no anchor to anything else.
 */
import React, { useMemo, useState } from 'react'
import { PanResponder, StyleSheet, Text, View } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Lock } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { TABULAR } from '../../../theme/tokens.js'
import { useTimelineScale } from './TimelineScaleProvider.js'
import { clampFraction, clipOffsetAtFraction, fractionAtX } from '../../../clips/clip-progress.js'
import {
  clipControlDisabled,
  clipScrubAllowed,
  clipSeekFloorFraction,
} from '../../../clips/clip-controls.js'
import type { ClipProgressBinding } from '../../../clips/clip-progress.js'
import { formatSelectionDuration } from '../../../recording/export-selection.js'

export const CLIP_PROGRESS_TEST_ID = 'clip-progress-track'

/**
 * The stretch of the track a FORWARD-ONLY clip can no longer reach.
 *
 * Its own testID because on react-native-web the dimming that separates it
 * from the rail lives in a generated class name no mount test can read — the
 * same reason `HEATMAP_UNKNOWN_TEST_ID` exists.
 */
export const CLIP_PROGRESS_SPENT_TEST_ID = 'clip-progress-spent'

/**
 * The padlock at the end of a track this camera does not serve a scrub for.
 *
 * It exists because the DIMMING alone is not a reason, and because
 * `accessibilityState`/`accessibilityHint` on a plain View reach neither the
 * operator nor a mount test — react-native-web emits them only for a
 * focusable element (measured 2026-09-23, the same class of gap
 * `HEATMAP_UNKNOWN_TEST_ID` exists for). The glyph carries the sentence as its
 * `accessibilityLabel`, so the reason is drawn, readable and assertable.
 */
export const CLIP_PROGRESS_NO_SCRUB_TEST_ID = 'clip-progress-no-scrub'

/** What an unknown reads as, on either side of the track. */
const UNKNOWN_CLOCK = '–:––'

interface Drag {
  readonly startFraction: number
  readonly fraction: number
}

export function ClipProgressBar({ progress, controls, onSeekBegin, onSeekMove, onSeekCommit }: ClipProgressBinding) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ui = useTimelineScale()
  const [trackWidth, setTrackWidth] = useState(0)
  const [drag, setDrag] = useState<Drag | null>(null)
  const duration = progress.duration.ms

  /**
   * The hub says this camera's clips are not SCRUBBED at all (D612) — the
   * bytes arrive as a forward-only stream and there is nothing to drag
   * through. The track is still drawn, and still reports where the picture is:
   * a bar that vanished would say the app cannot show a clip's position, when
   * what is true is that this camera cannot be dragged along it (D62).
   *
   * Only on a `present` answer. A read that has not landed claims nothing, and
   * a track locked on a pending query is a UI asserting an absence it was
   * never told (D315).
   */
  const scrubDisabled = clipControlDisabled(controls, clipScrubAllowed(controls.controls))
  const seekable = duration !== null && trackWidth > 0 && !scrubDisabled
  /**
   * The lowest fraction the finger may reach.
   *
   * On a clip arriving over the provider's forward-only stream the bytes
   * behind the head were never kept (`clip-controls.ts`, D602), so the track
   * BEHIND the picture is spent: it is drawn as spent and the drag stops
   * there. The alternative is what shipped — the gesture is taken, the commit
   * is refused and the knob snaps forward under the finger, which reads as a
   * broken control rather than an unavailable one (D62).
   *
   * Zero whenever the clip is freely seekable, and zero while the position is
   * unknown: a floor derived from nothing would lock the whole track.
   */
  const floor = clipSeekFloorFraction(controls.controls, progress.fraction)

  // STATE, not refs: the handlers close over the width, the length and the
  // drag in flight, and are rebuilt when any of them changes. That is safe
  // mid-gesture — the responder system reads the handlers from the view's
  // CURRENT props at every event — and it is the shape the compiler accepts.
  const responder = useMemo(
    () =>
      PanResponder.create({
        // Only a track with a KNOWN length can turn a finger into a position.
        onStartShouldSetPanResponder: () => seekable,
        onMoveShouldSetPanResponder: () => seekable,
        onPanResponderGrant: (evt) => {
          if (duration === null) return
          const fraction = Math.max(floor, fractionAtX(evt.nativeEvent.locationX, trackWidth))
          setDrag({ startFraction: fraction, fraction })
          onSeekBegin()
          onSeekMove(clipOffsetAtFraction(fraction, duration))
        },
        onPanResponderMove: (_evt, gesture) => {
          if (drag === null || trackWidth <= 0 || duration === null) return
          // Relative to where the finger landed: the track's page offset is
          // not known here, and `dx` needs no measure.
          const fraction = Math.max(floor, clampFraction(drag.startFraction + gesture.dx / trackWidth))
          setDrag({ startFraction: drag.startFraction, fraction })
          onSeekMove(clipOffsetAtFraction(fraction, duration))
        },
        onPanResponderRelease: () => {
          setDrag(null)
          if (drag === null || duration === null) return
          onSeekCommit(clipOffsetAtFraction(drag.fraction, duration))
        },
        onPanResponderTerminate: () => {
          // The gesture was taken away (a scroll won). The picture is left
          // where the last preview put it, which is what the timeline's own
          // scrub does when it loses its gesture — committed, so the pointer
          // and the track agree on where that is.
          setDrag(null)
          if (drag === null || duration === null) return
          onSeekCommit(clipOffsetAtFraction(drag.fraction, duration))
        },
      }),
    [duration, trackWidth, drag, floor, seekable, onSeekBegin, onSeekMove, onSeekCommit],
  )

  const onTrackLayout = (e: LayoutChangeEvent): void => {
    setTrackWidth(e.nativeEvent.layout.width)
  }

  // While the finger is down the track shows the FINGER, not the last report:
  // the report lags the drag by design, and a fill that fights the finger
  // reads as a control that does not work.
  const fraction = drag !== null ? drag.fraction : progress.fraction
  const shownPositionMs =
    drag !== null && duration !== null ? clipOffsetAtFraction(drag.fraction, duration) : progress.positionMs
  const positionLabel = shownPositionMs === null ? UNKNOWN_CLOCK : formatSelectionDuration(shownPositionMs)
  const durationLabel = duration === null ? t('v2.clips.lengthUnknown') : formatSelectionDuration(duration)

  return (
    <View
      style={[styles.row, { paddingHorizontal: ui.space.md, paddingBottom: ui.space.sm, gap: ui.space.sm }]}
      accessibilityRole="adjustable"
      accessibilityLabel={t('v2.clips.progressLabel', { position: positionLabel, duration: durationLabel })}
      accessibilityState={{ disabled: !seekable }}
      {...(scrubDisabled ? { accessibilityHint: t('v2.clips.scrubUnavailable') } : {})}
    >
      <Text style={[styles.clock, TABULAR, { color: colors.foreground, fontSize: ui.font.xs }]}>
        {positionLabel}
      </Text>
      <View
        testID={CLIP_PROGRESS_TEST_ID}
        onLayout={onTrackLayout}
        // The whole track height is the hit area; the drawn bar is thinner.
        // Visibly inert when the camera does not serve a scrub: it still says
        // where the picture is, and it no longer invites a drag it would have
        // to undo.
        style={[styles.track, { height: ui.control.button }, scrubDisabled ? styles.notScrubbable : null]}
        {...responder.panHandlers}
      >
        <View
          style={[
            styles.rail,
            {
              backgroundColor: colors.surfaceHover,
              borderColor: colors.border,
              height: ui.px(6),
              borderRadius: ui.px(3),
            },
          ]}
        >
          {fraction !== null ? (
            <View
              style={[
                styles.fill,
                { width: `${Math.round(fraction * 1000) / 10}%`, backgroundColor: colors.primary, borderRadius: ui.px(3) },
              ]}
            />
          ) : null}
          {/* OVER the fill, never under it: on a forward-only clip the spent
              stretch and the played stretch are the same stretch, so a band
              drawn beneath would be hidden by the primary fill it is meant to
              qualify. Muted over the fill is what says "played, and no longer
              reachable" — the drag stops here too, so the gesture and the
              picture agree. */}
          {floor > 0 ? (
            <View
              testID={CLIP_PROGRESS_SPENT_TEST_ID}
              pointerEvents="none"
              style={[
                styles.spent,
                {
                  width: `${Math.round(floor * 1000) / 10}%`,
                  backgroundColor: colors.foregroundMuted,
                  borderRadius: ui.px(3),
                  opacity: 0.55,
                },
              ]}
            />
          ) : null}
        </View>
        {fraction !== null ? (
          <View
            pointerEvents="none"
            style={[
              styles.knobRow,
              // The knob rides the fill's end. A margin, not an absolute
              // offset from the track: the row is laid out by flex.
              { paddingLeft: `${Math.round(fraction * 1000) / 10}%` },
            ]}
          >
            <View
              style={[
                styles.knob,
                {
                  width: ui.px(14),
                  height: ui.px(14),
                  borderRadius: ui.px(7),
                  marginLeft: -ui.px(7),
                  backgroundColor: drag !== null ? colors.primary : colors.background,
                  borderColor: colors.primary,
                },
              ]}
            />
          </View>
        ) : null}
      </View>
      <Text
        style={[
          styles.clock,
          TABULAR,
          { color: duration === null ? colors.foregroundMuted : colors.foreground, fontSize: ui.font.xs },
        ]}
      >
        {durationLabel}
      </Text>
      {scrubDisabled ? (
        // The glyph is WRAPPED because the icon component forwards neither a
        // testID nor an accessibility label to its svg — the label would reach
        // nobody and no mount test could read it.
        <View
          testID={CLIP_PROGRESS_NO_SCRUB_TEST_ID}
          accessibilityRole="text"
          accessibilityLabel={t('v2.clips.scrubUnavailable')}
          style={styles.lock}
        >
          <Lock size={ui.px(13)} color={colors.foregroundMuted} />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clock: {
    fontWeight: '700',
    letterSpacing: 0.3,
    flexShrink: 0,
  },
  track: {
    flex: 1,
    justifyContent: 'center',
  },
  /** A track that reports a position and takes no gesture. */
  notScrubbable: { opacity: 0.5 },
  lock: { flexShrink: 0 },
  rail: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
  // ABSOLUTE, unlike the fill: the rail lays its children out in a column, so
  // a second in-flow band would be pushed below the first and clipped away by
  // `overflow: hidden` — visible in no test and in no screenshot.
  spent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  knobRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  knob: {
    borderWidth: 2,
  },
})
