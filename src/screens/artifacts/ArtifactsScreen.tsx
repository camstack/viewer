/**
 * ArtifactsScreen — the Library's gallery of STORED MEDIA, both kinds of it.
 * The operator calls it **Media** (renamed 2026-09-13); the file, the section
 * key and the `/artifacts` route keep the old word, which is what every
 * bookmark and deep link already carries — the rename is in the locales.
 *
 * Until 2026-09-13 this was one of two sibling sections: Artifacts (media the
 * hub produced — timelapses and their previews, summary mosaics, and the clip /
 * gif / still a notification rule cut) and Exports (mp4s the operator cut out of
 * the recording). They were the same class of thing described twice — a file on
 * the hub with a camera, an instant, a size and a retention window — and the two
 * screens disagreed about everything else: one could play its media and not
 * delete it, the other could delete and not play; one could be filtered by day
 * and camera, the other could not be filtered at all. Exports are a KIND in this
 * list now, `ExportsScreen` is gone, and what an element supports is answered in
 * one place (`library-items.ts`) for both.
 *
 * Reached two ways: as the Artifacts subsection of the Library tab (`embedded`,
 * where the shell owns the app bar), and as the stacked routes `/artifacts` and
 * `/exports` pushed over the tabs (old bookmarks and deep links, which must
 * still land somewhere true).
 *
 * Shell mirrors Events: a day cursor plus one chip per facet
 * ({@link LibraryFilterBar}), never a single Filters button over a modal sheet.
 * Poster kinds are never listed — a timelapse/gif/mp4 tile shows its still as
 * the thumbnail.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { hapticTap } from '../../lib/haptics.js'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'

import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { useTabScrollPadding } from '../../navigation/bottom-nav-inset.js'
import { useLibraryGrid } from '../../components/ui/use-library-grid.js'
import {
  LIBRARY_GRID_BOTTOM_PADDING,
  LIBRARY_GRID_GAP,
  LIBRARY_GRID_PADDING,
} from '../../components/ui/library-grid.js'
import { useConnection } from '../../connection/ConnectionProvider.js'
import { ScreenHeader } from '../../components/ScreenHeader.js'
import { useConfirm, useNotice } from '../../components/ui/confirm.js'
import { useCameras } from '../../data/use-cameras.js'
import { useArtifactMedia, useDeleteNcArtifact, useNcArtifacts } from '../../data/use-nc-artifacts.js'
import type { NcArtifactRecord } from '../../data/nc-artifacts.js'
import type { NamedCamera } from '../../data/nc-artifact-format.js'
import {
  useCancelExport,
  useDeleteExport,
  useExportEvents,
  useExportsList,
  useResolveDownloadUrl,
  type ExportRecord,
} from '../../data/use-exports.js'
import { ArtifactCard } from '../../components/artifacts/ArtifactCard.js'
import { ArtifactDetailModal } from '../../components/artifacts/ArtifactDetailModal.js'
import { ExportCard } from '../../components/artifacts/ExportCard.js'
import { ExportDetailModal } from '../../components/artifacts/ExportDetailModal.js'
import {
  LibraryFilterBar,
  type LibraryPrimaryDef,
  type LibraryFilterDef,
} from '../../components/ui/LibraryFilterBar.js'
import { Clapperboard, Plus, SearchX } from '../../lib/icons.js'
import { useMediaDownload } from '../../components/media/use-media-download.js'
import { useServer } from '../../app/ServerProvider.js'
import {
  activeArtifactFilterCount,
  artifactDayBounds,
  bucketArtifactNow,
  setArtifactDayOffset,
  toArtifactFilters,
  toLibraryCriteria,
  toggleArtifactDevice,
  toggleArtifactKind,
} from './artifact-filters.js'
import { useArtifactFilters } from './use-artifact-filters.js'
import {
  LIBRARY_KIND_ORDER,
  libraryItemMatches,
  libraryKindLabelKey,
  mergeLibraryItems,
  wantsArtifacts,
  wantsExports,
  type LibraryItem,
} from './library-items.js'
import { EmptyState, ErrorState } from '../../components/ui/EmptyState.js'
import { dayStartForOffset, localDayOffset } from '../../lib/local-day.js'

/** How often the expiry countdowns tick. */
const CLOCK_MS = 30_000

