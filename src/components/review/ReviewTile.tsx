/**
 * ReviewTile — the ONE grid tile of the review pages, People and Plates
 * (operator, 2026-10-23: "a common configurable component with the various
 * pieces and the card ratio"). It is the shared `LibraryTile` with the review
 * pages' pieces in fixed places; the page hands it a row's content
 * (`faceReviewTileContent` / `plateReviewTileContent`) and its display choice,
 * and the rules of what renders live in `review-tile.ts`:
 *
 *   • WHEN — the events tile's corner chip (`EventTimeChip`, `formatEventTime`);
 *   • WHERE — the camera, on the image's bottom edge;
 *     each shown or hidden from the page's eye menu (default: the time only);
 *   • HOW SURE — `FaceConfidenceBar` on the image's bottom edge;
 *   • the title (a name, a plate), its badge (a certainty word, a vehicle) and
 *     Confirm under the image — `rows="two"` puts the title on its own row.
 *
 * Tap opens the page's detail (the one assignment path); long-press starts
 * multi-select with this tile selected (`libraryTileLongPress`). In selection
 * mode both gestures toggle membership and Confirm disappears: a mode where
 * some taps select and others write is how an operator assigns the wrong one.
 */
import React, { memo, useMemo } from 'react'
import { Check } from '../../lib/icons.js'
import { useDateLocale } from '../../lib/date-locale.js'
import { mediaImageSource } from '../../data/track-media-uri.js'
import { formatEventTime } from '../../../shared/events/events-time.js'
import { EventTimeChip } from '../events/gallery/TileHero.js'
import { FaceCertaintyBadge } from '../faces/FaceCertaintyBadge.js'
import { FaceConfidenceBar } from '../faces/FaceConfidenceBar.js'
import { Badge } from '../ui/Badge.js'
import { LibraryTile, type LibraryTileAction } from '../ui/LibraryTile.js'
import { libraryTileLongPress } from '../ui/library-grid.js'
import {
  reviewTilePieces,
  sameReviewTileContent,
  type ReviewTileBadge,
  type ReviewTileContent,
  type ReviewTileDisplay,
} from './review-tile.js'

export interface ReviewTileProps {
  readonly content: ReviewTileContent
  /** What the page's eye menu shows (time, camera). Pass a stable object. */
  readonly display: ReviewTileDisplay
  /** Fixed tile width (pt) — identical in every row, the last one included. */
  readonly width: number
  readonly cropUri: string | null
  readonly mediaHeaders: Record<string, string> | undefined
  /** Draw the title row; a page turns it off for a grid row with nothing to say. Default true. */
  readonly info?: boolean
  /** This tile's write is queued or running: dimmed, not tappable. */
  readonly pending: boolean
  readonly selectionMode: boolean
  readonly selected: boolean
  /** Confirm's accessible name (the page's own verb). */
  readonly confirmLabel: string
  readonly onToggleSelect: (id: string) => void
  /** Long-press outside selection mode: enter it with this one selected. */
  readonly onStartSelect: (id: string) => void
  readonly onOpenDetail: (id: string) => void
  /** Accepts the suggestion as displayed. Only offered when `content.confirm`. */
  readonly onConfirm: (id: string) => void
  /** `<prefix>-<id>` is the tile's testID (`face-cell`, `plate-cell`). */
  readonly testIDPrefix: string
}

function areEqual(prev: ReviewTileProps, next: ReviewTileProps): boolean {
  const { content: prevContent, ...prevRest } = prev
  const { content: nextContent, ...nextRest } = next
  const keys = Object.keys(prevRest) as (keyof typeof prevRest)[]
  return (
    sameReviewTileContent(prevContent, nextContent) &&
    Object.keys(nextRest).length === keys.length &&
    keys.every((k) => prevRest[k] === nextRest[k])
  )
}

function TileBadge({ badge }: { readonly badge: ReviewTileBadge }) {
  return badge.kind === 'certainty' ? (
    <FaceCertaintyBadge certainty={badge.certainty} />
  ) : (
    <Badge
      label={badge.label}
      size="sm"
      tone={badge.settled ? 'success' : 'neutral'}
      look={badge.settled ? 'tint' : 'outline'}
    />
  )
}

export const ReviewTile = memo(function ReviewTile({
  content,
  display,
  width,
  cropUri,
  mediaHeaders,
  info = true,
  pending,
  selectionMode,
  selected,
  confirmLabel,
  onToggleSelect,
  onStartSelect,
  onOpenDetail,
  onConfirm,
  testIDPrefix,
}: ReviewTileProps) {
  const locale = useDateLocale()
  // One source object per (uri, headers): a new object on every parent render
  // makes the image view treat it as a new source and blank while it reloads.
  const source = useMemo(
    () => (cropUri === null ? null : mediaImageSource(cropUri, mediaHeaders)),
    [cropUri, mediaHeaders],
  )

  const id = content.id
  const longPress = () => (libraryTileLongPress(selectionMode) === 'toggle' ? onToggleSelect(id) : onStartSelect(id))
  const activate = selectionMode ? () => onToggleSelect(id) : () => onOpenDetail(id)
  const pieces = reviewTilePieces(display, content, formatEventTime(content.timestamp, Date.now(), locale))

  const actions: readonly LibraryTileAction[] = content.confirm
    ? [{ id: 'confirm', icon: Check, label: confirmLabel, tone: 'primary', onPress: () => onConfirm(id) }]
    : []

  return (
    <LibraryTile
      width={width}
      shape={content.shape}
      source={source}
      imageBadges={pieces.timeChip !== undefined ? <EventTimeChip text={pieces.timeChip} /> : undefined}
      where={pieces.where}
      bar={
        content.confidence !== undefined ? (
          <FaceConfidenceBar score={content.confidence.score} certainty={content.confidence.certainty} />
        ) : undefined
      }
      title={content.title}
      titleMuted={content.titleMuted}
      titleMono={content.titleMono}
      badge={content.badge !== undefined ? <TileBadge badge={content.badge} /> : undefined}
      actions={actions}
      rows={content.rows}
      info={info}
      settled={content.settled}
      selectionMode={selectionMode}
      selected={selected}
      pending={pending}
      onPress={activate}
      onLongPress={longPress}
      accessibilityLabel={pieces.accessibilityLabel}
      testID={`${testIDPrefix}-${id}`}
    />
  )
}, areEqual)
