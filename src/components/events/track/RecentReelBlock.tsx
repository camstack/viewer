/**
 * The "Recent" block on the Cameras page: the caption + the reel strip, in a
 * box of a FIXED, pre-computable height.
 *
 * ## Why a component and not two lines of JSX in the screen
 *
 * Three surfaces have to agree on this box to the pixel — the fixed block above
 * the camera list, the cold-launch skeleton (`CamerasGridSkeleton`) and the
 * placeholder shown while there is no connection to load over. When they were
 * three hand-rolled arrangements of the same pieces they did not agree, and the
 * grid moved every time the page changed phase.
 *
 * ## Why the height never changes — including empty and error
 *
 * The block is `reelBlockHeight(cardWidth)` tall whatever the reel has to say:
 * loading, a full strip, nothing in the last 24 h, or a hub that did not
 * answer. It does NOT collapse when the reel is empty. Three reasons, in order
 * of weight:
 *
 *  1. It is a FIXED header. A fixed header whose height changes is a moving
 *     header — the exact defect ("the camera list jumps") the fixed placement
 *     was introduced to fix, just moved to a different trigger.
 *  2. "Empty" is transient and self-clearing. The reel's window is a rolling
 *     24 h, so a quiet night empties it and the next event refills it. A
 *     collapsing block would shove the whole camera grid up and down as events
 *     land — several times a day, unprompted.
 *  3. The error state carries a RETRY control (`TrackReel`'s error band).
 *     Collapsing the block hides the one affordance that fixes the error.
 *
 * The empty case is not silent: `TrackReel` draws its own "no events" copy inside
 * the reserved band, so the space reads as answered rather than broken. The
 * strip has always held a fixed height, and nothing in this app animates a
 * layout collapse.
 */
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { ReelStripSkeleton } from './ReelStripSkeleton.js'
import { TrackReel } from './TrackReel.js'
import {
  RECENT_REEL_TEST_ID,
  REEL_BLOCK_PADDING_BOTTOM,
  REEL_CAPTION_TEST_ID,
  REEL_BLOCK_PADDING_TOP,
  REEL_CAPTION_LINE_HEIGHT,
  REEL_CAPTION_PADDING_BOTTOM,
  reelBlockHeight,
} from './reel-layout.js'
import type { TrackSummary } from '../../../data/track-events.js'
import { reelFilterCondition, useReelFilterStore } from '../../../store/reel-filter-store.js'

interface RecentReelBlockProps {
  /** Card edge (px) — the user's reel-size preference. */
  readonly cardWidth: number
  /**
   * Mount the live strip. `false` holds the same box with the placeholder in
   * it — used while the hub connection is still dialling or down, and by the
   * cold-launch skeleton, which has no connection context at all.
   */
  readonly live: boolean
  /** Seek the camera the track belongs to, from the track detail. */
  readonly onSeek?: (track: TrackSummary, epochMs: number) => void
}

export function RecentReelBlock({ cardWidth, live, onSeek }: RecentReelBlockProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  /**
   * The strip's condition, in the caption that is ALWAYS on screen.
   *
   * The fan menu carries it too, but a speed-dial is closed almost all of the
   * time and a closed control explains nothing. The caption sits directly
   * above the rows it is describing, which is where "this is shorter than
   * reality" has to be readable. It costs no height: the caption line is
   * already reserved (`REEL_CAPTION_LINE_HEIGHT`) and this only changes its
   * text, so the fixed block height is untouched.
   *
   * `default` is reported as a narrowing, not as "Recent" — it hides audio and
   * sensor markers.
   */
  const condition = reelFilterCondition(useReelFilterStore((s) => s.filter))
  const recent = t('v2.tracks.recent', 'Recent')
  const caption =
    condition.kind === 'all'
      ? recent
      : `${recent} · ${
          condition.kind === 'default'
            ? t('v2.cameras.reelFilterDefaultTag', 'Detections')
            : t('v2.cameras.reelFilterCountTag', '{{count}} types', { count: condition.count })
        }`

  return (
    <View testID={RECENT_REEL_TEST_ID} style={[styles.block, { height: reelBlockHeight(cardWidth) }]}>
      <Text
        testID={REEL_CAPTION_TEST_ID}
        numberOfLines={1}
        style={[styles.caption, { color: colors.foregroundSubtle }]}
      >
        {caption}
      </Text>
      {!live ? (
        <ReelStripSkeleton cardWidth={cardWidth} />
      ) : (
        <TrackReel cardWidth={cardWidth} onSeek={onSeek} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  block: {
    paddingTop: REEL_BLOCK_PADDING_TOP,
    paddingBottom: REEL_BLOCK_PADDING_BOTTOM,
    // The strip scrolls edge to edge; only the caption is inset. `overflow`
    // keeps a mis-measured strip from painting over the first camera row.
    overflow: 'hidden',
  },
  caption: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    // Explicit, so the reserved block height is the same on every platform —
    // see REEL_CAPTION_LINE_HEIGHT.
    lineHeight: REEL_CAPTION_LINE_HEIGHT,
    paddingHorizontal: SPACING.xl,
    paddingBottom: REEL_CAPTION_PADDING_BOTTOM,
  },
})
