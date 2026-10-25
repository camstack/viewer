/**
 * FaceAssignSheet — slide-up picker that associates a detected FACE with a
 * person (face-gallery identity): tap an existing person to assign, or type a
 * name and "Create & assign" to mint a new identity first. Driven entirely by
 * the `use-face-gallery` hooks; on success the face/persons queries invalidate
 * so the track detail re-renders with the recognized name.
 *
 * Every mutation here is a multi-second round trip (the write, two query
 * invalidations AND an embed reload ride `mutateAsync` before it resolves), so
 * each action names itself while it runs: `pendingAction` records WHICH control
 * the operator pressed, and that one control swaps its icon for an inline
 * `ActivityIndicator` (the app's pending idiom) while every other control dims
 * and disables. `disabled` alone was invisible — the operator's report was
 * literally "no loader appears when I assign a face": a tapped person row
 * changed nothing on screen until the sheet closed. Errors were already loud
 * (inline text, never silence); this adds the missing pending half.
 */
import React, { memo, useCallback, useMemo, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useConfirm } from '../../ui/confirm.js'
import { log } from '../../../lib/logger.js'
import { useTranslation } from 'react-i18next'
import {
  X,
  UserRound,
  UserRoundPlus,
  UserRoundX,
  Users,
  Check,
  RefreshCw,
  Sparkles,
} from '../../../lib/icons.js'
import { Image } from 'expo-image'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { SheetModal } from '../../ui/SheetModal.js'
import { FaceConfidenceBadge } from '../../ui/FaceConfidenceBadge.js'
import { FaceSuggestionRow } from '../../ui/FaceSuggestionRow.js'
import {
  useIdentities,
  useAssignFace,
  useUnassignFace,
  useUnassignAllForIdentity,
  useCreateIdentity,
  faceHasPerson,
  faceCropUri,
  identityCoverUri,
  type TrackFace,
  type PersonIdentity,
} from '../../../data/use-face-gallery.js'
import { useServer } from '../../../app/ServerProvider.js'
import { useConnection } from '../../../connection/ConnectionProvider.js'
import { mediaImageSource } from '../../../data/track-media-uri.js'
import { useFaceRescore } from '../../../data/use-face-rescore.js'
import {
  formatRescoreScore,
  rescoreRowTone,
  rescoreVerdictKey,
  rescoreVerdictTone,
  shouldOfferReembed,
  type FaceRescoreIdentityRow,
  type FaceRescoreParams,
  type FaceRescoreReport,
  type FaceRescoreRowTone,
} from '../../../data/face-rescore.js'
import { SectionLabel } from '../../ui/SectionLabel.js'
import { SheetHeader } from '../../ui/SheetHeader.js'
import { refusalAwareKey } from '../../../auth/forbidden.js'

export interface FaceAssignSheetProps {
  /** The face to assign; null hides the sheet. */
  readonly face: TrackFace | null
  readonly onClose: () => void
}

/** WHICH control's mutation is in flight — that one wears the spinner, the
 *  rest only dim. Null when nothing runs. */
type FaceSheetPendingAction =
  | { readonly kind: 'assign'; readonly identityId: string }
  | { readonly kind: 'create' }
  | { readonly kind: 'unassign' }
  | { readonly kind: 'unassignAll' }
  /** The recompute — arithmetic over the persisted vector; the hub also
   *  persists the fresh suggestion server-side (never an assignment). */
  | { readonly kind: 'rescore' }
  /** The recompute that first re-embeds the crop — runs inference on a node. */
  | { readonly kind: 'reembed' }
  | null

