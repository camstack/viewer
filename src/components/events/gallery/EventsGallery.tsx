/**
 * EventsGallery — the events page's grid, native: a virtualised, uniform square
 * grid of tracks (2 px gaps, day headers), drawn from `useEventsGalleryFeed`.
 * The same component runs on iOS, Android and the web build (react-native-web).
 *
 * It owns presentation only. WHAT is loaded (paging, delta, window, filters,
 * search) is the feed hook's, and what a tile says is `tile-model`'s; this file
 * lays the rows out, authenticates the pictures and handles the tail (loading,
 * end, ceiling, error, empty) and the pull gesture.
 *
 * One list item is one grid ROW (see `events-gallery-layout`), so item heights
 * are known up front and a density change re-chunks instead of re-measuring.
 */
import React, { memo, useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  PixelRatio,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native'
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list'
import { useTranslation } from 'react-i18next'

import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING, TABULAR, TYPOGRAPHY } from '../../../theme/tokens.js'
import { useThumbAuth } from '../../../data/use-thumb-auth.js'
import { useDateLocale } from '../../../lib/date-locale.js'
import type { EventsGalleryFeed } from '../../../data/use-events-gallery-feed.js'
import { eventsDayLabel } from '../../../screens/events/events-day-label.js'
import { buildTrackThumbUrl } from '../../../../shared/events/events-media-url.js'
import { pullIntentFor } from '../../../../shared/events/events-feed.js'
import type { EventsTrackRow } from '../../../../shared/events/events-track-row.js'
import { buildKindLabels } from '../../../../shared/events/events-taxonomy.js'
import { useEventKindLabels } from '../../../data/use-event-kind-labels.js'
import { EventTile } from './EventTile.js'
import {
  buildGalleryItems,
  GALLERY_GAP,
  GALLERY_HEADER_HEIGHT,
  galleryItemHeight,
  tileDetailsHeight,
  tileEdgeFor,
  thumbPxForEdge,
  type GalleryHeaderItem,
  type GalleryItem,
  type GalleryRowItem,
  type TileDetails,
} from './events-gallery-layout.js'
import type { TileChipOptions } from './tile-model.js'
import {
  galleryColumns,
  galleryDeviceClass,
  type GridDensity,
  type TileLabelMode,
} from '../../../store/settings-store.js'
import { useViewportSize } from '../../../hooks/use-viewport-size.js'
import { useScreenMinSide } from '../../../hooks/use-responsive.js'
import { useBottomNavInset, useTabScrollPadding } from '../../../navigation/bottom-nav-inset.js'
import { EmptyState, ErrorState } from '../../ui/EmptyState.js'
import { Inbox, SearchX } from '../../../lib/icons.js'

export interface EventsGalleryProps {
  readonly feed: EventsGalleryFeed
  /** The tile-size preset; the column count follows from it and the measured width. */
  readonly density: GridDensity
  /** The page's "now", seeded once — day headers and times are relative to it. */
  readonly anchorMs: number
  readonly dayOffset: number
  /** A filter or a search is narrowing the list — the empty copy says so. */
  readonly filtered: boolean
  readonly showAdminFlags: boolean
  readonly labelMode: TileLabelMode
  readonly details: TileDetails
  /** Whether the session holds `face-assignment`: without it the "?" chip (an
   *  assignment shortcut) is not drawn. Names on the tiles are shown either way. */
  readonly canAssignFaces: boolean
  /** `intent` says WHY — the "?" chip asks for the assignment, a tap for the detail. */
  readonly onSelect: (row: EventsTrackRow, intent?: 'assign-face') => void
  /** Pull at the top of a PAST day: roll one day newer instead of refreshing. */
  readonly onRollNewerDay?: () => void
}

/** Rows this far from the end trigger the next page (in screens of content). */
const END_REACHED_THRESHOLD = 1.5
/** Render this far beyond the viewport — pixels, so a fast fling meets tiles. */
const DRAW_DISTANCE_PX = 800

// Module-level so the list sees the same functions every render.
const galleryItemKey = (item: GalleryItem): string => item.key
const galleryItemType = (item: GalleryItem): GalleryItem['type'] => item.type

