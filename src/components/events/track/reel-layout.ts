/**
 * The reel's SHARED shape: its props and its row-height contract.
 *
 * The module is a leaf on purpose: the height contract is what the
 * CamerasScreen reserves before the strip has painted anything, so it must be
 * computable without importing the renderer (`TrackReel`).
 */
import { SPACING } from '../../../theme/tokens.js'
import type { TrackSummary } from '../../../data/track-events.js'

export interface TrackReelProps {
  /** Restrict the reel to one camera; omit for all cameras. */
  readonly deviceId?: number
  /** Card width (px). Square tiles, so this is also the hero height. Default 80
   *  (the compact preset); callers pass the user's reel-size preference. */
  readonly cardWidth?: number
  /** Seek the owning surface (e.g. the camera timeline) to the track. */
  readonly onSeek?: (track: TrackSummary, epochMs: number) => void
}

/**
 * Height of one LOADED reel row for a given card width. Used to size the
 * loading / empty placeholders — and the strip — so swapping in real content
 * causes no layout jump. Sum of:
 *   - `cardWidth`      — square hero (time and labels overlay the image)
 *   - `SPACING.sm * 2` — FlashList contentContainer paddingVertical
 */
export function reelRowHeight(cardWidth: number): number {
  return cardWidth + SPACING.sm * 2
}

// ── Reel BLOCK height contract ───────────────────────────────────────────────
// `reelRowHeight` describes the strip alone. What the Cameras page reserves is
// the whole block: a caption line ("RECENT"), the strip, and the padding that
// separates both from the header above and the grid below. Reserving only the
// strip still lets the page jump by the caption's height the moment the reel
// appears, which is precisely the bounce the block height exists to stop.
//
// THREE surfaces size off this and they must agree exactly: the fixed block on
// the Cameras page, the cold-launch skeleton, and the not-connected
// placeholder. Hence one function, here.
/** Space above the caption. Mirrors the camera list's own top padding, so the
 *  block sits where the old list header used to. */
export const REEL_BLOCK_PADDING_TOP = SPACING.md
/**
 * The caption's EXPLICIT line height.
 *
 * Not optional: `fontSize: 11` alone resolves to a different line box on iOS,
 * on Android and in a browser, so a block reserved against one of them is
 * wrong on the other two — and being wrong by 2 px is still a jump.
 */
export const REEL_CAPTION_LINE_HEIGHT = 14
/** Gap between the caption and the strip. */
export const REEL_CAPTION_PADDING_BOTTOM = SPACING.xs
/** Space below the strip, before the camera grid starts scrolling under it. */
export const REEL_BLOCK_PADDING_BOTTOM = SPACING.sm

/**
 * Marker on the reserved block, so its PLACEMENT is assertable in the DOM
 * rather than by reading JSX — see `screens/cameras-reel-placement.ts` for the
 * rule it exists to pin. `testID` reaches the web as `data-testid` and is inert
 * on a device.
 */
export const RECENT_REEL_TEST_ID = 'cameras-recent-reel'

/**
 * Marker on the dot the collapsed Cameras FAB draws when the reel is NARROWED.
 *
 * A closed speed-dial shows nothing, so without this the one bit of state that
 * changes what the strip contains would be invisible until the operator
 * happened to open the menu — the quiet short list this whole change set is
 * about. Its ABSENCE is the assertion that matters, which is why it is a node
 * and not a style.
 */
export const REEL_FILTER_DOT_TEST_ID = 'cameras-reel-filter-dot'

/** Marker on the reel's caption, which carries the active filter condition —
 *  the always-visible half of the pair above. */
export const REEL_CAPTION_TEST_ID = 'cameras-recent-reel-caption'

/**
 * Height of the whole "Recent" block on the Cameras page, loaded or not.
 *
 * Constant for a given card width by construction: every term is either a
 * layout constant or `reelRowHeight`, and NOTHING here depends on how many
 * tracks came back — an empty reel, a failed reel and a full reel are all
 * exactly this tall. See `RecentReelBlock` for why that is the chosen
 * behaviour rather than a collapse.
 */
export function reelBlockHeight(cardWidth: number): number {
  return (
    REEL_BLOCK_PADDING_TOP +
    REEL_CAPTION_LINE_HEIGHT +
    REEL_CAPTION_PADDING_BOTTOM +
    reelRowHeight(cardWidth) +
    REEL_BLOCK_PADDING_BOTTOM
  )
}