export const FaceAssignSheet = memo(function FaceAssignSheet({ face, onClose }: FaceAssignSheetProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const insets = useSafeAreaInsets()
  const { token } = useServer()
  const { controller } = useConnection()
  const serverUrl = controller.getSystem()?.serverUrl ?? null
  const mediaHeaders: Record<string, string> | undefined = token
    ? { Authorization: `Bearer ${token}` }
    : undefined
  const cropUri = face !== null ? faceCropUri(face, serverUrl) : null

  const visible = face !== null
  const { data: persons = [], isLoading } = useIdentities(visible)
  const assign = useAssignFace()
  const unassign = useUnassignFace()
  const unassignAll = useUnassignAllForIdentity()
  const createPerson = useCreateIdentity()

  const rescore = useFaceRescore()

  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<FaceSheetPendingAction>(null)
  const [report, setReport] = useState<FaceRescoreReport | null>(null)
  const busy =
    assign.isPending ||
    unassign.isPending ||
    unassignAll.isPending ||
    createPerson.isPending ||
    rescore.isPending

  // A report belongs to ONE face. The sheet is reused for the next track
  // without unmounting, so a report kept across that swap would show track A's
  // percentages beside track B's crop — the single worst thing this feature
  // could do, since the operator would act on it.
  const reportForThisFace = report !== null && report.faceId === face?.faceId ? report : null

  const close = useCallback((): void => {
    setNewName('')
    setError(null)
    setReport(null)
    onClose()
  }, [onClose])

  /**
   * Ask the hub to score this face against the gallery AS IT IS NOW.
   *
   * `reembed` is passed through explicitly and defaults to false — the plain
   * recompute is pure arithmetic over a persisted vector, while the re-embed
   * spends a node round-trip and rewrites the face row. See
   * `data/face-rescore.ts` for why the number already on the track is stale.
   */
  const runRescore = useCallback(
    async (reembed: boolean): Promise<void> => {
      if (!face || busy) return
      setError(null)
      setPendingAction({ kind: reembed ? 'reembed' : 'rescore' })
      try {
        const result = await rescore.mutateAsync({
          deviceId: face.deviceId,
          trackId: face.trackId,
          reembed,
        })
        setReport(result)
      } catch (err: unknown) {
        log.error('face-assign', 'rescore threw', {
          deviceId: face.deviceId,
          trackId: face.trackId,
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        })
        setError(t(refusalAwareKey(err, 'v2.tracks.rescore.failed')))
      } finally {
        setPendingAction(null)
      }
    },
    [face, busy, rescore, t],
  )

  /** identityId → its fresh row, so the people list can wear the new numbers
   *  instead of the sheet growing a second, competing list. */
  const scoreByIdentity = useMemo((): ReadonlyMap<string, FaceRescoreIdentityRow> => {
    if (reportForThisFace === null) return new Map()
    return new Map(reportForThisFace.identities.map((r) => [r.identityId, r]))
  }, [reportForThisFace])

  /** Best-first once scored — the operator's next tap is almost always the top
   *  row, and leaving it in alphabetical order hides the answer they asked for. */
  const orderedPersons = useMemo((): readonly PersonIdentity[] => {
    if (scoreByIdentity.size === 0) return persons
    return [...persons].sort(
      (a, b) =>
        (scoreByIdentity.get(b.id)?.score ?? Number.NEGATIVE_INFINITY) -
        (scoreByIdentity.get(a.id)?.score ?? Number.NEGATIVE_INFINITY),
    )
  }, [persons, scoreByIdentity])

  const assignTo = useCallback(
    async (identityId: string): Promise<void> => {
      if (!face || busy) return
      setError(null)
      setPendingAction({ kind: 'assign', identityId })
      try {
        await assign.mutateAsync({ faceId: face.faceId, identityId })
        close()
      } catch (err: unknown) {
        // An empty catch here is why "impossibile assegnare una faccia"
        // arrived with no evidence at all (D436).
        log.error('face-assign', 'assigning the face threw', {
          faceId: face.faceId,
          identityId,
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        })
        setError(t(refusalAwareKey(err, 'v2.tracks.assignFailed')))
      } finally {
        setPendingAction(null)
      }
    },
    [face, busy, assign, close, t],
  )

  const doUnassign = useCallback(async (): Promise<void> => {
    if (!face || busy) return
    setError(null)
    setPendingAction({ kind: 'unassign' })
    try {
      await unassign.mutateAsync({ faceId: face.faceId })
      close()
    } catch (err: unknown) {
      log.error('face-assign', 'unassigning the face threw', {
          faceId: face.faceId,
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      })
      setError(t(refusalAwareKey(err, 'v2.tracks.disassociateFailed')))
    } finally {
      setPendingAction(null)
    }
  }, [face, busy, unassign, close, t])

  // Destructive: confirm before removing the person from this face.
  const confirmUnassign = useCallback((): void => {
    if (!face || busy) return
    void (async (): Promise<void> => {
      const ok = await confirm({
        title: t('v2.tracks.removePersonConfirmTitle'),
        message: t('v2.tracks.removePersonConfirmBody'),
        confirmLabel: t('v2.tracks.removePerson'),
        cancelLabel: t('v2.settings.cancel'),
        destructive: true,
      })
      if (!ok) return
      await doUnassign()
    })()
  }, [face, busy, doUnassign, t, confirm])

  // Disassociate this face's person from EVERY event — detaches all faces the
  // identity is linked to, not just this one. The person is preserved.
  const doUnassignAll = useCallback(async (): Promise<void> => {
    const identityId = face?.identityId
    if (!face || identityId === undefined || busy) return
    setError(null)
    setPendingAction({ kind: 'unassignAll' })
    try {
      await unassignAll.mutateAsync({ identityId })
      close()
    } catch (err: unknown) {
      log.error('face-assign', 'detaching every face of the person threw', {
          identityId,
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      })
      setError(t(refusalAwareKey(err, 'v2.tracks.disassociateAllFailed')))
    } finally {
      setPendingAction(null)
    }
  }, [face, busy, unassignAll, close, t])

  const confirmUnassignAll = useCallback((): void => {
    const identityId = face?.identityId
    if (!face || identityId === undefined || busy) return
    void (async (): Promise<void> => {
      const ok = await confirm({
        title: t('v2.tracks.removePersonAllConfirmTitle'),
        message: t('v2.tracks.removePersonAllConfirmBody'),
        confirmLabel: t('v2.tracks.removePersonAll'),
        cancelLabel: t('v2.settings.cancel'),
        destructive: true,
      })
      if (!ok) return
      await doUnassignAll()
    })()
  }, [face, busy, doUnassignAll, t, confirm])

  const createAndAssign = useCallback(async (): Promise<void> => {
    const name = newName.trim()
    if (!face || busy || name.length === 0) return
    setError(null)
    setPendingAction({ kind: 'create' })
    try {
      const person = await createPerson.mutateAsync({ name })
      await assign.mutateAsync({ faceId: face.faceId, identityId: person.id })
      close()
    } catch (err: unknown) {
      log.error('face-assign', 'creating the person or assigning to it threw', {
          faceId: face.faceId,
          name,
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      })
      setError(t(refusalAwareKey(err, 'v2.tracks.assignFailed')))
    } finally {
      setPendingAction(null)
    }
  }, [face, busy, newName, createPerson, assign, close, t])

  return (
    <SheetModal
      visible={visible}
      onClose={close}
      sheetStyle={[styles.sheet, { backgroundColor: colors.backgroundElevated }]}
    >
      <SheetHeader
        title={t('v2.tracks.assignFaceTitle')}
        onClose={close}
      />

      {/* The face being assigned. */}
      {face !== null && cropUri ? (
        <View style={styles.faceRow}>
          <Image
            source={mediaImageSource(cropUri, mediaHeaders)}
            style={[styles.faceCrop, { backgroundColor: colors.surface }]}
            contentFit="cover"
          />
          <View style={styles.faceHintCol}>
            <Text style={[styles.faceHint, { color: colors.foregroundMuted }]}>
              {face.identityName ?? t('v2.tracks.notAssigned')}
            </Text>
            {/* Auto-assigned (recognizer pick) → confidence badge; manual /
                legacy rows carry no score and the badge self-hides. */}
            {faceHasPerson(face.identityId) && !face.assigned ? (
              <FaceConfidenceBadge score={face.bestMatchScore} px={face.nativeFaceShortSidePx} />
            ) : null}
          </View>
          {/* Disassociate — whenever the face has a linked person, whether
              PRE-ASSIGNED by the recognizer (`assigned` false) or manually
              assigned. Gating on `assigned` alone hid this for auto rows,
              forcing a reassign-then-remove; gate on the identity instead. */}
          {faceHasPerson(face.identityId) ? (
            <Pressable
              onPress={confirmUnassign}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('v2.tracks.removePerson')}
              style={[
                styles.removeBtn,
                {
                  backgroundColor: colors.danger + '22',
                  opacity: busy && pendingAction?.kind !== 'unassign' ? 0.5 : 1,
                },
              ]}
            >
              {pendingAction?.kind === 'unassign' ? (
                <ActivityIndicator size="small" color={colors.danger} />
              ) : (
                <UserRoundX size={16} color={colors.danger} />
              )}
              <Text style={[styles.removeBtnText, { color: colors.danger }]}>
                {t('v2.tracks.removePerson')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Recognizer suggested a person but wasn't confident enough to assign
          → confirm (same assignFace as a manual pick) or dismiss (local).
          Self-hides when the face has a person / no suggestion / dismissed. */}
      {face !== null ? (
        <FaceSuggestionRow
          faceId={face.faceId}
          hasPerson={faceHasPerson(face.identityId)}
          suggestedIdentityId={face.suggestedIdentityId}
          suggestedMatchScore={face.suggestedMatchScore}
          identities={persons}
          onConfirm={(identityId) => { void assignTo(identityId) }}
          busy={busy}
          pending={
            pendingAction?.kind === 'assign' &&
            pendingAction.identityId === face.suggestedIdentityId
          }
        />
      ) : null}

      {/* Disassociate this person from ALL events — detaches every face the
          identity is linked to, not just this one. Shown whenever the face
          has a person (auto-recognized OR manual), independent of a crop. */}
      {faceHasPerson(face?.identityId) ? (
        <Pressable
          onPress={confirmUnassignAll}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('v2.tracks.removePersonAll')}
          style={[
            styles.removeAllBtn,
            {
              borderColor: colors.danger,
              opacity: busy && pendingAction?.kind !== 'unassignAll' ? 0.5 : 1,
            },
          ]}
        >
          {pendingAction?.kind === 'unassignAll' ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <Users size={16} color={colors.danger} />
          )}
          <Text style={[styles.removeAllBtnText, { color: colors.danger }]}>
            {t('v2.tracks.removePersonAll')}
          </Text>
        </Pressable>
      ) : null}

      {/* Create a NEW person and assign in one step. */}
      <View style={styles.createRow}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          placeholder={t('v2.tracks.newPersonPlaceholder')}
          placeholderTextColor={colors.foregroundSubtle}
          editable={!busy}
          style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground }]}
        />
        <Pressable
          onPress={() => { void createAndAssign() }}
          disabled={busy || newName.trim().length === 0}
          style={[
            styles.createBtn,
            {
              backgroundColor: colors.primary,
              opacity:
                pendingAction?.kind === 'create'
                  ? 1
                  : busy || newName.trim().length === 0
                    ? 0.5
                    : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('v2.tracks.createAndAssign')}
        >
          {pendingAction?.kind === 'create' ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <UserRoundPlus size={16} color={colors.primaryForeground} />
          )}
          <Text style={[styles.createBtnText, { color: colors.primaryForeground }]}>
            {t('v2.tracks.createAndAssign')}
          </Text>
        </Pressable>
      </View>

      {error !== null ? (
        <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
      ) : null}

      {/* Recompute every person's % against the gallery AS IT IS NOW. The
          suggestion above was frozen when the track closed; after a batch
          of assignments it answers about a gallery that no longer exists. */}
      {face !== null ? (
        <Pressable
          onPress={() => { void runRescore(false) }}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('v2.tracks.rescore.button')}
          accessibilityState={{ disabled: busy, busy: pendingAction?.kind === 'rescore' }}
          style={[
            styles.rescoreBtn,
            {
              borderColor: colors.primary,
              opacity: busy && pendingAction?.kind !== 'rescore' ? 0.5 : 1,
            },
          ]}
        >
          {pendingAction?.kind === 'rescore' ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <RefreshCw size={16} color={colors.primary} />
          )}
          <Text style={[styles.rescoreBtnText, { color: colors.primary }]}>
            {t('v2.tracks.rescore.button')}
          </Text>
        </Pressable>
      ) : null}

      {reportForThisFace !== null ? (
        <RescoreVerdict
          report={reportForThisFace}
          busy={busy}
          reembedPending={pendingAction?.kind === 'reembed'}
          onReembed={() => { void runRescore(true) }}
        />
      ) : null}

      {/* Existing persons. */}
      <SectionLabel style={styles.sectionLabel}>
        {t('v2.tracks.existingPersons')}
      </SectionLabel>
      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.md }}>
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : persons.length === 0 ? (
          <Text style={[styles.empty, { color: colors.foregroundMuted }]}>
            {t('v2.tracks.noPersons')}
          </Text>
        ) : (
          orderedPersons.map((person) => (
            <PersonRow
              key={person.id}
              person={person}
              current={face?.identityId === person.id}
              disabled={busy}
              pending={pendingAction?.kind === 'assign' && pendingAction.identityId === person.id}
              score={scoreByIdentity.get(person.id) ?? null}
              params={reportForThisFace?.params ?? null}
              onPress={() => { void assignTo(person.id) }}
            />
          ))
        )}
      </ScrollView>
    </SheetModal>
  )
})