export const EventsGallery = memo(function EventsGallery(props: EventsGalleryProps) {
  const {
    feed, density, anchorMs, dayOffset, filtered, showAdminFlags, labelMode,
    details, onSelect, onRollNewerDay, canAssignFaces,
  } = props
  const { t } = useTranslation()
  const { colors } = useTheme()
  const locale = useDateLocale()
  const { serverUrl, bearer } = useThumbAuth()
  const kindLabelsRecord = useEventKindLabels()
  const kindLabels = useMemo(() => buildKindLabels(kindLabelsRecord), [kindLabelsRecord])

  // The list's own width, measured. Until it is (the first frame on a device, and
  // always under a renderer with no layout) the window's width stands in, so the
  // first paint is already a grid instead of one giant tile that then snaps.
  const viewport = useViewportSize()
  const screenMinSide = useScreenMinSide() ?? Math.min(viewport.width, viewport.height)
  const [measured, setMeasured] = useState(0)
  const onLayout = useCallback((e: LayoutChangeEvent): void => {
    const w = Math.round(e.nativeEvent.layout.width)
    setMeasured((prev) => (prev === w ? prev : w))
  }, [])
  const width = measured > 0 ? measured : viewport.width
  const columns = galleryColumns(width, density, galleryDeviceClass(screenMinSide))

  const edge = tileEdgeFor(width, columns)
  // Runs to the window edge and passes UNDER the glass bar; the padding keeps
  // the last row reachable (the Cameras rule, `useTabScrollPadding`).
  const padBottom = useTabScrollPadding(SPACING['3xl'] * 2)
  const contentStyle = useMemo(() => ({ paddingBottom: padBottom }), [padBottom])
  const navInset = useBottomNavInset()
  const indicatorInsets = useMemo(() => ({ bottom: navInset }), [navInset])
  const detailsHeight = tileDetailsHeight(details)
  const thumbPx = thumbPxForEdge(edge, PixelRatio.get())

  const chipOptions = useMemo<TileChipOptions>(
    () => ({ labelMode, showAdminFlags, kindLabels, iconIds: feed.iconIds, locale, nowMs: anchorMs }),
    [labelMode, showAdminFlags, kindLabels, feed.iconIds, locale, anchorMs],
  )

  const items = useMemo(
    () =>
      buildGalleryItems({
        rows: feed.rows,
        columns,
        anchorMs,
        exhausted: feed.tail === 'exhausted',
        namedDayOffset: dayOffset,
      }),
    [feed.rows, columns, anchorMs, feed.tail, dayOffset],
  )

  const assignFace = useCallback((row: EventsTrackRow): void => onSelect(row, 'assign-face'), [onSelect])
  const onAssignFace = canAssignFaces ? assignFace : undefined
  const onOpen = useCallback((row: EventsTrackRow): void => onSelect(row), [onSelect])

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<GalleryItem>): React.ReactElement =>
      item.type === 'header' ? (
        <DayHeader item={item} anchorMs={anchorMs} />
      ) : (
        <GridRow
          item={item}
          edge={edge}
          details={details}
          detailsHeight={detailsHeight}
          serverUrl={serverUrl}
          thumbPx={thumbPx}
          bearer={bearer}
          chipOptions={chipOptions}
          anchorMs={anchorMs}
          onPress={onOpen}
          onAssignFace={onAssignFace}
        />
      ),
    [anchorMs, edge, details, detailsHeight, serverUrl, thumbPx, bearer, chipOptions, onOpen, onAssignFace],
  )

  const [pulling, setPulling] = useState(false)
  const { refresh } = feed
  const onPull = useCallback((): void => {
    if (pullIntentFor(dayOffset) === 'roll-newer' && onRollNewerDay !== undefined) {
      onRollNewerDay()
      return
    }
    setPulling(true)
    void refresh().finally(() => setPulling(false))
  }, [dayOffset, onRollNewerDay, refresh])

  const { loadMore } = feed
  const onEndReached = useCallback((): void => {
    if (feed.tail === 'more') loadMore()
  }, [feed.tail, loadMore])

  if (feed.loading && feed.rows.length === 0) {
    return (
      <View style={styles.fill} onLayout={onLayout}>
        <GallerySkeleton edge={edge} />
      </View>
    )
  }
  if (feed.error !== null && feed.rows.length === 0) {
    return (
      <View style={styles.fill} onLayout={onLayout}>
        <ErrorState title={t('v2.events.loadError')} onRetry={feed.retry} />
      </View>
    )
  }
  if (feed.rows.length === 0) {
    return (
      <View style={[styles.fill, feed.semanticLoading ? styles.message : null]} onLayout={onLayout}>
        {feed.semanticLoading ? <ActivityIndicator color={colors.foregroundMuted} /> : (
          <EmptyState
            icon={filtered ? SearchX : Inbox}
            title={filtered ? t('v2.events.emptyFiltered') : t('v2.events.empty')}
          />
        )}
      </View>
    )
  }

  return (
    <View style={styles.fill} onLayout={onLayout}>
      {edge > 0 ? (
        <FlashList
          data={items}
          renderItem={renderItem}
          keyExtractor={galleryItemKey}
          getItemType={galleryItemType}
          drawDistance={DRAW_DISTANCE_PX}
          onEndReached={onEndReached}
          onEndReachedThreshold={END_REACHED_THRESHOLD}
          refreshControl={
            <RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={colors.foregroundMuted} colors={[colors.primary]} />
          }
          ListFooterComponent={<Tail feed={feed} />}
          contentContainerStyle={contentStyle}
          scrollIndicatorInsets={indicatorInsets}
        />
      ) : null}
    </View>
  )
})

