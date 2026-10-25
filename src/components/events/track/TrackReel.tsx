/**
 * TrackReel — the "Recent" strip: a horizontal, virtualised row of the latest
 * tracks (last 24 h, optionally one camera), native on iOS, Android and the web
 * build.
 *
 * It is a second VIEW of the one feed, not a second feed: the rows come from
 * `useEventsGalleryFeed` — `shared/events` paging, the live delta, the
 * filters — exactly as the gallery's do, and a card is the gallery's picture
 * (`TileHero`) with the same corner time chip as the events page. What this file
 * adds is the strip:
 * its geometry (the `reelRowHeight` contract the Cameras page reserves before a
 * row exists), its own filter (`reel-filter-store`) and the detail it opens.
 *
 * The detail is the SAME `TrackDetailModal` the events page opens, and it
 * navigates the reel's own rows in the strip's order.
 *
 * The strip keeps its height whatever the feed has to say — loading, empty or
 * failed — because the Cameras page is built around a fixed header
 * (`RecentReelBlock`): an error carries its retry INSIDE the reserved band.
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native'
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list'
import { useTranslation } from 'react-i18next'

import { useSettings } from '../../../data/use-settings.js'
import { useCameras } from '../../../data/use-cameras.js'
import { useEventKinds } from '../../../data/use-event-kinds.js'
import { useEventKindLabels } from '../../../data/use-event-kind-labels.js'
import { useEventsGalleryFeed } from '../../../data/use-events-gallery-feed.js'
import { useThumbAuth } from '../../../data/use-thumb-auth.js'
import { useOpenTrack } from '../../../hooks/use-open-track.js'
import { useTrackListNavigation } from '../../../hooks/use-track-list-navigation.js'
import { useDateLocale } from '../../../lib/date-locale.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import {
  resolveReelClasses,
  resolveReelExcludeSources,
  useReelFilterStore,
} from '../../../store/reel-filter-store.js'
import { buildTrackThumbUrl } from '../../../../shared/events/events-media-url.js'
import { buildKindLabels } from '../../../../shared/events/events-taxonomy.js'
import type { EventsTrackRow } from '../../../../shared/events/events-track-row.js'
import { ReelStripSkeleton } from './ReelStripSkeleton.js'
import { TrackDetailModal } from './TrackDetailModal.js'
import { reelRowHeight, type TrackReelProps } from './reel-layout.js'
import { TileHero, TileLabels } from '../gallery/TileHero.js'
import { thumbPxForEdge } from '../gallery/events-gallery-layout.js'
import { tileAccessibilityLabel, tileChips, type TileChipOptions } from '../gallery/tile-model.js'

/** The reel is a RECENT strip — the same 24 h floor the feed always used here. */
const REEL_MAX_AGE_MS = 24 * 60 * 60 * 1000