interface RescoreVerdictProps {
  readonly report: FaceRescoreReport
  readonly busy: boolean
  readonly reembedPending: boolean
  readonly onReembed: () => void
}

/**
 * The headline of a recompute: what the pipeline WOULD do with this face right
 * now, and the two numbers that decide it (threshold and margin) so a
 * percentage in the list below can be read against something.
 *
 * `model-mismatch` gets the warning tint and its own escape hatch rather than
 * a "0%" — see `rescoreVerdictTone` for why those two must never look alike.
 */
const RescoreVerdict = memo(function RescoreVerdict({
  report,
  busy,
  reembedPending,
  onReembed,
}: RescoreVerdictProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const tone = rescoreVerdictTone(report.verdict)
  const tint =
    tone === 'good'
      ? colors.success
      : tone === 'medium'
        ? colors.primary
        : tone === 'warning'
          ? colors.warning
          : colors.foregroundMuted
  const winner = report.identities.find((i) => i.wouldAutoAssign)
  const threshold = formatRescoreScore(report.params.threshold)
  const margin = formatRescoreScore(report.params.margin)
  return (
    <View style={[styles.verdictBox, { borderColor: tint, backgroundColor: `${tint}14` }]}>
      <Text style={[styles.verdictText, { color: tint }]}>
        {t(rescoreVerdictKey(report.verdict), {
          name: winner?.name ?? '',
          min: report.params.minIdentitySamples,
        })}
      </Text>
      {report.comparable && threshold !== null && margin !== null ? (
        <Text style={[styles.verdictMeta, { color: colors.foregroundSubtle }]}>
          {t('v2.tracks.rescore.params', { threshold, margin })}
        </Text>
      ) : null}
      {/* Only when it could change the answer: out of the cluster space AND the
          crop still exists AND a re-embed has not already succeeded. */}
      {shouldOfferReembed(report) ? (
        <Pressable
          onPress={onReembed}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('v2.tracks.rescore.reembed')}
          accessibilityState={{ disabled: busy, busy: reembedPending }}
          style={[
            styles.reembedBtn,
            { borderColor: colors.warning, opacity: busy && !reembedPending ? 0.5 : 1 },
          ]}
        >
          {reembedPending ? (
            <ActivityIndicator size="small" color={colors.warning} />
          ) : (
            <Sparkles size={14} color={colors.warning} />
          )}
          <Text style={[styles.reembedBtnText, { color: colors.warning }]}>
            {t('v2.tracks.rescore.reembed')}
          </Text>
        </Pressable>
      ) : null}
      {/* A refusal is never silent: the operator asked for inference and must
          be told exactly why none happened. */}
      {report.reembed.attempted && !report.reembed.succeeded ? (
        <Text style={[styles.verdictMeta, { color: colors.danger }]}>
          {t('v2.tracks.rescore.reembedFailed', {
            reason: report.reembed.detail ?? report.reembed.reason ?? '',
          })}
        </Text>
      ) : null}
    </View>
  )
})