interface ArtifactsScreenProps {
  /**
   * Rendered inside the Library shell rather than as a stacked route. The shell
   * already draws the app bar and consumed the safe-area inset, and there is
   * nothing to go BACK to from a tab — `router.back()` there pops out of the
   * Library entirely — so the stacked-page header is dropped and only the filter
   * bar is kept.
   */
  readonly embedded?: boolean
}

export function ArtifactsScreen({ embedded = false }: ArtifactsScreenProps) {
  const { t } = useTranslation()
  const listPadBottom = useTabScrollPadding(LIBRARY_GRID_BOTTOM_PADDING)
  const grid = useLibraryGrid()
  const router = useRouter()
  const { colors } = useTheme()
  const { state } = useConnection()
  const confirm = useConfirm()
  const notice = useNotice()
  const { token } = useServer()
  const { data: cameras = [] } = useCameras()
  const { headers, thumbFor } = useArtifactMedia()
  const download = useMediaDownload()
  const resolveDownloadUrl = useResolveDownloadUrl()

  // Kinds and cameras are remembered on this device; the day is not.
  const { filterState, setFilterState, clear: clearFilters, hydrated: filtersRead } = useArtifactFilters()
  const [selectedArtifact, setSelectedArtifact] = useState<NcArtifactRecord | null>(null)
  const [selectedExport, setSelectedExport] = useState<ExportRecord | null>(null)

  // A slow clock for the relative-time + expiry labels. Not 1 Hz like the old
  // Exports page: nothing here is rendering at frame rate, the finest label is
  // minutes, and a per-second re-render of a gallery is pure cost. An export's
  // PROGRESS does not ride this clock — it rides `useExportEvents`.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), CLOCK_MS)
    return () => clearInterval(id)
  }, [])

  // `fromMs` rides the query key, so it is snapped to a bucket — a raw clock
  // would mint a brand-new infinite query on every tick and refetch the gallery
  // from page one.
  const bucketNow = bucketArtifactNow(nowMs)
  const filters = useMemo(() => toArtifactFilters(filterState, bucketNow), [filterState, bucketNow])
  const criteria = useMemo(() => toLibraryCriteria(filterState, bucketNow), [filterState, bucketNow])

  const artifactsWanted = wantsArtifacts(filterState.kinds)
  const exportsWanted = wantsExports(filterState.kinds)
  const feed = useNcArtifacts(filters, { enabled: artifactsWanted && filtersRead })
  const exportsQuery = useExportsList()
  const liveEvents = useExportEvents()
  const cancel = useCancelExport()
  const del = useDeleteExport()
  const delArtifact = useDeleteNcArtifact()

  const namedCameras = useMemo<readonly NamedCamera[]>(
    () => cameras.map((c) => ({ id: c.id, name: c.name })),
    [cameras],
  )
  const cameraName = useCallback(
    (deviceId: number): string =>
      cameras.find((c) => c.id === deviceId)?.name ?? t('v2.cameraDetail.fallbackName', { id: deviceId }),
    [cameras, t],
  )

  /**
   * The list. Both sources go through ONE predicate — the artifact half is
   * already narrowed on the hub, the export half can only be narrowed here
   * (`listExports` answers with the whole history), and a screen that filtered
   * only what the hub could filter would show one day of artifacts beside every
   * export ever made.
   */
  const items = useMemo<readonly LibraryItem[]>(() => {
    const merged = mergeLibraryItems(
      artifactsWanted ? feed.artifacts : [],
      exportsWanted ? (exportsQuery.data ?? []) : [],
    )
    return merged.filter((item) => libraryItemMatches(item, criteria))
  }, [feed.artifacts, exportsQuery.data, artifactsWanted, exportsWanted, criteria])

  const onToggleKind = useCallback(
    (kind: Parameters<typeof toggleArtifactKind>[1]) =>
      setFilterState((prev) => toggleArtifactKind(prev, kind)),
    [setFilterState],
  )
  const onToggleDevice = useCallback(
    (deviceId: number) => setFilterState((prev) => toggleArtifactDevice(prev, deviceId)),
    [setFilterState],
  )
  // The date chip picks a day; the filters think in days back from today.
  const onPickDay = useCallback(
    (dayMs: number | null) =>
      setFilterState((prev) => setArtifactDayOffset(prev, dayMs === null ? 0 : localDayOffset(dayMs, nowMs))),
    [nowMs, setFilterState],
  )
  const onClear = clearFilters

  /**
   * Creating an export is the CAMERA TIMELINE's job and stays there: the range
   * is drawn against the footage that actually exists, with the coverage bands
   * under it and the gap confirmation the flow already carries
   * (`useExportSelection`). This hands the operator to that flow, seeked to the
   * day they are looking at, rather than opening a second create surface here
   * that would have to invent a range.
   */
  const onCreateExport = useCallback(
    (deviceId: number): void => {
      const { toMs } = artifactDayBounds(filterState.dayOffset, nowMs)
      const at = Math.min(toMs, nowMs)
      router.push({ pathname: '/camera/[id]', params: { id: String(deviceId), at: String(at) } })
    },
    [router, filterState.dayOffset, nowMs],
  )

  const onDownloadExport = useCallback(
    (rec: ExportRecord): void => {
      void (async () => {
        const url = await resolveDownloadUrl(rec.id)
        if (url === null) {
          notice({ title: t('v2.exports.title'), message: t('v2.exports.downloadUnavailable') })
          return
        }
        const ok = await download({
          url,
          fileName: `export-${rec.id}.mp4`,
          mime: 'video/mp4',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        if (!ok) notice({ title: t('v2.exports.title'), message: t('v2.exports.downloadFailed') })
      })()
    },
    [resolveDownloadUrl, download, token, notice, t],
  )

  const onCancelExport = useCallback(
    (rec: ExportRecord): void => {
      void (async () => {
        const ok = await confirm({
          title: t('v2.exports.cancelConfirmTitle'),
          message: t('v2.exports.cancelConfirmBody'),
          confirmLabel: t('v2.exports.cancelAction'),
          cancelLabel: t('v2.exports.dismiss'),
          destructive: true,
        })
        if (!ok) return
        cancel.mutate(rec.id)
      })()
    },
    [cancel, confirm, t],
  )

  const onDeleteExport = useCallback(
    (rec: ExportRecord): void => {
      void (async () => {
        const ok = await confirm({
          title: t('v2.exports.deleteConfirmTitle'),
          message: t('v2.exports.deleteConfirmBody'),
          confirmLabel: t('v2.exports.deleteAction'),
          cancelLabel: t('v2.exports.dismiss'),
          destructive: true,
        })
        if (!ok) return
        del.mutate(rec.id)
      })()
    },
    [del, confirm, t],
  )

  /**
   * Delete one artifact — the SAME confirm-then-mutate shape the export delete
   * beside it uses, through the same `libraryItemActions` authority; the only
   * thing that differs is the answer.
   *
   * `deleted: false` is the hub's ONE reply to unknown / expired / not yours /
   * global-and-you-are-not-admin. It is neither an error (nothing broke) nor a
   * success (the row is still there), so it gets its own sentence — and it does
   * NOT name which of those reasons applied, because the hub deliberately does
   * not say. A thrown failure is a different thing entirely and reads as one.
   */
  const onDeleteArtifact = useCallback(
    (rec: NcArtifactRecord): void => {
      void (async () => {
        const ok = await confirm({
          title: t('v2.artifacts.deleteConfirmTitle'),
          message: t('v2.artifacts.deleteConfirmBody'),
          confirmLabel: t('v2.artifacts.deleteAction'),
          cancelLabel: t('v2.exports.dismiss'),
          destructive: true,
        })
        if (!ok) return
        try {
          const result = await delArtifact.mutateAsync(rec.id)
          if (!result.deleted) {
            notice({ title: t('v2.artifacts.title'), message: t('v2.artifacts.deleteRefused') })
          }
        } catch {
          notice({ title: t('v2.artifacts.title'), message: t('v2.artifacts.deleteFailed') })
        }
      })()
    },
    [delArtifact, confirm, notice, t],
  )

  const activeFilters = activeArtifactFilterCount(filterState)

  // Loading is only "loading" while a source the operator ASKED for is still in
  // flight. Reporting the artifact query's spinner over a list narrowed to
  // exports would hide rows that are already here.
  const isLoading =
    (artifactsWanted && feed.isLoading) || (exportsWanted && exportsQuery.isLoading)
  const loadError = artifactsWanted ? feed.error : null

  const renderItem = useCallback(
    ({ item }: { item: LibraryItem }) =>
      item.source === 'artifact' ? (
        <ArtifactCard
          record={item.record}
          width={grid.tileWidth}
          thumb={thumbFor(item.record)}
          headers={headers}
          cameras={namedCameras}
          nowMs={nowMs}
          t={t}
          onPress={() => setSelectedArtifact(item.record)}
          onDelete={() => onDeleteArtifact(item.record)}
        />
      ) : (
        <ExportCard
          rec={item.record}
          width={grid.tileWidth}
          cameraName={cameraName(item.record.deviceId)}
          nowMs={nowMs}
          livePct={liveEvents[item.record.id]?.progressPct}
          t={t}
          onPress={() => setSelectedExport(item.record)}
          onDownload={() => onDownloadExport(item.record)}
          onCancel={() => onCancelExport(item.record)}
        />
      ),
    [
      thumbFor, headers, namedCameras, nowMs, t, cameraName, liveEvents,
      onDownloadExport, onCancelExport, onDeleteArtifact, grid.tileWidth,
    ],
  )

  const body = useMemo(() => {
    // Not connected and nothing cached: no claim either way — the hub-status
    // overlay at the app root says why. Cached items stay on screen below.
    if (state !== 'connected' && items.length === 0) return null
    if (isLoading) {
      return (
        <Centered>
          <ActivityIndicator color={colors.primary} />
        </Centered>
      )
    }
    if (loadError !== null && items.length === 0) {
      return <ErrorState title={t('v2.artifacts.loadError')} body={loadError.message} onRetry={feed.refetch} />
    }
    if (items.length === 0) {
      return activeFilters > 0 ? (
        <EmptyState
          icon={SearchX}
          title={t('v2.artifacts.emptyFiltered')}
          action={{ label: t('v2.artifacts.filters.clear'), onPress: onClear }}
        />
      ) : (
        <EmptyState icon={Clapperboard} title={t('v2.artifacts.empty')} />
      )
    }
    return (
      <FlatList
        key={`cols-${String(grid.columns)}`}
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={grid.columns}
        columnWrapperStyle={styles.row}
        contentContainerStyle={[styles.gridContent, { paddingBottom: listPadBottom }]}
        onEndReachedThreshold={0.5}
        // Only the ARTIFACT half is paged: `listExports` answers with the whole
        // history in one call, so there is nothing to ask it for.
        onEndReached={feed.fetchNextPage}
        refreshing={feed.isRefetching || exportsQuery.isRefetching}
        // Matches the cameras + events feeds: a deliberate pull always gets an
        // answer, on every list in the app — and here it must reach BOTH
        // sources, or half the list would silently stay as it was.
        onRefresh={() => {
          hapticTap()
          feed.refetch()
          void exportsQuery.refetch()
        }}
        renderItem={renderItem}
        ListFooterComponent={
          feed.isFetchingNextPage ? (
            <View style={styles.footer}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null
        }
      />
    )
  }, [
    state, colors, t, feed, exportsQuery, items, isLoading, loadError, activeFilters, onClear, renderItem,
    grid.columns, listPadBottom,
  ])

  const cameraOptions = namedCameras.map((c) => ({ key: String(c.id), label: c.name }))
  const libraryFilters: readonly LibraryFilterDef[] = [
    {
      id: 'cameras',
      label: t('v2.events.cameras'),
      count: filterState.deviceIds.length,
      sections: [
        {
          title: t('v2.events.cameras'),
          options: cameraOptions,
          selected: filterState.deviceIds.map(String),
          onToggle: (key) => onToggleDevice(Number(key)),
          searchPlaceholder: t('v2.events.searchCameras'),
        },
      ],
    },
    {
      id: 'kinds',
      label: t('v2.artifacts.filters.kind'),
      count: filterState.kinds.length,
      estimatedHeight: 320,
      sections: [
        {
          // No search box: five rows the operator reads at a glance.
          title: t('v2.artifacts.filters.kind'),
          options: LIBRARY_KIND_ORDER.map((kind) => ({ key: kind, label: t(libraryKindLabelKey(kind)) })),
          selected: filterState.kinds,
          // Resolved against the catalogue rather than cast: a key that is not
          // a kind is a bug in this file, and a cast would let it through.
          onToggle: (key) => {
            const kind = LIBRARY_KIND_ORDER.find((k) => k === key)
            if (kind !== undefined) onToggleKind(kind)
          },
        },
      ],
    },
  ]
  // "New export" is an ACTION, not a facet: it picks the camera and hands over
  // to the camera timeline's selection flow, where an export is actually
  // created against the footage that exists. Its list is a DESTINATION, so
  // nothing in it is ever ticked.
  const createExport: LibraryPrimaryDef = {
    id: 'create-export',
    label: t('v2.exports.createAction'),
    icon: Plus,
    testID: 'artifacts-action-create-export',
    sections: [
      {
        title: t('v2.events.cameras'),
        hint: t('v2.exports.createHint'),
        options: cameraOptions,
        selected: [],
        closeOnPick: true,
        onToggle: (key) => onCreateExport(Number(key)),
        searchPlaceholder: t('v2.events.searchCameras'),
      },
    ],
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }} onLayout={grid.onLayout}>
      {embedded ? null : (
        <ScreenHeader title={t('v2.artifacts.title')} onBack={() => router.back()} bordered />
      )}
      <LibraryFilterBar
        date={{
          dayMs: dayStartForOffset(filterState.dayOffset, nowMs),
          nowMs,
          onPick: onPickDay,
          testID: 'artifacts-date',
        }}
        filters={libraryFilters}
        primary={createExport}
        summary={(state !== 'connected' && items.length === 0) || isLoading ? ' ' : t('v2.artifacts.count', { count: items.length })}
        onReset={onClear}
        testID="artifacts-filter-bar"
      />
      {body}

      <ArtifactDetailModal
        record={selectedArtifact}
        cameras={namedCameras}
        nowMs={nowMs}
        t={t}
        onDelete={onDeleteArtifact}
        onClose={() => setSelectedArtifact(null)}
      />
      <ExportDetailModal
        record={selectedExport}
        cameraName={selectedExport === null ? '' : cameraName(selectedExport.deviceId)}
        nowMs={nowMs}
        t={t}
        onDelete={onDeleteExport}
        onClose={() => setSelectedExport(null)}
      />
    </View>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING['2xl'],
    gap: SPACING.md,
  },
  footer: {
    paddingVertical: SPACING.xl,
    alignItems: 'center',
  },
  row: { gap: LIBRARY_GRID_GAP, paddingHorizontal: LIBRARY_GRID_PADDING },
  gridContent: { paddingVertical: SPACING.sm, gap: LIBRARY_GRID_GAP },
})
