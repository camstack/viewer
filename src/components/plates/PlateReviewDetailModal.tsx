/**
 * PlateReviewDetailModal — the ONE place a plate read gets assigned to a
 * vehicle. Since issue 557 it is the plate adapter over the sheet the face
 * detail uses (`ReviewSampleDetailModal`): the same crop carousel, info block,
 * FULL PICTURE with the plate boxed and "Open event", and the same searchable
 * list. What is plate-only lives here:
 *
 *   - the headline is the read text, drawn as a plate, and the vehicle name
 *     sits under the caption;
 *   - for a SINGLE read the text is editable (Correct) in the sheet's slot;
 *   - a read that belongs to no vehicle can be deleted from the header.
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Check } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { TABULAR } from '../../theme/tokens.js'
import { captureCaption } from '../../lib/capture-caption.js'
import { useDateLocale } from '../../lib/date-locale.js'
import { faceSuggestionCertainty } from '../../data/face-cluster-review.js'
import type { FaceFullPicture as FullPicture } from '../../data/face-full-picture.js'
import {
  filterVehicles,
  normalizePlateText,
  type PlateReviewRow,
  type PlateVehicle,
} from '../../data/plate-review.js'
import {
  ReviewSampleDetailModal,
  reviewSampleSlotStyles,
  type ReviewSampleCopy,
  type ReviewSampleInfo,
} from '../review/ReviewSampleDetailModal.js'

export interface PlateReviewDetailModalProps {
  readonly rows: readonly PlateReviewRow[]
  readonly vehicles: readonly PlateVehicle[]
  readonly cropUriFor: (row: PlateReviewRow) => string | null
  readonly mediaHeaders: Record<string, string> | undefined
  readonly pending: boolean
  readonly correcting: boolean
  readonly onAssign: (vehicleId: string, name: string) => void
  readonly onCreate: (name: string) => void
  readonly onCorrect: (plateId: string, text: string) => void
  readonly onDelete: (plateId: string) => void
  /** The full picture a read's crop was cut from. */
  readonly fullPictureFor: (row: PlateReviewRow) => FullPicture | null
  /** Open the track a read came from. */
  readonly onOpenTrack: (row: PlateReviewRow) => void
  readonly onClose: () => void
}

export const PlateReviewDetailModal = memo(function PlateReviewDetailModal({
  rows,
  vehicles,
  cropUriFor,
  mediaHeaders,
  pending,
  correcting,
  onAssign,
  onCreate,
  onCorrect,
  onDelete,
  fullPictureFor,
  onOpenTrack,
  onClose,
}: PlateReviewDetailModalProps) {
  const { t } = useTranslation()
  const locale = useDateLocale()

  const single = rows.length === 1 ? (rows[0] ?? null) : null
  const deleteId = single !== null && single.status !== 'assigned' ? single.plateId : undefined

  const infoFor = useCallback(
    (row: PlateReviewRow): ReviewSampleInfo => ({
      headline: row.text.length > 0 ? row.text : '—',
      headlineStyle: 'plate',
      caption: captureCaption(row, locale),
      ...(row.vehicleName !== undefined ? { subline: row.vehicleName } : {}),
      score: { value: row.score, certainty: faceSuggestionCertainty(row.score), label: t('v2.plateReview.confidence') },
    }),
    [locale, t],
  )

  const renderSlot = useCallback(
    (row: PlateReviewRow, isSingle: boolean) =>
      isSingle ? <PlateCorrectRow row={row} correcting={correcting} onCorrect={onCorrect} /> : null,
    [correcting, onCorrect],
  )

  const copy = useMemo<ReviewSampleCopy>(
    () => ({
      title:
        rows.length > 1 ? t('v2.plateReview.detailTitleMany', { count: rows.length }) : t('v2.plateReview.pickVehicleTitle'),
      deleteLabel: t('v2.plateReview.deleteSelected'),
      closeLabel: t('v2.plateReview.previewClose'),
      listTitle: t('v2.plateReview.knownVehicles'),
      searchPlaceholder: t('v2.plateReview.pickVehicleSearch'),
      emptyList: t('v2.plateReview.noVehicles'),
      noMatch: (query) => t('v2.plateReview.pickVehicleNoMatch', { query }),
      createPlaceholder: t('v2.plateReview.newVehiclePlaceholder'),
      createLabel: t('v2.plateReview.newVehicleButton'),
    }),
    [rows.length, t],
  )

  return (
    <ReviewSampleDetailModal
      rows={rows}
      targets={vehicles}
      filterTargets={filterVehicles}
      infoFor={infoFor}
      cropUriFor={cropUriFor}
      mediaHeaders={mediaHeaders}
      pending={pending}
      onAssign={onAssign}
      onCreate={onCreate}
      fullPictureFor={fullPictureFor}
      fullPictureSubject="plate"
      onOpenTrack={onOpenTrack}
      deleteId={deleteId}
      onDelete={onDelete}
      onClose={onClose}
      renderSlot={renderSlot}
      copy={copy}
    />
  )
})

interface PlateCorrectRowProps {
  readonly row: PlateReviewRow
  readonly correcting: boolean
  readonly onCorrect: (plateId: string, text: string) => void
}

/** Edit ONE read's text; the field follows the read on screen. */
const PlateCorrectRow = memo(function PlateCorrectRow({ row, correcting, onCorrect }: PlateCorrectRowProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const [draftText, setDraftText] = useState(row.text)

  useEffect(() => {
    setDraftText(row.text)
  }, [row.plateId, row.text])

  const normalizedDraft = normalizePlateText(draftText)
  const canCorrect = normalizedDraft.length > 0 && normalizedDraft !== row.text && !correcting

  return (
    <View style={reviewSampleSlotStyles.row}>
      <TextInput
        value={draftText}
        onChangeText={setDraftText}
        editable={!correcting}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder={t('v2.plateReview.correctPlaceholder')}
        placeholderTextColor={colors.foregroundSubtle}
        accessibilityLabel={t('v2.plateReview.correctPlaceholder')}
        style={[reviewSampleSlotStyles.input, TABULAR, { backgroundColor: colors.surface, color: colors.foreground }]}
      />
      <Pressable
        onPress={() => onCorrect(row.plateId, normalizedDraft)}
        disabled={!canCorrect}
        accessibilityRole="button"
        accessibilityLabel={t('v2.plateReview.correctButton')}
        style={[reviewSampleSlotStyles.button, { backgroundColor: colors.primary, opacity: canCorrect ? 1 : 0.5 }]}
      >
        {correcting ? (
          <ActivityIndicator size="small" color={colors.primaryForeground} />
        ) : (
          <Check size={16} color={colors.primaryForeground} />
        )}
      </Pressable>
    </View>
  )
})