export function TrackReel({ deviceId, cardWidth = 80, onSeek }: TrackReelProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const locale = useDateLocale()
  const { settings } = useSettings()
  const { serverUrl, bearer } = useThumbAuth()
  const kindLabelsRecord = useEventKindLabels()
  const kindLabels = useMemo(() => buildKindLabels(kindLabelsRecord), [kindLabelsRecord])
  const [mountNow] = useState(() => Date.now())

  const { data: cameras } = useCameras({ includeHidden: true })
  const deviceIds = useMemo(
    () => (deviceId !== undefined ? [deviceId] : (cameras ?? []).map((camera) => camera.id)),
    [deviceId, cameras],
  )
  const cameraNameFor = useCallback(
    (id: number): string => cameras?.find((camera) => camera.id === id)?.name ?? '',
    [cameras],
  )

  const reelFilter = useReelFilterStore((s) => s.filter)
  const hydrateFilter = useReelFilterStore((s) => s.hydrate)
  useEffect(() => {
    void hydrateFilter()
  }, [hydrateFilter])
  const eventKinds = useEventKinds(deviceIds)
  const classes = useMemo(() => resolveReelClasses(reelFilter, eventKinds.data), [reelFilter, eventKinds.data])
  const excludeSources = useMemo(
    () => resolveReelExcludeSources(reelFilter, eventKinds.data),
    [reelFilter, eventKinds.data],
  )

  const feed = useEventsGalleryFeed({
    view: 'reel',
    deviceIds: deviceId !== undefined ? [deviceId] : [],
    classes,
    attrs: [],
    search: '',
    searchMode: 'text',
    sort: 'time',
    excludeSources,
    anchorMs: mountNow,
    maxAgeMs: REEL_MAX_AGE_MS,
  })

  const { selected, intent, open, select, close } = useOpenTrack()
  const navigation = useTrackListNavigation({ tracks: feed.rows, selected, cameraNameFor, onSelect: select })
  const handleSeek = useCallback(
    (epochMs: number): void => {
      if (selected && onSeek) onSeek(selected, epochMs)
      close()
    },
    [selected, onSeek, close],
  )

  const chipOptions = useMemo<TileChipOptions>(
    () => ({
      labelMode: settings.events.reelLabelMode,
      showAdminFlags: false,
      kindLabels,
      iconIds: feed.iconIds,
      locale,
      nowMs: mountNow,
    }),
    [settings.events.reelLabelMode, kindLabels, feed.iconIds, locale, mountNow],
  )
  const thumbPx = thumbPxForEdge(cardWidth, PixelRatio.get())

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<EventsTrackRow>): React.ReactElement => (
      <ReelCard
        row={item}
        edge={cardWidth}
        imageUri={serverUrl === null ? null : buildTrackThumbUrl(serverUrl, item.trackId, thumbPx)}
        bearer={bearer}
        chipOptions={chipOptions}
        onPress={open}
      />
    ),
    [cardWidth, serverUrl, thumbPx, bearer, chipOptions, open],
  )

  const { loadMore } = feed
  const onEndReached = useCallback((): void => {
    if (feed.tail === 'more') loadMore()
  }, [feed.tail, loadMore])

  const height = reelRowHeight(cardWidth)
  let body: React.ReactElement
  if (feed.loading && feed.rows.length === 0) {
    body = <ReelStripSkeleton cardWidth={cardWidth} />
  } else if (feed.error !== null && feed.rows.length === 0) {
    body = (
      <View style={[styles.band, { height }]}>
        <Text style={[styles.bandText, { color: colors.foregroundMuted }]}>{t('v2.events.loadError')}</Text>
        <Pressable onPress={feed.retry} accessibilityRole="button" hitSlop={8}>
          <Text style={[styles.bandText, { color: colors.primary }]}>{t('v2.events.retry')}</Text>
        </Pressable>
      </View>
    )
  } else if (feed.rows.length === 0) {
    body = (
      <View style={[styles.band, { height }]}>
        <Text style={[styles.bandText, { color: colors.foregroundMuted }]}>{t('v2.events.empty')}</Text>
      </View>
    )
  } else {
    body = (
      <FlashList
        horizontal
        data={feed.rows}
        renderItem={renderItem}
        keyExtractor={(row) => row.trackId}
        onEndReached={onEndReached}
        onEndReachedThreshold={1.5}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={Separator}
      />
    )
  }

  return (
    <View style={[styles.strip, { height }]}>
      {body}
      <TrackDetailModal
        track={selected}
        onSeek={onSeek ? handleSeek : undefined}
        onClose={close}
        openIntent={intent}
        {...(navigation !== undefined ? { navigation } : {})}
      />
    </View>
  )
}

interface ReelCardProps {
  readonly row: EventsTrackRow
  readonly edge: number
  readonly imageUri: string | null
  readonly bearer: string | null
  readonly chipOptions: TileChipOptions
  readonly onPress: (row: EventsTrackRow) => void
}

const ReelCard = memo(function ReelCard({ row, edge, imageUri, bearer, chipOptions, onPress }: ReelCardProps) {
  const { colors } = useTheme()
  const chips = useMemo(() => tileChips(row, chipOptions), [row, chipOptions])
  const showCapsule = chipOptions.labelMode !== 'off'
  return (
    <View style={[styles.card, { width: edge, backgroundColor: colors.surface }]}>
      <Pressable
        onPress={() => onPress(row)}
        accessibilityRole="button"
        accessibilityLabel={tileAccessibilityLabel(row, chipOptions.kindLabels, chips.time)}
      >
        <TileHero row={row} chips={chips} edge={edge} imageUri={imageUri} bearer={bearer} showTime />
      </Pressable>
      <TileLabels row={row} chips={chips} edge={edge} showCapsule={showCapsule} />
    </View>
  )
})

function Separator(): React.ReactElement {
  return <View style={styles.separator} />
}

const styles = StyleSheet.create({
  strip: { overflow: 'hidden', width: '100%' },
  list: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  separator: { width: SPACING.sm },
  card: { borderRadius: RADIUS.md, overflow: 'hidden' },
  band: { alignItems: 'center', justifyContent: 'center', gap: SPACING.md },
  bandText: { fontSize: 13 },
})
