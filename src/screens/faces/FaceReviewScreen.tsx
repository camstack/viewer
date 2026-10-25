/**
 * FaceReviewScreen — the admin-only face review tab. `LibraryScreen` gates it
 * on the session's hub-CONFIRMED admin grade — this screen assumes it is only
 * ever mounted for that confirmed session and does not re-derive admin-ness
 * itself.
 *
 * The 2026-08-26 redesign (two distinct cell shapes per `row.status`, no
 * cluster votes wearing per-face typography, one-tap decisions) is what the
 * operator called comprehensible, so it is EXTENDED here, not replaced:
 *
 *   • Filters at the top, as chips of the shared Library bar: STATUS (the three
 *     categories are independent booleans — Assigned · Suggested · Unassigned,
 *     default Suggested + Unassigned), CAMERA, PERIOD; the SORT (certainty /
 *     date, either direction) is in the display menu (the eye). Status, camera, date and sort are sent to the hub
 *     (`faceReviewListInput`), which applies them before `limit`; they are part
 *     of the query key. The default view is Suggested + Unassigned, most
 *     certain first (operator, 2026-10-23); status, cameras and the sort are
 *     remembered on this device (`useReviewFilters`), the day is not. `faceReviewWindowIsPartial` marks the one case
 *     still cut client-side (a single status chip inside the hub's
 *     `unassigned` set) so it is not rendered as "there are none".
 *   • The shared review tile (`ReviewTile`, one for People and Plates),
 *     a distinct shape per status, carrying the capture's time and camera
 *     (each switched from the eye; default the time only) and the
 *     suggestion's confidence AS A BAR — all on the crop, so the tile gained
 *     the facts without gaining height.
 *   • ONE assignment path: the detail modal (`FaceReviewDetailModal`). The
 *     bottom sheet that used to open from the suggested name is deleted.
 *   • MULTI-SELECT: a header toggle — or a long-press on any cell — turns every cell into a checkbox, and
 *     `FaceReviewSelectionBar` states how many are selected and offers the two
 *     writes that are not variants of each other — Assign, which opens THE
 *     SAME detail modal with the selection as a carousel and puts ONE person
 *     on all of them, and "Apply suggestions", which puts each face on ITS OWN
 *     suggested person (`face-review-suggestions.ts`). The second is offered
 *     only when every selected face HAS a suggestion, and says how many faces
 *     are the reason when it is not.
 *   • "Similar groups" (`FaceReviewAnalyzeModal`) is where look-alike
 *     clustering still lives, because there a row explicitly IS a group. It
 *     used to name a window size ("the last 100"); the window moved, so the
 *     label stopped naming it.
 *   • "Recompute suggestions" is a separate, manual, explicit action — never
 *     automatic after an assignment.
 *
 * ## Layout (2026-10-18)
 *
 * Under the Library scope bar sits the shared `LibraryFilterBar` (2026-10-21,
 * one header for every Library page): the chips (cameras, status, period), and
 * at the row's end the eye (sort + what a tile shows), the `⋯` menu (select, similar groups, recompute,
 * sample audit — `HeaderOverflowMenu`) and ONE primary action (New person, as
 * "+"), then the face count, in a fixed block OUTSIDE the scrolling list, so nothing above the grid moves when something
 * happens. There is no result or progress banner any more:
 * every long action here is a JOB on the Activity centre's local queue
 * (`useFaceReviewJobs`), and its progress and result are shown there.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { log } from '../../lib/logger.js'
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { useTabScrollPadding } from '../../navigation/bottom-nav-inset.js'
import { Sparkles, RefreshCw, CheckSquare, UserRoundPlus, ScanFace, SearchX } from '../../lib/icons.js'
import { LibraryFilterBar } from '../../components/ui/LibraryFilterBar.js'
import type { OverflowMenuItem } from '../../components/ui/HeaderOverflowMenu.js'
import { useLibraryGrid } from '../../components/ui/use-library-grid.js'
import { useSettings } from '../../data/use-settings.js'
import {
  LIBRARY_GRID_BOTTOM_PADDING,
  LIBRARY_GRID_GAP,
  LIBRARY_GRID_PADDING,
  type LibraryColumnRule,
} from '../../components/ui/library-grid.js'
import { reviewFilterBar } from '../../components/review/review-filter-bar.js'
import { useReviewFilters } from '../../components/review/use-review-filters.js'
import { useConnection } from '../../connection/ConnectionProvider.js'
import { useServer } from '../../app/ServerProvider.js'
import { useFaceReviewData } from '../../data/use-face-review.js'
import { useFaceRescoreClient } from '../../data/use-face-rescore.js'
import { useCreateIdentity, faceCropUri } from '../../data/use-face-gallery.js'
import { useFaceReviewJobs } from '../../data/use-face-review-jobs.js'
import type { FaceReviewRow } from '../../data/face-cluster-review.js'
import {
  applyFaceReviewFilters,
  activeFaceReviewFilterCount,
  faceReviewCameraOptions,
  faceReviewWindowIsPartial,
  retainSelectedFaces,
  selectedFaceRows,
  setFaceReviewDay,
  sortFaceReviewRows,
  toggleFaceSelection,
  type FaceReviewSortKey,
} from '../../data/face-review-filters.js'
import {
  suggestionApplyReadiness,
  suggestionPlanFaceCount,
} from '../../data/face-review-suggestions.js'
import { faceDeletionReadiness } from '../../data/face-review-deletion.js'
import { useConfirm, useNotice, usePrompt } from '../../components/ui/confirm.js'
import { useActivityStore } from '../../activity/activity-instance.js'
import { hasActiveJob } from '../../activity/activity-jobs.js'
import { ReviewTile } from '../../components/review/ReviewTile.js'
import { faceReviewTileContent } from '../../components/review/review-tile.js'
import { useReviewTileDisplay } from '../../components/review/use-review-tile-display.js'
import { faceInfoByRow } from './face-review-grid.js'
import { FaceReviewSelectionBar } from '../../components/faces/FaceReviewSelectionBar.js'
import { FaceReviewDetailModal } from '../../components/faces/FaceReviewDetailModal.js'
import { FaceTrackDetail, type FaceTrackTarget } from '../../components/faces/FaceTrackDetail.js'
import { faceFullPicture } from '../../data/face-full-picture.js'
import { FaceReviewAnalyzeModal } from '../../components/faces/FaceReviewAnalyzeModal.js'
import { IdentityAuditModal } from '../../components/faces/IdentityAuditModal.js'
import { IdentityPickerSheet } from '../../components/faces/IdentityPickerSheet.js'
import { hapticAction, hapticTap } from '../../lib/haptics.js'
import { EmptyState, ErrorState } from '../../components/ui/EmptyState.js'
import { refusalAwareKey } from '../../auth/forbidden.js'

const SORT_LABEL_KEY: Readonly<Record<FaceReviewSortKey, string>> = {
  certainty: 'v2.faceReview.sortByCertainty',
  date: 'v2.faceReview.sortByDate',
}

/**
 * The Library shell mounts this directly (no standalone route — this section
 * has nothing to link to yet) and its scope bar already spent the safe-area
 * inset, so the shared header below is drawn without it.
 */
