/**
 * FaceReviewAnalyzeModal — "Similar groups". The one place in the review tab
 * where look-alike CLUSTERING drives the UI (`suggestFaceClusters`) — explicit
 * here, unlike the main grid, that a row represents a GROUP: one row per
 * cluster, its member crops as a grid, and one KNOWN PERSON chosen for the
 * whole group.
 *
 * ## What the button actually analyses
 *
 * The newest `ANALYZE_POOL_SIZE` unassigned faces, and that ONE window is both
 * what `useUnassignedFacesPool` fetches and what the hub is told to cluster
 * (`maxFacesScanned`). It used to be two windows — a pool of 100 against a
 * sweep of 1 000 — and `restrictClustersToPool` silently dropped every group
 * that did not fit the narrow one, which is why the modal went quiet after the
 * first batch (operator, 2026-09-13). See `use-face-review.ts`'s
 * `ANALYZE_POOL_SIZE` for the whole story and the spec that pins it.
 *
 * The button no longer names a number: the window is an implementation detail
 * that has already moved once, and a label carrying its own "100" outlives it.
 *
 * What the operator SEES is smaller than the window, and that is the honest gap
 * the header states instead of hiding: only faces that land in a look-alike
 * group of ≥ 2 can be acted on here. The rest of the pool is analysed and
 * yields nothing — correctly, because a group of one is not a batch.
 *
 * ## Choosing the person (changed 2026-09-01)
 *
 * There is NO free-text field any more, and this modal can no longer create an
 * identity. It used to resolve a typed name against the saved identities and
 * mint a new person when nothing matched — so one typo silently forked
 * somebody's gallery in two. A group is now assigned by PICKING a known
 * person; a new person is created elsewhere, before coming here.
 *
 * The clustering's majority vote survives as a PRE-SELECTION
 * (`seedAnalyzeIdentitySelection` over `proposedIdentityId`), and only when it
 * names a person the gallery actually holds. A group nobody has chosen for is
 * simply not written (`buildAnalyzeAssignPlan`).
 *
 * ## Excluding a face before committing
 *
 * Clustering is a suggestion, and a group of 9 crops routinely contains one
 * stranger. Every member is on screen at once in `AnalyzeGroupCard`'s grid and
 * one tap strikes it out of the write (`toggleGroupFaceExclusion`); the plan is
 * rebuilt from the survivors (`buildAnalyzeAssignPlan`), so an excluded face is
 * never assigned and the counts in the header, the confirm dialog and the
 * result banner all move together.
 *
 * Scope is trimmed to the pool by `restrictClustersToPool` — a cluster member
 * the operator cannot see must not be silently adoptable, mirroring the
 * admin-ui `SimilarGroupsModal`'s rule.
 *
 * Confirm / Cancel gate a SINGLE batch write: every group with a chosen person
 * and at least one surviving member is assigned in one pass, all fired from the
 * ONE Confirm tap — never incrementally as choices are made.
 *
 * ## What the write has to invalidate (fixed 2026-09-01)
 *
 * The operator reported that assigning here brought the same groups with the
 * same faces straight back, refresh after refresh. The write was never the
 * problem: called by hand with this exact payload, the hub answered
 * `{assigned:1, failed:[]}` and dropped the face from both `listRecentFaces
 * {filter:'unassigned'}` and `suggestFaceClusters` on the next call.
 *
 * What was missing is on this side. This modal's two queries live under keys
 * (`face-review-analyze-pool`, `face-review-clusters`) that the assignment
 * mutation did not invalidate, both with a 30 s `staleTime`, and the screen's
 * `onAssigned` refetch reaches only the main grid — so no button the operator
 * could press made either query ask the hub again, and the modal re-served its
 * own cache. Both keys now live in `data/face-query-keys.ts` and are covered
 * by `invalidateFaceAssignmentQueries`; a new face query that does not is the
 * same bug (guarded: `data/__tests__/face-query-keys.spec.ts`).
 *
 * ## A refused group SAYS SO
 *
 * `assignFaces` refuses per face — most often the hub's enrolment promiscuity
 * gate ("the embedding is ambiguous; pick a clearer crop") — and can also
 * reject a whole call. Both are work being dropped and both are reported with
 * the hub's own words. The per-group `catch` used to be EMPTY: a batch the hub
 * rejected outright read as "0 assigned" with no reason on screen and none in
 * any log.
 *
 * ## Confirm queues the write and closes (2026-10-18)
 *
 * The write is a JOB on the Activity centre's local queue (`analyzeAssignJob`):
 * Confirm hands it over and the modal closes at once, so the operator is back on
 * the page while the groups are assigned one after another, with per-face
 * progress and the result (or the hub's refusal) in the Activity centre. The
 * result and refusal banners that used to sit in this modal are gone with it.
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  type ListRenderItemInfo,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Sparkles, X } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { SheetModal } from '../ui/SheetModal.js'
import { useConfirm } from '../ui/confirm.js'
import { AnalyzeGroupCard } from './AnalyzeGroupCard.js'
import { IdentityPickerSheet } from './IdentityPickerSheet.js'
import { faceCropUri, type PersonIdentity } from '../../data/use-face-gallery.js'
import { useFaceReviewJobs } from '../../data/use-face-review-jobs.js'
import { useSuggestFaceClusters, useUnassignedFacesPool } from '../../data/use-face-review.js'
import {
  analyzeCoverage,
  buildAnalyzeAssignPlan,
  buildAnalyzeGroupRows,
  restrictClustersToPool,
  seedAnalyzeIdentitySelection,
  setAnalyzeGroupIdentity,
  toggleGroupFaceExclusion,
  type AnalyzeGroupMember,
  type AnalyzeGroupRow,
} from '../../data/face-cluster-review.js'
import { SheetHeader } from '../ui/SheetHeader.js'

const MIN_CLUSTER_SIZE = 2

export interface FaceReviewAnalyzeModalProps {
  readonly open: boolean
  /** Hub connection — clustering only fires while BOTH this and `open` hold. */
  readonly connected: boolean
  readonly identities: readonly PersonIdentity[]
  readonly serverUrl: string | null
  readonly mediaHeaders: Record<string, string> | undefined
  readonly onClose: () => void
}

