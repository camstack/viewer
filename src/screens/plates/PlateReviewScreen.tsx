/**
 * PlateReviewScreen — the admin-only Plates page of the Library, the twin of
 * `FaceReviewScreen` over the hub's `plateGallery` cap. `LibraryScreen` gates
 * it on the session's hub-CONFIRMED admin grade; this screen assumes it is only
 * mounted for that confirmed session.
 *
 * Same page, same flows: the shared Library filter bar (cameras, status —
 * Assigned · Suggested · Unassigned, default Suggested + Unassigned — period;
 * the eye holds the sort and the tile details), a grid of reads (`ReviewTile`,
 * the People tile in a 16:9 frame), ONE assignment path (the detail modal: assign to a
 * vehicle, create a vehicle and assign, correct the text, delete), multi-select
 * with Assign / Apply suggestions / Delete, Similar plates, and New vehicle.
 * Every long write is a job on the Activity queue (`usePlateReviewJobs`).
 *
 * What the hub narrows and what the app does is in `plate-review-filters.ts`:
 * `listPlates` takes only one camera and a limit, so status, date range and
 * sort run over the loaded window.
 */
import React, { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useServer } from '../../app/ServerProvider.js'
import { PlateReviewDetailModal } from '../../components/plates/PlateReviewDetailModal.js'
import { PlateReviewSelectionBar } from '../../components/plates/PlateReviewSelectionBar.js'
import { PlateSimilarModal } from '../../components/plates/PlateSimilarModal.js'
import { reviewFilterBar } from '../../components/review/review-filter-bar.js'
import { useReviewFilters } from '../../components/review/use-review-filters.js'
import { ReviewTile } from '../../components/review/ReviewTile.js'
import { plateReviewTileContent } from '../../components/review/review-tile.js'
import { useReviewTileDisplay } from '../../components/review/use-review-tile-display.js'
import { LibraryFilterBar } from '../../components/ui/LibraryFilterBar.js'
import type { OverflowMenuItem } from '../../components/ui/HeaderOverflowMenu.js'
import { useLibraryGrid } from '../../components/ui/use-library-grid.js'
import { LIBRARY_GRID_BOTTOM_PADDING, LIBRARY_GRID_GAP, LIBRARY_GRID_PADDING } from '../../components/ui/library-grid.js'
import { useConfirm, useNotice, usePrompt } from '../../components/ui/confirm.js'
import { useConnection } from '../../connection/ConnectionProvider.js'
import {
  FACE_REVIEW_STATUSES,
  activeFaceReviewFilterCount,
  setFaceReviewDay,
  type FaceReviewSortKey,
} from '../../data/face-review-filters.js'
import {
  plateCropUri,
  plateDeletionReadiness,
  plateSuggestionReadiness,
  type PlateReviewRow,
} from '../../data/plate-review.js'
import {
  applyPlateReviewFilters,
  plateReviewCameraOptions,
  plateReviewWindowIsPartial,
  retainSelectedPlates,
  selectedPlateRows,
  sortPlateReviewRows,
  togglePlateSelection,
} from '../../data/plate-review-filters.js'
import {
  useCorrectPlateText,
  useCreateVehicle,
  usePlateClusters,
  usePlateReviewData,
  usePlateReviewJobs,
} from '../../data/use-plate-review.js'
import { Car, CheckSquare, RefreshCw, SearchX, Sparkles } from '../../lib/icons.js'
import { hapticAction } from '../../lib/haptics.js'
import { log } from '../../lib/logger.js'
import { useTabScrollPadding } from '../../navigation/bottom-nav-inset.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { EmptyState, ErrorState } from '../../components/ui/EmptyState.js'
import { refusalAwareKey } from '../../auth/forbidden.js'


const SORT_LABEL_KEY: Readonly<Record<FaceReviewSortKey, string>> = {
  certainty: 'v2.plateReview.sortByCertainty',
  date: 'v2.plateReview.sortByDate',
}


