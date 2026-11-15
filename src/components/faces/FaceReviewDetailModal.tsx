/**
 * FaceReviewDetailModal — the ONE place a face gets assigned to a person.
 *
 * ⚠ It replaces TWO components. Until now the review tab had a large-preview
 * modal (tap the crop) AND a bottom sheet that opened from the suggested NAME
 * (`FaceReviewAssignSheet`, deleted with this change). They wrote the same
 * fact through different flows — the sheet had a two-step "correct, then
 * Confirm" mode the modal did not — so which one you happened to open decided
 * whether picking a person wrote immediately. A second path that does the
 * same thing differently is the residue this repo treats as worse than none,
 * so the sheet is gone and its identity list moved in here.
 *
 * Contents, in the order the operator needs them:
 *
 *   1. The crop, LARGE — the reason to open this at all is that the thumbnail
 *      was too small to decide from. When several faces were multi-selected
 *      it is a CAROUSEL over them (`CarouselPager`, the same paging authority
 *      the timeline's cluster card uses), so the operator can check every
 *      crop before committing one name to all of them.
 *   2. What the hub thinks: the suggested or assigned name, the camera, the
 *      capture time, and the EXACT percentage as a bar plus a number. The
 *      grid gives the band at a glance; this is where the digits live.
 *   3. The FULL PICTURE the crop was cut from — the track's native key frame
 *      with the face boxed — and the button that opens that track
 *      (`FaceFullPicture`; operator, 2026-10-23: *"abbiamo un riferimento
 *      alla foto completa della traccia?"* — there was none).
 *   4. The known people, as a SEARCHABLE list, plus a create-new row. Picking
 *      one WRITES — for every page in the carousel, not just the visible one.
 *
 * The header's bin deletes ONE face that belongs to nobody — the same
 * `faceGallery.deleteFace` the selection bar's Delete runs, with the same
 * confirmation, owned by the screen. A face that belongs to a person is not
 * offered it (`face-review-deletion.ts` says why), and neither is a carousel:
 * a bin over several faces would delete the one on screen or all of them, and
 * the operator could not tell which.
 *
 * Since issue 557 the sheet itself is `ReviewSampleDetailModal`, shared with
 * the plate detail; this file is the face adapter: what a face is called and
 * scored, who it can go to, and the face-only slot — "Recompute"
 * (`FaceRescoreControls`), whose fresh percentage for EVERY person is drawn on
 * that person's row, best first.
 *
 * The search field was added on 2026-09-13 with the rest of the review tab's
 * person-picking: a bare list is fine at four people and a scroll hunt at
 * forty (*"il selettore li crescerebbe troppo"*). The matching rule is
 * `data/identity-picker.ts`, shared with `IdentityPickerSheet` — this modal
 * keeps its own list rather than opening that sheet because the crop it is
 * showing IS the reason the person is being chosen, and a sheet over a sheet
 * would hide it.
 */