interface PersonRowProps {
  readonly person: PersonIdentity
  /** Already the face's assigned identity. */
  readonly current: boolean
  readonly disabled: boolean
  /** THIS row's assign is the mutation in flight — it wears the spinner in the
   *  trailing slot (where the check goes) while the other rows dim. The
   *  operator's report was precisely this row: tapping a person changed
   *  NOTHING on screen until the sheet closed seconds later. */
  readonly pending: boolean
  /** This person's FRESH score from the last recompute, or null before one. */
  readonly score: FaceRescoreIdentityRow | null
  /** The params that score was computed under. Null before a recompute. */
  readonly params: FaceRescoreParams | null
  readonly onPress: () => void
}

const PersonRow = memo(function PersonRow({ person, current, disabled, pending, score, params, onPress }: PersonRowProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const { token } = useServer()
  const { controller } = useConnection()
  const serverUrl = controller.getSystem()?.serverUrl ?? null
  const coverUri = identityCoverUri(person, serverUrl)
  const mediaHeaders: Record<string, string> | undefined = token
    ? { Authorization: `Bearer ${token}` }
    : undefined
  const tone: FaceRescoreRowTone | null =
    score !== null && params !== null ? rescoreRowTone(score, params) : null
  const scoreTint =
    tone === 'would-assign'
      ? colors.success
      : tone === 'over-threshold'
        ? colors.warning
        : tone === 'suggestion'
          ? colors.primary
          : tone === 'blocked'
            ? colors.danger
            : colors.foregroundSubtle
  const percent = score !== null ? formatRescoreScore(score.score) : null
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || current}
      accessibilityRole="button"
      accessibilityLabel={person.name}
      accessibilityState={{ disabled: disabled || current, busy: pending }}
      style={[
        styles.personRow,
        {
          backgroundColor: pending || current ? colors.primary + '22' : 'transparent',
          opacity: disabled && !pending ? 0.5 : 1,
        },
      ]}
    >
      {coverUri ? (
        <Image
          source={mediaImageSource(coverUri, mediaHeaders)}
          style={[styles.avatar, { backgroundColor: colors.surface }]}
          contentFit="cover"
        />
      ) : (
        <View style={[styles.avatar, styles.avatarEmpty, { backgroundColor: colors.surface }]}>
          <UserRound size={18} color={colors.foregroundMuted} />
        </View>
      )}
      <View style={styles.personText}>
        <Text numberOfLines={1} style={[styles.personName, { color: colors.foreground }]}>{person.name}</Text>
        {/* `blocked` names the ACTUAL obstacle: an identity below
            minIdentitySamples can score 99% and still be un-assignable, and a
            row that only shows the number sends the operator to the threshold
            knob when the fix is a second sample. */}
        <Text style={[styles.personCount, { color: tone === 'blocked' ? colors.danger : colors.foregroundSubtle }]}>
          {tone === 'blocked' && params !== null
            ? t('v2.tracks.rescore.needsSamples', {
                count: score?.sampleCount ?? person.sampleCount,
                min: params.minIdentitySamples,
              })
            : person.sampleCount}
        </Text>
      </View>
      {percent !== null ? (
        <Text style={[styles.personScore, { color: scoreTint }]}>{percent}</Text>
      ) : null}
      {pending ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : current ? (
        <Check size={18} color={colors.primary} />
      ) : null}
    </Pressable>
  )
})

