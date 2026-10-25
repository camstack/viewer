/**
 * ClipRowProgress — the running clip's own progress, ON the row.
 *
 * > *"quando una clip gira, si deve evidenziare, e mostrarne il progresso
 * > sulla stessa"* — the operator, 2026-09-23.
 *
 * A strip along the bottom edge of the card, drawn ONLY for the row that is
 * playing (`clip-row-playback.ts` decides which; a row with no state renders
 * nothing at all, so a still list is pixel-for-pixel what it was).
 *
 * The DRAWING is `ProgressStrip` — shared with the clip-export modal — because
 * the unknown arm is the one that goes missing when two surfaces each own a
 * bar. All this file contributes is the card's geometry: pinned to the bottom
 * edge, over the overlay, three pixels tall.
 */

import React from 'react'
import { StyleSheet, View } from 'react-native'
import type { ClipRowPlayback } from '../../../clips/clip-row-playback.js'
import { useTheme } from '../../../theme/theme-provider.js'
import {
  PROGRESS_STRIP_FILL_TEST_ID,
  PROGRESS_STRIP_SWEEP_TEST_ID,
  ProgressStrip,
} from '../../ui/ProgressStrip.js'

/** The filled part of a KNOWN bar. Aliases the shared strip's id — one element. */
export const CLIP_ROW_PROGRESS_FILL_TEST_ID = PROGRESS_STRIP_FILL_TEST_ID
/** The sweeping segment of an UNKNOWN (indeterminate) bar. */
export const CLIP_ROW_PROGRESS_SWEEP_TEST_ID = PROGRESS_STRIP_SWEEP_TEST_ID

const ROW_STRIP_HEIGHT = 3

export interface ClipRowProgressProps {
  readonly playback: ClipRowPlayback
  /** The card's width, so the sweep can translate in px on the native driver. */
  readonly width: number
}

export function ClipRowProgress({ playback, width }: ClipRowProgressProps): React.ReactElement {
  const { colors } = useTheme()
  return (
    <View pointerEvents="none" style={styles.anchor}>
      <ProgressStrip
        progress={playback.progress}
        width={width}
        color={colors.primary}
        trackColor={colors.background}
        height={ROW_STRIP_HEIGHT}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
})