const DayHeader = memo(function DayHeader({ item, anchorMs }: { readonly item: GalleryHeaderItem; readonly anchorMs: number }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const label = eventsDayLabel(item.dayOffset, anchorMs, (key, fallback) => t(key, { defaultValue: fallback }))
  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={[styles.headerTitle, { color: colors.foreground }]}>{label}</Text>
      {item.count !== null ? (
        <Text style={[styles.headerCount, TABULAR, { color: colors.foregroundSubtle }]}>
          {t('v2.events.dayCount', { count: item.count })}
        </Text>
      ) : null}
    </View>
  )
})

interface GridRowProps {
  readonly item: GalleryRowItem
  readonly edge: number
  readonly details: TileDetails
  readonly detailsHeight: number
  readonly serverUrl: string | null
  readonly thumbPx: number
  readonly bearer: string | null
  readonly chipOptions: TileChipOptions
  readonly anchorMs: number
  readonly onPress: (row: EventsTrackRow) => void
  readonly onAssignFace?: (row: EventsTrackRow) => void
}

const GridRow = memo(function GridRow(props: GridRowProps) {
  const { item, edge, details, detailsHeight, serverUrl, thumbPx, bearer, chipOptions, anchorMs, onPress, onAssignFace } = props
  return (
    <View style={[styles.gridRow, { height: galleryItemHeight(item, edge, detailsHeight) }]}>
      {item.rows.map((row, column) => (
        <EventTile
          // The COLUMN, not the track: the list recycles this row for other
          // tracks, and a key that changes with the track unmounts and rebuilds
          // every tile (image, chips, pressables) on every recycle.
          key={column}
          row={row}
          edge={edge}
          imageUri={serverUrl === null ? null : buildTrackThumbUrl(serverUrl, row.trackId, thumbPx)}
          bearer={bearer}
          chipOptions={chipOptions}
          details={details}
          anchorMs={anchorMs}
          onPress={onPress}
          onAssignFace={onAssignFace}
        />
      ))}
    </View>
  )
})

/** The end of the list: more is coming, that is all there is, or the client's
 *  own row ceiling stopped it — three different things, three different words. */
function Tail({ feed }: { readonly feed: EventsGalleryFeed }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  if (feed.loadingMore) {
    return (
      <View style={styles.tail} accessibilityLabel={t('v2.eventsCard.loadingMore')}>
        <ActivityIndicator color={colors.foregroundMuted} />
      </View>
    )
  }
  if (feed.tail === 'ceiling') {
    return (
      <Pressable onPress={feed.loadOlder} accessibilityRole="button" style={styles.tail}>
        <Text style={[styles.tailAction, { color: colors.primary }]}>{t('v2.events.loadOlder')}</Text>
      </Pressable>
    )
  }
  if (feed.tail === 'exhausted') {
    return (
      <View style={styles.tail}>
        <Text style={[styles.messageText, { color: colors.foregroundSubtle }]}>{t('v2.events.endOfList')}</Text>
      </View>
    )
  }
  return <View style={styles.tail} />
}

/** Static placeholder tiles while the first page is in flight — no shimmer: a
 *  looping animation on forty boxes is the cost this surface is built to avoid. */
function GallerySkeleton({ edge }: { readonly edge: number }) {
  const { colors } = useTheme()
  const size = edge > 0 ? edge : 96
  return (
    <View style={styles.skeleton} pointerEvents="none">
      {Array.from({ length: 40 }, (_, i) => (
        <View key={i} style={{ width: size, height: size, backgroundColor: colors.surfaceHover }} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, width: '100%' },
  message: { alignItems: 'center', justifyContent: 'center', gap: SPACING.lg, padding: SPACING['2xl'] },
  messageText: { fontSize: TYPOGRAPHY.size.md, textAlign: 'center' },
  tailAction: { fontSize: TYPOGRAPHY.size.md, fontWeight: TYPOGRAPHY.weight.medium },
  header: {
    height: GALLERY_HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACING.md,
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.md,
  },
  headerTitle: { fontSize: TYPOGRAPHY.size.lg, fontWeight: TYPOGRAPHY.weight.bold },
  headerCount: { fontSize: TYPOGRAPHY.size.sm, paddingBottom: 1 },
  gridRow: { flexDirection: 'row', gap: GALLERY_GAP },
  tail: { alignItems: 'center', justifyContent: 'center', minHeight: 56, paddingVertical: SPACING.xl },
  skeleton: { flexDirection: 'row', flexWrap: 'wrap', gap: GALLERY_GAP },
})