const styles = StyleSheet.create({
  sheet: { maxHeight: '80%', borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, paddingHorizontal: SPACING.md, paddingTop: SPACING.md },
  faceRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingBottom: SPACING.sm },
  faceCrop: { width: 56, height: 56, borderRadius: RADIUS.md },
  faceHintCol: { flex: 1, gap: 4 },
  faceHint: { fontSize: 13, fontWeight: '500' },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.md },
  removeBtnText: { fontSize: 13, fontWeight: '700' },
  removeAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, borderWidth: 1, marginBottom: SPACING.sm },
  removeAllBtnText: { fontSize: 13, fontWeight: '700' },
  createRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' },
  input: { flex: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm, fontSize: 14 },
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 2, borderRadius: RADIUS.md },
  createBtnText: { fontSize: 13, fontWeight: '700' },
  error: { fontSize: 12, fontWeight: '600', marginTop: SPACING.xs },
  sectionLabel: { marginTop: SPACING.md, marginBottom: SPACING.xs },
  list: { flexGrow: 0 },
  loader: { marginVertical: SPACING.lg },
  empty: { fontSize: 13, paddingVertical: SPACING.md },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.md },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  personText: { flex: 1 },
  personName: { fontSize: 15, fontWeight: '600' },
  personCount: { fontSize: 11 },
  personScore: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 44, textAlign: 'right' },
  rescoreBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, borderWidth: 1, marginTop: SPACING.sm },
  rescoreBtnText: { fontSize: 13, fontWeight: '700' },
  verdictBox: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm, marginTop: SPACING.sm, gap: 4 },
  verdictText: { fontSize: 13, fontWeight: '700' },
  verdictMeta: { fontSize: 11, fontWeight: '500' },
  reembedBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs, paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.md, borderWidth: 1, marginTop: SPACING.xs, alignSelf: 'flex-start' },
  reembedBtnText: { fontSize: 12, fontWeight: '700' },
})