import React, { memo, useCallback, useMemo, useState } from 'react'
import { Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { filterIdentities } from '../../data/identity-picker.js'
import type { FaceReviewRow } from '../../data/face-cluster-review.js'
import type { PersonIdentity } from '../../data/use-face-gallery.js'
import { captureCaption } from '../../lib/capture-caption.js'
import { useDateLocale } from '../../lib/date-locale.js'
import { log } from '../../lib/logger.js'
import { refusalAwareKey } from '../../auth/forbidden.js'
import type { FaceFullPicture as FullPicture } from '../../data/face-full-picture.js'
import { faceDeletionReadiness } from '../../data/face-review-deletion.js'
import { useFaceRescore } from '../../data/use-face-rescore.js'
import { formatRescoreScore, rescoreRowTone, type FaceRescoreReport, type FaceRescoreRowTone } from '../../data/face-rescore.js'
import {
  ReviewSampleDetailModal,
  type ReviewSampleCopy,
  type ReviewSampleInfo,
  type ReviewTargetScore,
  type ReviewTargetTone,
} from '../review/ReviewSampleDetailModal.js'
import { FaceRescoreControls, type FaceRescorePending } from './FaceRescoreControls.js'

export interface FaceReviewDetailModalProps {
  /** The faces under review. EMPTY closes the modal; one is the single-face
   *  case; many is the multi-select case and turns the crop into a carousel.
   *  A write applies to ALL of them. */
  readonly rows: readonly FaceReviewRow[]
  readonly identities: readonly PersonIdentity[]
  /** Resolves a row's renderable crop URI — injected so this component never
   *  needs to know about the media plane or the server URL. */
  readonly cropUriFor: (row: FaceReviewRow) => string | null
  readonly mediaHeaders: Record<string, string> | undefined
  /** A write is in flight: the list and the create row are disabled so the
   *  same batch cannot be fired twice. */
  readonly pending: boolean
  readonly onAssign: (identityId: string, name: string) => void
  readonly onCreate: (name: string) => void
  /** The full picture a row's crop was cut from (`face-full-picture.ts`). */
  readonly fullPictureFor: (row: FaceReviewRow) => FullPicture | null
  /** Open the track a row came from. */
  readonly onOpenTrack: (row: FaceReviewRow) => void
  /** Delete ONE parked face; the caller confirms first. */
  readonly onDelete: (faceId: string) => void
  readonly onClose: () => void
}

/** A failed recompute, kept with the face it was asked for. */
interface RescoreError {
  readonly faceId: string
  readonly message: string
}

/** The rescore row tone, in the sheet's colour vocabulary. */
const TONE: Readonly<Record<FaceRescoreRowTone, ReviewTargetTone>> = {
  'would-assign': 'success',
  'over-threshold': 'warning',
  suggestion: 'primary',
  blocked: 'danger',
  below: 'muted',
}

export const FaceReviewDetailModal = memo(function FaceReviewDetailModal({
  rows,
  identities,
  cropUriFor,
  mediaHeaders,
  pending,
  onAssign,
  onCreate,
  fullPictureFor,
  onOpenTrack,
  onDelete,
  onClose,
}: FaceReviewDetailModalProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const locale = useDateLocale()
  const rescore = useFaceRescore()
  // A report belongs to ONE face (`report.faceId`); paging the carousel to
  // another face shows that face's own state, never the last one's numbers.
  const [report, setReport] = useState<FaceRescoreReport | null>(null)
  const [rescorePending, setRescorePending] = useState<FaceRescorePending>(null)
  const [rescoreError, setRescoreError] = useState<RescoreError | null>(null)

  // The bin is for ONE face, and only one the hub would delete.
  const deletable = rows.length === 1 && faceDeletionReadiness(rows).ready ? rows[0] : undefined

  const handleClose = useCallback(() => {
    setReport(null)
    setRescoreError(null)
    onClose()
  }, [onClose])

  const runRescore = useCallback(
    async (row: FaceReviewRow, reembed: boolean): Promise<void> => {
      if (rescorePending !== null) return
      setRescoreError(null)
      setRescorePending(reembed ? 'reembed' : 'rescore')
      try {
        setReport(await rescore.mutateAsync({ deviceId: row.deviceId, trackId: row.trackId, reembed }))
      } catch (err: unknown) {
        log.error('face-review', 'rescore threw', {
          deviceId: row.deviceId,
          trackId: row.trackId,
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        })
        setRescoreError({ faceId: row.faceId, message: t(refusalAwareKey(err, 'v2.tracks.rescore.failed')) })
      } finally {
        setRescorePending(null)
      }
    },
    [rescore, rescorePending, t],
  )

  const reportFor = useCallback(
    (row: FaceReviewRow): FaceRescoreReport | null => (report !== null && report.faceId === row.faceId ? report : null),
    [report],
  )

  const scoreOf = useCallback(
    (row: FaceReviewRow, identityId: string): ReviewTargetScore | undefined => {
      const fresh = reportFor(row)
      const scored = fresh?.identities.find((i) => i.identityId === identityId)
      if (fresh === null || scored === undefined) return undefined
      const text = formatRescoreScore(scored.score)
      if (text === null) return undefined
      return { text, tone: TONE[rescoreRowTone(scored, fresh.params)], rank: scored.score }
    },
    [reportFor],
  )

  const infoFor = useCallback(
    (row: FaceReviewRow): ReviewSampleInfo => ({
      headline:
        row.status === 'assigned'
          ? (row.assignedIdentityName ?? '')
          : row.status === 'suggested'
            ? (row.suggestedIdentityName ?? '')
            : t('v2.faceReview.filterUnassigned'),
      headlineStyle: 'name',
      caption: captureCaption(row, locale),
      ...(row.suggestedMatchScore !== undefined && row.certainty !== undefined
        ? { score: { value: row.suggestedMatchScore, certainty: row.certainty, label: t('v2.faceReview.confidence') } }
        : {}),
    }),
    [locale, t],
  )

  const renderSlot = useCallback(
    (row: FaceReviewRow) => (
      <>
        <FaceRescoreControls
          report={reportFor(row)}
          busy={pending || rescorePending !== null}
          pending={rescorePending}
          onRescore={(reembed) => { void runRescore(row, reembed) }}
        />
        {rescoreError !== null && rescoreError.faceId === row.faceId ? (
          <Text style={[styles.error, { color: colors.danger }]}>{rescoreError.message}</Text>
        ) : null}
      </>
    ),
    [reportFor, pending, rescorePending, runRescore, rescoreError, colors.danger],
  )

  const copy = useMemo<ReviewSampleCopy>(
    () => ({
      title:
        rows.length > 1 ? t('v2.faceReview.detailTitleMany', { count: rows.length }) : t('v2.faceReview.pickIdentityTitle'),
      deleteLabel: t('v2.faceReview.deleteOne'),
      closeLabel: t('v2.faceReview.previewClose'),
      listTitle: t('v2.faceReview.knownPeople'),
      searchPlaceholder: t('v2.faceReview.pickPersonSearch'),
      emptyList: t('v2.tracks.noPersons'),
      noMatch: (query) => t('v2.faceReview.pickPersonNoMatch', { query }),
      createPlaceholder: t('v2.tracks.newPersonPlaceholder'),
    }),
    [rows.length, t],
  )

  return (
    <ReviewSampleDetailModal
      rows={rows}
      targets={identities}
      filterTargets={filterIdentities}
      infoFor={infoFor}
      cropUriFor={cropUriFor}
      mediaHeaders={mediaHeaders}
      pending={pending}
      onAssign={onAssign}
      onCreate={onCreate}
      fullPictureFor={fullPictureFor}
      fullPictureSubject="face"
      onOpenTrack={onOpenTrack}
      deleteId={deletable?.faceId}
      deleteTestID="face-detail-delete"
      onDelete={onDelete}
      onClose={handleClose}
      renderSlot={renderSlot}
      scoreOf={scoreOf}
      copy={copy}
    />
  )
})

const styles = StyleSheet.create({
  error: { fontSize: 12, fontWeight: '600', marginTop: SPACING.xs },
})