export function FaceReviewScreen() {
  const { t } = useTranslation()
  const gridPadBottom = useTabScrollPadding(LIBRARY_GRID_BOTTOM_PADDING)
  const { colors } = useTheme()
  // Square tiles packed by the EVENTS column rule, at the operator's events
  // density: People reads as the events grid beside it (operator, 2026-10-22).
  const { settings } = useSettings()
  const eventsDensity = settings.events.gridDensity
  const tileDisplay = useReviewTileDisplay('faces')
  const columnRule = useMemo<LibraryColumnRule>(() => ({ kind: 'events', density: eventsDensity }), [eventsDensity])
  const grid = useLibraryGrid(columnRule)
  const { controller, state } = useConnection()
  const { token } = useServer()
  const serverUrl = controller.getSystem()?.serverUrl ?? null
  const mediaHeaders: Record<string, string> | undefined = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  )

  const enabled = state === 'connected'
  const createIdentity = useCreateIdentity()
  const jobs = useFaceReviewJobs()
  const getRescoreClient = useFaceRescoreClient()
  const rescoreActive = useActivityStore((s) => hasActiveJob(s.items, 'face-rescore'))
  const confirm = useConfirm()
  const notice = useNotice()
  const prompt = usePrompt()

  // Status, cameras and the sort are remembered on this device; the day is not.
  const { filters, setFilters, sort, setSort, hydrated: filtersRead } = useReviewFilters('faces')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [pendingFaceIds, setPendingFaceIds] = useState<ReadonlySet<string>>(new Set())
  const [detailFaceIds, setDetailFaceIds] = useState<readonly string[]>([])
  const [trackTarget, setTrackTarget] = useState<FaceTrackTarget | null>(null)
  const [analyzeOpen, setAnalyzeOpen] = useState(false)
  const [auditIdentityId, setAuditIdentityId] = useState<string | null>(null)
  // The audit used to be entered through a chip per person, a row that grew
  // with the gallery until it was unusable (operator, 2026-09-13). One button
  // now opens the searchable picker every other person-choice in this tab
  // uses.
  const [auditPickerOpen, setAuditPickerOpen] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const { rows, identities, isLoading, isError, refetch, loadMore, hasMore, isFetchingMore } = useFaceReviewData(
    enabled && filtersRead,
    filters,
    sort,
  )

  // The column rule (`library-grid.ts`), solved from the list's own measured
  // width.
  const { columns: numColumns, tileWidth } = grid
  const byId = useMemo(() => new Map(rows.map((r) => [r.faceId, r])), [rows])

  const visibleRows = useMemo(
    () => sortFaceReviewRows(applyFaceReviewFilters(rows, filters), sort),
    [rows, filters, sort],
  )

  // A selected face that a filter, an assignment or a refetch took off screen
  // must leave the count — "3 selected" pointing at 2 visible crops is the
  // count lying, and Assign would write to a face the operator cannot see.
  //
  // DERIVED, not synchronised through an effect: the stale ids simply never
  // surface, and `retainSelectedFaces` hands back the very same set when it
  // dropped nothing, so this memo is identity-stable.
  const infoByFace = useMemo(() => faceInfoByRow(visibleRows, numColumns), [visibleRows, numColumns])
  const activeSelection = useMemo(() => retainSelectedFaces(selected, visibleRows), [selected, visibleRows])

  const cameraOptions = useMemo(() => faceReviewCameraOptions(rows), [rows])
  const activeFilterCount = activeFaceReviewFilterCount(filters)
  const windowIsPartial = faceReviewWindowIsPartial(filters, hasMore)

  // "Today" (the date chip's word, the calendar's last pickable day) is pinned
  // when the operator PICKS a day, never read per render.
  const changeDay = useCallback((dayMs: number | null) => {
    setNowMs(Date.now())
    setFilters((prev) => setFaceReviewDay(prev, dayMs))
  }, [])

  const detailRows = useMemo(
    () => detailFaceIds.map((id) => byId.get(id)).filter((r): r is FaceReviewRow => r !== undefined),
    [detailFaceIds, byId],
  )
  const detailPending = detailFaceIds.some((id) => pendingFaceIds.has(id))

  /** Faces whose write is queued or running: dimmed until their job ends. */
  const markPending = useCallback((faceIds: readonly string[]) => {
    setPendingFaceIds((prev) => {
      const next = new Set(prev)
      for (const id of faceIds) next.add(id)
      return next
    })
  }, [])
  const clearPending = useCallback((faceIds: readonly string[]) => {
    setPendingFaceIds((prev) => {
      const next = new Set(prev)
      for (const id of faceIds) next.delete(id)
      return next
    })
  }, [])

  /** One person onto some faces, on the queue (the Activity centre shows the result). */
  const queueAssign = useCallback(
    (faceIds: readonly string[], identityId: string, name: string) => {
      markPending(faceIds)
      jobs.assign(faceIds, identityId, name, () => clearPending(faceIds))
    },
    [jobs, markPending, clearPending],
  )

  const closeDetail = useCallback(() => setDetailFaceIds([]), [])

  const onDetailAssign = useCallback(
    (identityId: string, name: string) => {
      const targets = detailFaceIds
      closeDetail()
      setSelected(new Set())
      setSelectionMode(false)
      queueAssign(targets, identityId, name)
    },
    [detailFaceIds, closeDetail, queueAssign],
  )

  const onDetailCreate = useCallback(
    (name: string) => {
      const targets = detailFaceIds
      closeDetail()
      setSelected(new Set())
      setSelectionMode(false)
      markPending(targets)
      jobs.assignToNewPerson(targets, name, () => clearPending(targets))
    },
    [detailFaceIds, closeDetail, jobs, markPending, clearPending],
  )

  const onConfirmSuggestion = useCallback(
    (faceId: string) => {
      const row = byId.get(faceId)
      if (row?.suggestedIdentityId === undefined || row.suggestedIdentityName === undefined) return
      queueAssign([faceId], row.suggestedIdentityId, row.suggestedIdentityName)
    },
    [byId, queueAssign],
  )

  const onOpenDetail = useCallback((faceId: string) => setDetailFaceIds([faceId]), [])

  const onToggleSelect = useCallback((faceId: string) => {
    setSelected((prev) => toggleFaceSelection(prev, faceId))
  }, [])

  const onStartSelect = useCallback((faceId: string) => {
    hapticAction()
    setSelectionMode(true)
    setSelected(new Set([faceId]))
  }, [])

  const exitSelection = useCallback(() => {
    setSelectionMode(false)
    setSelected(new Set())
  }, [])

  // The SELECTED rows, not just their ids: "Apply suggestions" needs each
  // one's own `suggestedIdentityId`, which is the whole point of the action.
  const selectionRows = useMemo(
    () => selectedFaceRows(visibleRows, activeSelection),
    [visibleRows, activeSelection],
  )
  const suggestions = useMemo(() => suggestionApplyReadiness(selectionRows), [selectionRows])
  const deletion = useMemo(() => faceDeletionReadiness(selectionRows), [selectionRows])

  const onAssignSelection = useCallback(() => {
    const targets = selectionRows.map((r) => r.faceId)
    if (targets.length === 0) return
    setDetailFaceIds(targets)
  }, [selectionRows])

  /**
   * Each selected face onto its OWN suggested person — ONE write per distinct
   * identity, never one per face, run by the queue in sequence. The plan is
   * captured up front so churn in the window cannot change what is written.
   */
  const onApplySuggestions = useCallback(() => {
    const plan = suggestions.plan
    if (!suggestions.ready || plan.length === 0) return
    const faceIds = plan.flatMap((entry) => entry.faceIds)
    exitSelection()
    markPending(faceIds)
    jobs.applySuggestions(plan, () => clearPending(faceIds))
  }, [suggestions, exitSelection, jobs, markPending, clearPending])

  /**
   * Remove the selected PARKED faces. Confirmed first, because the crop and its
   * media row go for good — `faceDeletionReadiness` has already established
   * that none of them belongs to a person, so this is the only irreversible
   * step left. The deletion itself is a queued job, and its "18 of 20" result
   * (any one face can be refused alone) is the job's summary.
   */
  const onDeleteSelection = useCallback(async () => {
    const targets = deletion.faceIds
    if (!deletion.ready || targets.length === 0) return
    const ok = await confirm({
      title: t('v2.faceReview.deleteConfirmTitle', { count: targets.length }),
      message: t('v2.faceReview.deleteConfirmBody'),
      confirmLabel: t('v2.faceReview.deleteSelected'),
      cancelLabel: t('v2.settings.cancel'),
      destructive: true,
    })
    if (!ok) return
    exitSelection()
    markPending(targets)
    jobs.deleteFaces(targets, () => clearPending(targets))
  }, [deletion, confirm, t, exitSelection, jobs, markPending, clearPending])

  /**
   * The face detail's bin: ONE parked face, confirmed like the selection bar's
   * Delete and run by the same queued job, whose mutation invalidates the
   * People queries — the detail closes and the grid refetches without it.
   */
  const onDetailDelete = useCallback(
    async (faceId: string) => {
      const ok = await confirm({
        title: t('v2.faceReview.deleteOneConfirmTitle'),
        message: t('v2.faceReview.deleteConfirmBody'),
        confirmLabel: t('v2.faceReview.deleteOne'),
        cancelLabel: t('v2.settings.cancel'),
        destructive: true,
      })
      if (!ok) return
      closeDetail()
      markPending([faceId])
      jobs.deleteFaces([faceId], () => clearPending([faceId]))
    },
    [confirm, t, closeDetail, jobs, markPending, clearPending],
  )

  /** "Open event": the face detail closes and the track's own detail opens. */
  const onDetailOpenTrack = useCallback(
    (row: FaceReviewRow) => {
      closeDetail()
      setTrackTarget({ deviceId: row.deviceId, trackId: row.trackId, cameraName: row.cameraName ?? `#${String(row.deviceId)}` })
    },
    [closeDetail],
  )
  const closeTrack = useCallback(() => setTrackTarget(null), [])

  /**
   * Add a person, from the review tab, with no face in hand.
   *
   * There was no way to do this here at all: an identity could only be minted
   * as a side effect of assigning a face to it (the detail modal's create row),
   * and the Analyze modal deliberately cannot create one — a typo there used to
   * fork a gallery in two. So a gallery could not be prepared before a review
   * pass, only during one. This is the missing door, and it writes through the
   * same `createIdentity` mutation, which invalidates the identity list so every
   * picker in the tab sees the new person immediately. It is one quick call,
   * so it stays inline: a failure is a notice, success is the new person
   * showing up in the pickers.
   */
  const onCreatePerson = useCallback(async () => {
    const name = await prompt({
      title: t('v2.faceReview.newPersonTitle'),
      placeholder: t('v2.tracks.newPersonPlaceholder'),
      submitLabel: t('v2.faceReview.newPersonButton'),
      cancelLabel: t('v2.settings.cancel'),
    })
    const trimmed = name?.trim() ?? ''
    if (trimmed.length === 0) return
    try {
      await createIdentity.mutateAsync({ name: trimmed })
    } catch (err: unknown) {
      log.error('face-assign', 'creating a person from the review tab threw', {
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      })
      notice({ title: t('v2.faceReview.newPersonButton'), message: t(refusalAwareKey(err, 'v2.faceReview.newPersonFailed')) })
    }
  }, [prompt, t, createIdentity, notice])

  // Recompute every suggestion: a job on the queue. A hub without
  // `face.rescoreAll` falls back to probing the rows on screen.
  const onRecompute = useCallback(() => {
    const targets = visibleRows
      .filter((r) => r.status !== 'assigned')
      .map((r) => ({ deviceId: r.deviceId, trackId: r.trackId }))
    jobs.recompute(targets)
  }, [visibleRows, jobs])

  // Reopening the tab while a hub-side recompute runs and nothing here follows
  // it (the app was restarted): follow it again.
  useEffect(() => {
    if (!enabled) return
    const client = getRescoreClient()
    if (!client) return
    let cancelled = false
    void (async () => {
      try {
        const status = await client.rescoreStatus()
        if (cancelled || status.state !== 'running') return
        if (hasActiveJob(useActivityStore.getState().items, 'face-rescore')) return
        jobs.followRunningRecompute()
      } catch {
        // Old hub or transient error: nothing to resume.
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  const unassignedLabel = t('v2.faceReview.filterUnassigned')
  const confirmLabel = t('v2.faceReview.assign')
  const renderItem = useCallback(
    ({ item }: { item: FaceReviewRow }) => (
      <ReviewTile
        content={faceReviewTileContent(item, unassignedLabel)}
        display={tileDisplay.display}
        width={tileWidth}
        cropUri={faceCropUri(item, serverUrl)}
        info={infoByFace.get(item.faceId) ?? true}
        mediaHeaders={mediaHeaders}
        pending={pendingFaceIds.has(item.faceId)}
        selectionMode={selectionMode}
        selected={activeSelection.has(item.faceId)}
        confirmLabel={confirmLabel}
        onToggleSelect={onToggleSelect}
        onStartSelect={onStartSelect}
        onOpenDetail={onOpenDetail}
        onConfirm={onConfirmSuggestion}
        testIDPrefix="face-cell"
      />
    ),
    [tileDisplay.display, unassignedLabel, confirmLabel, tileWidth, serverUrl, infoByFace, mediaHeaders, pendingFaceIds, selectionMode, activeSelection, onToggleSelect, onStartSelect, onOpenDetail, onConfirmSuggestion],
  )

  // The `⋯` menu — one meaning per item id across the review pages.
  const overflowItems: readonly OverflowMenuItem[] = [
    {
      id: 'select',
      icon: CheckSquare,
      label: selectionMode ? t('v2.faceReview.selectDone') : t('v2.faceReview.selectButton'),
      onPress: () => (selectionMode ? exitSelection() : setSelectionMode(true)),
      testID: 'face-review-action-select',
    },
    {
      id: 'similar',
      icon: Sparkles,
      label: t('v2.faceReview.analyzeButton'),
      onPress: () => setAnalyzeOpen(true),
      testID: 'face-review-action-similar',
    },
    {
      id: 'recompute',
      icon: RefreshCw,
      label: t('v2.faceReview.recomputeButton'),
      onPress: onRecompute,
      disabled: rescoreActive,
      testID: 'face-review-action-recompute',
    },
    // Re-analyse ONE person's enrolled samples, chosen through the same
    // searchable picker every other person-choice in this tab uses — the panel
    // ends in a Remove button, which should never be one tap from a list
    // nobody chose.
    ...(identities.length > 0
      ? [
          {
            id: 'audit',
            icon: ScanFace,
            label: t('v2.faceReview.auditOpenButton'),
            onPress: () => {
              hapticTap()
              setAuditPickerOpen(true)
            },
            testID: 'face-review-action-audit',
          },
        ]
      : []),
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
    displayTestID: 'face-review-display',
  })

  // Fixed block under the scope bar: ONE row of chips with the eye, the `⋯`
  // menu (same item ids and meanings as the Plates page) and the primary "+"
  // at its end, then the count. It sits outside the list, so nothing above the
  // grid moves when an action runs.
  const top = (
    <View>
      <LibraryFilterBar
        date={filterBar.date}
        tools={[filterBar.display]}
        filters={filterBar.filters}
        onReset={filterBar.onReset}
        more={overflowItems}
        moreTestID="face-review-action-more"
        primary={{
          id: 'new-person',
          icon: UserRoundPlus,
          label: t('v2.faceReview.newPersonButton'),
          onPress: () => {
            void onCreatePerson()
          },
          testID: 'face-review-action-new-person',
        }}
        summary={isLoading || (!enabled && visibleRows.length === 0) ? ' ' : t('v2.faceReview.visibleCount', { count: visibleRows.length })}
        summaryTestID="face-review-count"
        testID="face-review-filter-bar"
      />

      {selectionMode ? (
        <FaceReviewSelectionBar
          selectedCount={activeSelection.size}
          suggestions={suggestions}
          deletion={deletion}
          onCancel={exitSelection}
          onAssign={onAssignSelection}
          onApplySuggestions={() => { void onApplySuggestions() }}
          onDelete={() => { void onDeleteSelection() }}
        />
      ) : null}

      {windowIsPartial ? (
        <Text style={[styles.partialHint, { color: colors.foregroundMuted }]}>
          {t('v2.faceReview.partialWindowHint', { count: rows.length })}
        </Text>
      ) : null}
    </View>
  )

  let listBody: React.ReactElement | null
  if (!enabled && visibleRows.length === 0) {
    // Not connected and nothing cached: an unanswered question, not an empty
    // gallery. The hub-status overlay at the app root says why.
    listBody = null
  } else if (isLoading) {
    listBody = (
      <Centered>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{t('v2.faceReview.loading')}</Text>
      </Centered>
    )
  } else if (isError) {
    listBody = <ErrorState title={t('v2.faceReview.loadError')} onRetry={() => { void refetch() }} />
  } else if (activeFilterCount > 0) {
    listBody = (
      <EmptyState
        icon={SearchX}
        title={t('v2.faceReview.emptyFiltered')}
        action={{ label: t('common.reset'), onPress: filterBar.onReset }}
      />
    )
  } else {
    listBody = <EmptyState icon={ScanFace} title={t('v2.faceReview.empty')} />
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }} onLayout={grid.onLayout}>
      {top}

      <FlatList
        key={`cols-${String(numColumns)}`}
        data={visibleRows}
        keyExtractor={(item) => item.faceId}
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
        onEndReached={hasMore ? loadMore : undefined}
        onEndReachedThreshold={0.4}
        refreshing={false}
        onRefresh={() => { void refetch() }}
      />

      <FaceReviewDetailModal
        rows={detailRows}
        identities={identities}
        cropUriFor={(row) => faceCropUri(row, serverUrl)}
        mediaHeaders={mediaHeaders}
        pending={detailPending}
        onAssign={onDetailAssign}
        onCreate={onDetailCreate}
        fullPictureFor={(row) => faceFullPicture(row, serverUrl)}
        onOpenTrack={onDetailOpenTrack}
        onDelete={(faceId) => { void onDetailDelete(faceId) }}
        onClose={closeDetail}
      />

      <FaceTrackDetail target={trackTarget} onClose={closeTrack} />

      <IdentityPickerSheet
        open={auditPickerOpen}
        title={t('v2.faceReview.auditPickTitle')}
        identities={identities}
        serverUrl={serverUrl}
        mediaHeaders={mediaHeaders}
        onPick={(person) => {
          setAuditPickerOpen(false)
          setAuditIdentityId(person.id)
        }}
        onClose={() => setAuditPickerOpen(false)}
      />

      <IdentityAuditModal
        identityId={auditIdentityId}
        serverUrl={serverUrl}
        mediaHeaders={mediaHeaders}
        onClose={() => setAuditIdentityId(null)}
      />

      <FaceReviewAnalyzeModal
        open={analyzeOpen}
        connected={enabled}
        identities={identities}
        serverUrl={serverUrl}
        mediaHeaders={mediaHeaders}
        onClose={() => setAnalyzeOpen(false)}
      />
    </View>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', justifyContent: 'center', padding: SPACING['2xl'], gap: SPACING.md },
  partialHint: { fontSize: 11, paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm },
  footerLoading: { paddingVertical: SPACING.md, alignItems: 'center' },
  row: { gap: LIBRARY_GRID_GAP, paddingHorizontal: LIBRARY_GRID_PADDING },
  gridContent: { paddingVertical: SPACING.sm, gap: LIBRARY_GRID_GAP, flexGrow: 1 },
})