export const FaceReviewAnalyzeModal = memo(function FaceReviewAnalyzeModal({
  open,
  connected,
  identities,
  serverUrl,
  mediaHeaders,
  onClose,
}: FaceReviewAnalyzeModalProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const insets = useSafeAreaInsets()
  const enabled = open && connected

  const pool = useUnassignedFacesPool(enabled)
  const clusters = useSuggestFaceClusters(enabled)
  const jobs = useFaceReviewJobs()

  // Which group's person picker is open, by representative face id. The SHEET
  // lives here rather than in the card: the card is held to one piece of state
  // by its own spec, and one sheet over the list is one sheet, not one per
  // group.
  const [pickerForGroup, setPickerForGroup] = useState<string | null>(null)
  const [selection, setSelection] = useState<ReadonlyMap<string, string>>(new Map())
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())

  const facesById = useMemo(() => new Map((pool.data ?? []).map((f) => [f.faceId, f])), [pool.data])
  const identityNameById = useMemo(() => new Map(identities.map((i) => [i.id, i.name])), [identities])
  const poolIds = useMemo(() => new Set(facesById.keys()), [facesById])

  const groups = useMemo(() => {
    const restricted = restrictClustersToPool(clusters.data ?? [], poolIds, MIN_CLUSTER_SIZE)
    return buildAnalyzeGroupRows(restricted, facesById, identityNameById)
  }, [clusters.data, poolIds, facesById, identityNameById])

  // Re-seed the per-group person and drop every exclusion whenever the group
  // SET changes (a re-analysis can change membership under the same
  // representativeFaceId key) — a stale choice or a stale ✕ must never survive
  // that, the same rule the admin-ui modal applies to its own exclusions.
  useEffect(() => {
    setSelection(seedAnalyzeIdentitySelection(groups))
    setExcluded(new Set())
  }, [groups])

  const pickIdentity = useCallback((repId: string, identityId: string) => {
    setSelection((prev) => setAnalyzeGroupIdentity(prev, repId, identityId))
    setPickerForGroup(null)
  }, [])

  const toggleExclusion = useCallback((faceId: string) => {
    setExcluded((prev) => toggleGroupFaceExclusion(prev, faceId))
  }, [])

  const plan = useMemo(() => buildAnalyzeAssignPlan(groups, selection, excluded), [groups, selection, excluded])
  const coverage = useMemo(
    () => analyzeCoverage(groups, pool.data?.length ?? 0, excluded),
    [groups, pool.data, excluded],
  )

  const cropUriFor = useCallback(
    (member: AnalyzeGroupMember) => faceCropUri(member, serverUrl),
    [serverUrl],
  )

  const handleClose = onClose

  // Hands the plan to the queue and leaves: the write runs after whatever is
  // already queued, and reports in the Activity centre.
  const runConfirm = useCallback(() => {
    jobs.analyzeAssign(plan)
    handleClose()
  }, [plan, jobs, handleClose])

  const confirmAndRun = useCallback(() => {
    if (plan.length === 0) return
    const faceCount = plan.reduce((sum, e) => sum + e.faceIds.length, 0)
    void (async (): Promise<void> => {
      const ok = await confirm({
        title: t('v2.faceReview.confirmAssignTitle'),
        message: t('v2.faceReview.analyzeConfirmBody', { count: faceCount, groups: plan.length }),
        confirmLabel: t('v2.faceReview.assign'),
        cancelLabel: t('v2.settings.cancel'),
      })
      if (!ok) return
      runConfirm()
    })()
  }, [plan, t, confirm, runConfirm])

  const renderGroup = useCallback(
    ({ item }: ListRenderItemInfo<AnalyzeGroupRow>) => {
      const chosen = selection.get(item.representativeFaceId)
      return (
        <AnalyzeGroupCard
          group={item}
          selectedIdentityId={chosen}
          selectedIdentityName={chosen === undefined ? undefined : identityNameById.get(chosen)}
          excluded={excluded}
          cropUriFor={cropUriFor}
          mediaHeaders={mediaHeaders}
          disabled={false}
          onToggleMember={toggleExclusion}
          onOpenPicker={() => setPickerForGroup(item.representativeFaceId)}
        />
      )
    },
    [identityNameById, selection, excluded, cropUriFor, mediaHeaders, toggleExclusion],
  )

  const loading = pool.isLoading || clusters.isLoading

  return (
    <SheetModal
      visible={open}
      onClose={handleClose}
      scrimColor="transparent"
      sheetStyle={[
        styles.sheet,
        { backgroundColor: colors.backgroundElevated, paddingBottom: insets.bottom + SPACING.md },
      ]}
    >
      <SheetHeader icon={Sparkles} title={t('v2.faceReview.analyzeModalTitle')} onClose={handleClose} />

      {/* The honest scope. `pool` is what was actually fetched (< the
          requested window when the hub holds fewer unassigned faces), and
          `grouped` is how many of those can be acted on here. */}
      {!loading ? (
        <Text style={[styles.coverage, { color: colors.foregroundMuted }]}>
          {t('v2.faceReview.analyzeCoverage', {
            grouped: coverage.grouped,
            pool: coverage.pool,
            groups: coverage.groups,
          })}
        </Text>
      ) : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{t('v2.faceReview.analyzeLoading')}</Text>
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{t('v2.faceReview.analyzeEmpty')}</Text>
        </View>
      ) : (
        <FlatList data={groups} keyExtractor={(g) => g.representativeFaceId} renderItem={renderGroup} style={styles.list} />
      )}

      {/* ONE picker over the whole list — searchable, and deliberately
          WITHOUT `onCreate`: this modal must not be able to mint an
          identity (see the header). */}
      <IdentityPickerSheet
        open={pickerForGroup !== null}
        title={t('v2.faceReview.groupPickPerson')}
        identities={identities}
        selectedIdentityId={pickerForGroup === null ? undefined : selection.get(pickerForGroup)}
        serverUrl={serverUrl}
        mediaHeaders={mediaHeaders}
        onPick={(person) => {
          if (pickerForGroup !== null) pickIdentity(pickerForGroup, person.id)
        }}
        onClose={() => setPickerForGroup(null)}
      />

      <View style={styles.footer}>
        <Pressable onPress={handleClose} style={styles.cancelBtn}>
          <Text style={[styles.cancelBtnText, { color: colors.foregroundMuted }]}>{t('v2.settings.cancel')}</Text>
        </Pressable>
        <Pressable
          onPress={confirmAndRun}
          disabled={plan.length === 0}
          style={[
            styles.confirmBtn,
            { backgroundColor: colors.primary, opacity: plan.length === 0 ? 0.5 : 1 },
          ]}
        >
          <Text style={[styles.confirmBtnText, { color: colors.primaryForeground }]}>{t('v2.faceReview.assign')}</Text>
        </Pressable>
      </View>
    </SheetModal>
  )
})

const styles = StyleSheet.create({
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  coverage: { fontSize: 11, fontWeight: '600', paddingBottom: SPACING.sm },
  centered: { alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, paddingVertical: SPACING['2xl'] },
  list: { flexGrow: 0 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.sm, paddingVertical: SPACING.sm },
  cancelBtn: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  cancelBtnText: { fontSize: 13, fontWeight: '600' },
  confirmBtn: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, minWidth: 80, alignItems: 'center' },
  confirmBtnText: { fontSize: 13, fontWeight: '700' },
})