export function PlateReviewScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const gridPadBottom = useTabScrollPadding(LIBRARY_GRID_BOTTOM_PADDING)
  const { colors } = useTheme()
  const grid = useLibraryGrid()
  const { controller, state } = useConnection()
  const { token } = useServer()
  const serverUrl = controller.getSystem()?.serverUrl ?? null
  const mediaHeaders: Record<string, string> | undefined = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  )
  const enabled = state === 'connected'
  const jobs = usePlateReviewJobs()
  const createVehicle = useCreateVehicle()
  const correctText = useCorrectPlateText()
  const confirm = useConfirm()
  const notice = useNotice()
  const prompt = usePrompt()

  // Status, cameras and the sort are remembered on this device; the day is not.
  const { filters, setFilters, sort, setSort, hydrated: filtersRead } = useReviewFilters('plates')
  const tileDisplay = useReviewTileDisplay('plates')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const [detailIds, setDetailIds] = useState<readonly string[]>([])
  const [similarOpen, setSimilarOpen] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const { rows, vehicles, isLoading, isError, refetch, loadMore, hasMore, isFetchingMore } = usePlateReviewData(
    enabled && filtersRead,
    filters,
  )
  const clusters = usePlateClusters(similarOpen)

  const { columns: numColumns, tileWidth } = grid
  const byId = useMemo(() => new Map(rows.map((r) => [r.plateId, r])), [rows])

  const visibleRows = useMemo(
    () => sortPlateReviewRows(applyPlateReviewFilters(rows, filters), sort),
    [rows, filters, sort],
  )
  // A selected read that a filter, an assignment or a refetch took off screen
  // leaves the count (derived, identity-stable).
  const activeSelection = useMemo(() => retainSelectedPlates(selected, visibleRows), [selected, visibleRows])
  const cameraOptions = useMemo(() => plateReviewCameraOptions(rows), [rows])
  const activeFilterCount = activeFaceReviewFilterCount(filters)
  const windowIsPartial = plateReviewWindowIsPartial(filters, hasMore)

  // "Today" (the date chip's word, the calendar's last pickable day) is pinned
  // when the operator PICKS a day, never read per render.
  const changeDay = useCallback((dayMs: number | null) => {
    setNowMs(Date.now())
    setFilters((prev) => setFaceReviewDay(prev, dayMs))
  }, [])

  const detailRows = useMemo(
    () => detailIds.map((id) => byId.get(id)).filter((r): r is PlateReviewRow => r !== undefined),
    [detailIds, byId],
  )
  const detailPending = detailIds.some((id) => pendingIds.has(id))

  const markPending = useCallback((ids: readonly string[]) => {
    setPendingIds((prev) => new Set([...prev, ...ids]))
  }, [])
  const clearPending = useCallback((ids: readonly string[]) => {
    setPendingIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      return next
    })
  }, [])

  const exitSelection = useCallback(() => {
    setSelectionMode(false)
    setSelected(new Set())
  }, [])
  const closeDetail = useCallback(() => setDetailIds([]), [])

  const queueAssign = useCallback(
    (ids: readonly string[], vehicleId: string, name: string) => {
      markPending(ids)
      jobs.assign(ids, vehicleId, name, () => clearPending(ids))
    },
    [jobs, markPending, clearPending],
  )

  const onDetailAssign = useCallback(
    (vehicleId: string, name: string) => {
      const targets = detailIds
      closeDetail()
      exitSelection()
      queueAssign(targets, vehicleId, name)
    },
    [detailIds, closeDetail, exitSelection, queueAssign],
  )
  const onDetailCreate = useCallback(
    (name: string) => {
      const targets = detailIds
      closeDetail()
      exitSelection()
      markPending(targets)
      jobs.assignToNewVehicle(targets, name, () => clearPending(targets))
    },
    [detailIds, closeDetail, exitSelection, jobs, markPending, clearPending],
  )

  const onConfirmSuggestion = useCallback(
    (plateId: string) => {
      const row = byId.get(plateId)
      if (row?.vehicleId === undefined || row.vehicleName === undefined) return
      queueAssign([plateId], row.vehicleId, row.vehicleName)
    },
    [byId, queueAssign],
  )
  const onOpenDetail = useCallback((plateId: string) => setDetailIds([plateId]), [])
  const onToggleSelect = useCallback((plateId: string) => {
    setSelected((prev) => togglePlateSelection(prev, plateId))
  }, [])

  const onStartSelect = useCallback((plateId: string) => {
    hapticAction()
    setSelectionMode(true)
    setSelected(new Set([plateId]))
  }, [])

  const selectionRows = useMemo(() => selectedPlateRows(visibleRows, activeSelection), [visibleRows, activeSelection])
  const suggestions = useMemo(() => plateSuggestionReadiness(selectionRows), [selectionRows])
  const deletion = useMemo(() => plateDeletionReadiness(selectionRows), [selectionRows])

  /** Delete confirmed first: the read and its crop go for good. */
  const confirmAndDelete = useCallback(
    async (targets: readonly string[], afterQueue: () => void) => {
      const ok = await confirm({
        title: t('v2.plateReview.deleteConfirmTitle', { count: targets.length }),
        message: t('v2.plateReview.deleteConfirmBody'),
        confirmLabel: t('v2.plateReview.deleteSelected'),
        cancelLabel: t('v2.settings.cancel'),
        destructive: true,
      })
      if (!ok) return
      afterQueue()
      markPending(targets)
      jobs.deletePlates(targets, () => clearPending(targets))
    },
    [confirm, t, jobs, markPending, clearPending],
  )
  const onDeleteSelection = useCallback(async () => {
    if (!deletion.ready || deletion.plateIds.length === 0) return
    await confirmAndDelete(deletion.plateIds, exitSelection)
  }, [deletion, confirmAndDelete, exitSelection])
  const onDeleteOne = useCallback(
    async (plateId: string) => {
      await confirmAndDelete([plateId], closeDetail)
    },
    [confirmAndDelete, closeDetail],
  )

  const onApplySuggestions = useCallback(() => {
    const plan = suggestions.plan
    if (!suggestions.ready || plan.length === 0) return
    const ids = plan.flatMap((entry) => entry.plateIds)
    exitSelection()
    markPending(ids)
    jobs.applySuggestions(plan, () => clearPending(ids))
  }, [suggestions, exitSelection, jobs, markPending, clearPending])

  const onCorrect = useCallback(
    async (plateId: string, text: string) => {
      try {
        await correctText.mutateAsync({ plateId, text })
      } catch (err: unknown) {
        log.error('plate-correct', 'correcting the plate text threw', {
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        })
        notice({ title: t('v2.plateReview.correctButton'), message: t(refusalAwareKey(err, 'v2.plateReview.correctFailed')) })
      }
    },
    [correctText, notice, t],
  )

  /** Add a vehicle with no plate in hand; one quick call, so inline. */
  const onCreateVehicle = useCallback(async () => {
    const name = await prompt({
      title: t('v2.plateReview.newVehicleTitle'),
      placeholder: t('v2.plateReview.newVehiclePlaceholder'),
      submitLabel: t('v2.plateReview.newVehicleButton'),
      cancelLabel: t('v2.settings.cancel'),
    })
    const trimmed = name?.trim() ?? ''
    if (trimmed.length === 0) return
    try {
      await createVehicle.mutateAsync({ name: trimmed })
    } catch (err: unknown) {
      log.error('plate-assign', 'creating a vehicle from the Plates page threw', {
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      })
      notice({ title: t('v2.plateReview.newVehicleButton'), message: t(refusalAwareKey(err, 'v2.plateReview.newVehicleFailed')) })
    }
  }, [prompt, t, createVehicle, notice])

  const onSelectGroup = useCallback(
    (plateIds: readonly string[]) => {
      setSimilarOpen(false)
      setSelectionMode(true)
      setSelected(new Set(plateIds))
      // A group can include reads the current chips hide: widen them so every
      // member is on screen and counted.
      setFilters((prev) => ({ ...prev, statuses: [...FACE_REVIEW_STATUSES] }))
    },
    [],
  )

  const cropUriForRow = useCallback((row: PlateReviewRow) => plateCropUri(row, serverUrl), [serverUrl])
  const cropUriForId = useCallback(
    (plateId: string) => {
      const row = byId.get(plateId)
      return row === undefined ? null : plateCropUri(row, serverUrl)
    },
    [byId, serverUrl],
  )

  const confirmLabel = t('v2.plateReview.assign')
  const renderItem = useCallback(
    ({ item }: { item: PlateReviewRow }) => (
      <ReviewTile
        content={plateReviewTileContent(item)}
        display={tileDisplay.display}
        width={tileWidth}
        cropUri={plateCropUri(item, serverUrl)}
        mediaHeaders={mediaHeaders}
        pending={pendingIds.has(item.plateId)}
        selectionMode={selectionMode}
        selected={activeSelection.has(item.plateId)}
        confirmLabel={confirmLabel}
        onToggleSelect={onToggleSelect}
        onStartSelect={onStartSelect}
        onOpenDetail={onOpenDetail}
        onConfirm={onConfirmSuggestion}
        testIDPrefix="plate-cell"
      />
    ),
    [tileDisplay.display, confirmLabel, tileWidth, serverUrl, mediaHeaders, pendingIds, selectionMode, activeSelection, onToggleSelect, onStartSelect, onOpenDetail, onConfirmSuggestion],
  )

  const overflowItems: readonly OverflowMenuItem[] = [
    {
      id: 'select',
      icon: CheckSquare,
      label: selectionMode ? t('v2.plateReview.selectDone') : t('v2.plateReview.selectButton'),
      onPress: () => (selectionMode ? exitSelection() : setSelectionMode(true)),
      testID: 'plate-review-action-select',
    },
    {
      id: 'similar',
      icon: Sparkles,
      label: t('v2.plateReview.similarButton'),
      onPress: () => setSimilarOpen(true),
      testID: 'plate-review-action-similar',
    },
    {
      id: 'refresh',
      icon: RefreshCw,
      label: t('v2.plateReview.refreshButton'),
      onPress: () => {
        void refetch()
      },
      testID: 'plate-review-action-refresh',
    },
  ]

  const filterBar = reviewFilterBar({
    t,
    filters,
    setFilters,
    sort,
    setSort,
    cameras: cameraOptions,
    nowMs,
    onPickDay: changeDay,
    sortKeyLabel: { certainty: t(SORT_LABEL_KEY.certainty), date: t(SORT_LABEL_KEY.date) },
    display: tileDisplay.display,
    onDisplayChange: tileDisplay.onDisplayChange,
    displayTestID: 'plate-review-display',
  })

  // Fixed block under the scope bar: ONE row — chips, then the eye, the `⋯`
  // menu (`HeaderOverflowMenu`, the same item ids and meanings as People) and
  // the primary "+" — and the count. Outside the list, so nothing above the
  // grid moves when an action runs. There is NO plate recompute on the hub
  // (`plateGallery` has no rescore method), so the menu's last item re-reads
  // the list and is named for exactly that — never "recompute".
  const top = (
    <View>
      <LibraryFilterBar
        date={filterBar.date}
        tools={[filterBar.display]}
        filters={filterBar.filters}
        onReset={filterBar.onReset}
        more={overflowItems}
        moreTestID="plate-review-action-more"
        primary={{
          id: 'new-vehicle',
          icon: Car,
          label: t('v2.plateReview.newVehicleButton'),
          onPress: () => {
            void onCreateVehicle()
          },
          testID: 'plate-review-action-new-vehicle',
        }}
        summary={isLoading || (!enabled && visibleRows.length === 0) ? ' ' : t('v2.plateReview.visibleCount', { count: visibleRows.length })}
        summaryTestID="plate-review-count"
        testID="plate-review-filter-bar"
      />

      {selectionMode ? (
        <PlateReviewSelectionBar
          selectedCount={activeSelection.size}
          suggestions={suggestions}
          deletion={deletion}
          onCancel={exitSelection}
          onAssign={() => {
            const targets = selectionRows.map((r) => r.plateId)
            if (targets.length > 0) setDetailIds(targets)
          }}
          onApplySuggestions={onApplySuggestions}
          onDelete={() => {
            void onDeleteSelection()
          }}
        />
      ) : null}

      {windowIsPartial ? (
        <Text style={[styles.partialHint, { color: colors.foregroundMuted }]}>
          {t('v2.plateReview.partialWindowHint', { count: rows.length })}
        </Text>
      ) : null}
    </View>
  )

  let listBody: React.ReactElement | null
  if (!enabled && visibleRows.length === 0) {
    // Not connected and nothing cached: an unanswered question, not an empty
    // list. The hub-status overlay at the app root says why.
    listBody = null
  } else if (isLoading) {
    listBody = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{t('v2.plateReview.loading')}</Text>
      </View>
    )
  } else if (isError) {
    listBody = <ErrorState title={t('v2.plateReview.loadError')} onRetry={() => { void refetch() }} />
  } else if (activeFilterCount > 0) {
    listBody = (
      <EmptyState
        icon={SearchX}
        title={t('v2.plateReview.emptyFiltered')}
        action={{ label: t('common.reset'), onPress: filterBar.onReset }}
      />
    )
  } else {
    listBody = <EmptyState icon={Car} title={t('v2.plateReview.empty')} />
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }} onLayout={grid.onLayout}>
      {top}

      <FlatList
        key={`cols-${String(numColumns)}`}
        data={visibleRows}
        keyExtractor={(item) => item.plateId}
        numColumns={numColumns}
        columnWrapperStyle={styles.row}
        contentContainerStyle={[styles.gridContent, { paddingBottom: gridPadBottom }]}
        renderItem={renderItem}
        ListEmptyComponent={visibleRows.length === 0 ? listBody : null}
        ListFooterComponent={
          isFetchingMore ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null
        }
        // Paging follows the FEED, never the filtered count (a client filter
        // that matches nothing yet must not stop the pager).
        onEndReached={hasMore ? loadMore : undefined}
        onEndReachedThreshold={0.4}
        refreshing={false}
        onRefresh={() => {
          void refetch()
        }}
      />

      <PlateReviewDetailModal
        rows={detailRows}
        vehicles={vehicles}
        cropUriFor={cropUriForRow}
        mediaHeaders={mediaHeaders}
        pending={detailPending}
        correcting={correctText.isPending}
        onAssign={onDetailAssign}
        onCreate={onDetailCreate}
        onCorrect={(plateId, text) => {
          void onCorrect(plateId, text)
        }}
        onDelete={(plateId) => {
          void onDeleteOne(plateId)
        }}
        onClose={closeDetail}
      />

      <PlateSimilarModal
        open={similarOpen}
        loading={clusters.isLoading}
        failed={clusters.isError}
        groups={clusters.data ?? []}
        cropUriFor={cropUriForId}
        mediaHeaders={mediaHeaders}
        onSelectGroup={onSelectGroup}
        onClose={() => setSimilarOpen(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', justifyContent: 'center', padding: SPACING['2xl'], gap: SPACING.md },
  partialHint: { fontSize: 11, paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm },
  footerLoading: { paddingVertical: SPACING.md, alignItems: 'center' },
  row: { gap: LIBRARY_GRID_GAP, paddingHorizontal: LIBRARY_GRID_PADDING },
  gridContent: { paddingVertical: SPACING.sm, gap: LIBRARY_GRID_GAP, flexGrow: 1 },
})
