/**
 * ClipsStatusNote — the one line the clip surface shows when it has no cards.
 *
 * Presentational and stateless: the DECISION is `resolveClipsStatus`, a pure
 * function with its own tests, and the strings are the `v2.clips.*` vocabulary
 * that until now was reachable only from the parked ribbon.
 *
 * Muted, centred, not a warning. A failure is NOT drawn here — the fault band
 * under the playback bar owns that, with the retry on it (see
 * `clips-status.ts` for why), and this component renders nothing for it.
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import {
  clipsNoteTopPx,
  clipsStatusMessageKey,
  type ClipsStatusKind,
} from '../../../clips/clips-status.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { useTimelineScale } from '../theater/TimelineScaleProvider.js'

export interface ClipsStatusNoteProps {
  readonly status: ClipsStatusKind
  /** The readhead's offset — the row the first card would start on. The note
   *  stands there rather than in the middle of the body; see `clipsNoteTopPx`. */
  readonly indicatorOffsetPx?: number
  /**
   * Interpolation values for the message.
   *
   * Every message this note can render except two is a bare sentence, and the
   * two that are not were rendered through `t(key)` with nothing: the operator
   * read the literal text *"{{source}} non ha potuto rispondere per questo
   * intervallo."* on screen. A placeholder with no value is not a missing
   * detail, it is a sentence that admits the code never supplied one.
   */
  readonly values?: Readonly<Record<string, string | number>>
}

export function ClipsStatusNote({
  status,
  indicatorOffsetPx = 0,
  values,
}: ClipsStatusNoteProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ui = useTimelineScale()

  const key = clipsStatusMessageKey(status, values)
  if (key === null) return null

  return (
    // Inert: the body underneath is still scrollable and scrubbable, and a
    // notice that swallows the gesture reads as a frozen timeline.
    <View
      style={[styles.container, { paddingTop: clipsNoteTopPx(indicatorOffsetPx) }]}
      pointerEvents="none"
    >
      <Text
        style={[styles.label, { color: colors.foregroundMuted, fontSize: ui.font.sm }]}
        accessibilityRole="text"
      >
        {values === undefined ? t(key) : t(key, values)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    // TOP-anchored, not centred: the note stands where the first card would.
    // `paddingTop` is set at the call site from the readhead's offset.
    justifyContent: 'flex-start',
  },
  label: {
    fontWeight: '600',
    textAlign: 'center',
  },
})
