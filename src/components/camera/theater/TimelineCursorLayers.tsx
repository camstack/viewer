/**
 * TimelineCursorLayers — the two things drawn AT the cursor's row.
 *
 * They are two layers, not one component, because they sit on opposite sides
 * of the cluster cards: the LINE (with the dot that marks its time at the left
 * end, just past the label column) UNDER them — a reference mark drawn over the
 * cards sliced every one it crossed (operator, 2026-08-02) — and the lane
 * crossing DOTS above them. `TimelineView` places both; the colour is
 * `timeline-cursor.ts`'s single verdict. (A readout pill used to sit in the
 * label column; the operator replaced it with the dot, 2026-10-17.)
 *
 * ## Both layers speak the EPOCH axis only (2026-09-23)
 *
 * For one release the pair had a third arm: while a native file held the
 * frame the line drew the clip's fraction as a strip and a pill read the
 * file's clock, doubling as the control that re-hooked the scroll follow. The
 * strip came off first — *"il progresso sulla clip adesso e' mostrato sia sul
 * cursore che sulla clip, toglilo dal cursore"* — and then the rest of it:
 * *"Rimuoviamo decisamente il cursore per la modalità clip e l'hook dello
 * scroll, anche verso il live, non deve fare alcuna azione"*.
 *
 * So there is no clip arm to draw and no press to take. Over a held file the
 * cursor is not rendered at all (`clips-surface.ts`, `playhead: false`); the
 * file's progress is the running ROW's own strip (`ClipRowProgress`) and its
 * seekable position is `ClipProgressBar` in the transport band. Both layers
 * here are `pointerEvents="none"` and neither has a knob — the cursor is not,
 * and is not to become, a control (D62).
 */
import React from 'react'
import { StyleSheet, View } from 'react-native'

import { useTheme } from '../../../theme/theme-provider.js'
import type { TimelineCursor } from './timeline-cursor.js'
import { laneColor, visibleLanes } from './TimelineLaneHeader.js'
import {
  CURSOR_LINE_START_PX,
  CURSOR_ORIGIN_DOT_PX,
  LANE_DOT_PX,
  laneCentreFromRight,
  type LaneKey,
} from './timeline-lanes-layout.js'

/** The hairline's weight. */
export const CURSOR_LINE_HEIGHT = 1.5

/** The line. ONE drawing on both arms — see the header. */
export const CURSOR_LINE_TEST_ID = 'timeline-cursor-line'
/** The dot that marks the cursor's time at the line's left end. */
export const CURSOR_ORIGIN_DOT_TEST_ID = 'timeline-cursor-origin-dot'
/** The soft dot where the cursor crosses a lane. */
export const CURSOR_LANE_DOT_TEST_ID = 'timeline-cursor-lane-dot'

/** Size of the crossing dot (px) — a little larger than a detection dot. */
const CROSSING_DOT_PX = LANE_DOT_PX + 3
/** How faint it is: a hint of where the line meets the lane, not a mark. */
const CROSSING_DOT_OPACITY = 0.4

export interface TimelineCursorLineProps {
  readonly cursor: TimelineCursor
}

export function TimelineCursorLine({ cursor }: TimelineCursorLineProps): React.JSX.Element {
  const { colors } = useTheme()
  // `live` is the only accent that is not the recorded red.
  const color = cursor.kind === 'live' ? colors.live : colors.danger
  return (
    <>
      <View testID={CURSOR_LINE_TEST_ID} style={[styles.line, { backgroundColor: color }]} />
      {/* The time marker: a dot at the line's left end, just past the label
          column. It replaced a 74 pt readout pill that sat IN the label column. */}
      <View testID={CURSOR_ORIGIN_DOT_TEST_ID} style={[styles.originDot, { backgroundColor: color }]} />
    </>
  )
}

export interface TimelineCursorLaneDotsProps {
  readonly showAudio: boolean
  readonly showMotion: boolean
  /** Only these lanes get a dot — see `lanesActiveAt`. */
  readonly hits: readonly LaneKey[]
}

/**
 * A soft dot on each lane at the cursor's row. Static: it moves only with the
 * row it is laid into (the indicator's own offset and shift), so it costs no
 * per-frame render.
 */
export function TimelineCursorLaneDots({
  showAudio,
  showMotion,
  hits,
}: TimelineCursorLaneDotsProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <>
      {visibleLanes(showAudio, showMotion)
        .filter((lane) => hits.includes(lane))
        .map((lane) => (
        <View
          key={lane}
          testID={CURSOR_LANE_DOT_TEST_ID}
          pointerEvents="none"
          style={[
            styles.laneDot,
            {
              right: laneCentreFromRight(lane) - CROSSING_DOT_PX / 2,
              backgroundColor: laneColor(lane, colors),
              opacity: CROSSING_DOT_OPACITY,
            },
          ]}
        />
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  line: {
    position: 'absolute',
    // After the label column — see `timeline-lanes-layout.ts`.
    left: CURSOR_LINE_START_PX,
    right: 0,
    height: CURSOR_LINE_HEIGHT,
  },
  originDot: {
    position: 'absolute',
    left: CURSOR_LINE_START_PX,
    top: -CURSOR_ORIGIN_DOT_PX / 2,
    width: CURSOR_ORIGIN_DOT_PX,
    height: CURSOR_ORIGIN_DOT_PX,
    borderRadius: CURSOR_ORIGIN_DOT_PX / 2,
  },
  laneDot: {
    position: 'absolute',
    top: -CROSSING_DOT_PX / 2,
    width: CROSSING_DOT_PX,
    height: CROSSING_DOT_PX,
    borderRadius: CROSSING_DOT_PX / 2,
  },
})
