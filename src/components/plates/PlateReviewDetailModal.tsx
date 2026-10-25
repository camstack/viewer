/**
 * PlateReviewDetailModal — the ONE place a plate read gets assigned to a
 * vehicle, the twin of `FaceReviewDetailModal`. When several reads were
 * multi-selected the crop is a carousel over them and a write applies to ALL.
 *
 *   1. The crop, large (a carousel for a multi-selection).
 *   2. What the hub read: the text, the camera, the capture time and the OCR
 *      confidence. For a SINGLE read the text is editable here (Correct), and a
 *      read that belongs to no vehicle can be deleted.
 *   3. The known vehicles, searchable, plus a create-new row. Picking one writes.
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useDateLocale } from '../../lib/date-locale.js'
import { Check, ChevronRight, Plus, Search, Trash2, X } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, TABULAR } from '../../theme/tokens.js'
import { mediaImageSource } from '../../data/track-media-uri.js'
import { faceSuggestionCertainty } from '../../data/face-cluster-review.js'
import {
  filterVehicles,
  normalizePlateText,
  type PlateReviewRow,
  type PlateVehicle,
} from '../../data/plate-review.js'
import { FaceConfidenceBar } from '../faces/FaceConfidenceBar.js'
import { CarouselPager } from '../ui/CarouselPager.js'
import { KeyboardAwareScrollView } from '../ui/KeyboardInset.js'
import { SheetModal } from '../ui/SheetModal.js'
import { SectionLabel } from '../ui/SectionLabel.js'
import { captureCaption } from '../../lib/capture-caption.js'
import { SheetHeader, SheetIconButton } from '../ui/SheetHeader.js'

export interface PlateReviewDetailModalProps {
  /** EMPTY closes the modal; one is the single-read case; many turns the crop into a carousel. */
  readonly rows: readonly PlateReviewRow[]
  readonly vehicles: readonly PlateVehicle[]
  readonly cropUriFor: (row: PlateReviewRow) => string | null
  readonly mediaHeaders: Record<string, string> | undefined
  /** A write is in flight: the list and the create row are disabled. */
  readonly pending: boolean
  /** The text correction is in flight. */
  readonly correcting: boolean
  readonly onAssign: (vehicleId: string, name: string) => void
  readonly onCreate: (name: string) => void
  readonly onCorrect: (plateId: string, text: string) => void
  readonly onDelete: (plateId: string) => void
  readonly onClose: () => void
}

/** Above this many vehicles the list gets a search field. */
const SEARCHABLE_FROM = 6

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
  onClose,
}: PlateReviewDetailModalProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const locale = useDateLocale()
  const [index, setIndex] = useState(0)
  const [newName, setNewName] = useState('')
  const [query, setQuery] = useState('')
  const [draftText, setDraftText] = useState('')

  const shownVehicles = useMemo(() => filterVehicles(vehicles, query), [vehicles, query])
  const visible = rows.length > 0
  // The raw index can outlive the set it points into; every read clamps.
  const active = rows.length > 0 ? (rows[Math.min(index, rows.length - 1)] ?? null) : null
  const single = rows.length === 1 ? active : null
  const activePlateId = active?.plateId
  const activeText = active?.text ?? ''

  // The editable text follows the plate on screen.
  useEffect(() => {
    setDraftText(activeText)
  }, [activePlateId, activeText])

  const handleClose = useCallback(() => {
    setIndex(0)
    setNewName('')
    setQuery('')
    onClose()
  }, [onClose])

  const handleCreate = useCallback(() => {
    const trimmed = newName.trim()
    if (trimmed.length === 0) return
    onCreate(trimmed)
    setNewName('')
  }, [newName, onCreate])

  const normalizedDraft = normalizePlateText(draftText)
  const canCorrect = single !== null && normalizedDraft.length > 0 && normalizedDraft !== single.text && !correcting

  const renderPage = useCallback(
    (pageIndex: number) => {
      const row = rows[pageIndex]
      if (row === undefined) return null
      const uri = cropUriFor(row)
      if (uri === null) return <View style={[styles.image, { backgroundColor: colors.surfaceHover }]} />
      return <Image source={mediaImageSource(uri, mediaHeaders)} style={styles.image} contentFit="contain" />
    },
    [rows, cropUriFor, mediaHeaders, colors.surfaceHover],
  )

  const renderVehicle = useCallback(
    (item: PlateVehicle) => (
      <Pressable
        key={item.id}
        onPress={() => onAssign(item.id, item.name)}
        disabled={pending}
        accessibilityRole="button"
        style={[styles.vehicleRow, { borderColor: colors.border, opacity: pending ? 0.5 : 1 }]}
      >
        <Text numberOfLines={1} style={[styles.vehicleName, { color: colors.foreground }]}>
          {item.name}
        </Text>
        <ChevronRight size={16} color={colors.foregroundSubtle} />
      </Pressable>
    ),
    [colors, onAssign, pending],
  )

  return (
    <SheetModal
      visible={visible}
      onClose={handleClose}
      scrimColor="transparent"
      sheetStyle={[
        styles.sheet,
        { backgroundColor: colors.backgroundElevated, paddingBottom: insets.bottom + SPACING.md },
      ]}
    >
      <SheetHeader
        title={
          rows.length > 1
            ? t('v2.plateReview.detailTitleMany', { count: rows.length })
            : t('v2.plateReview.pickVehicleTitle')
        }
        actions={
          single !== null && single.status !== 'assigned' ? (
            <SheetIconButton
              icon={Trash2}
              tone="danger"
              label={t('v2.plateReview.deleteSelected')}
              disabled={pending}
              onPress={() => onDelete(single.plateId)}
            />
          ) : null
        }
        onClose={handleClose}
        closeLabel={t('v2.plateReview.previewClose')}
      />

      {/* Everything under the header scrolls once the keyboard leaves less
          room than the card needs: the field being typed into, and the
          button next to it, stay above the keyboard. */}
      <KeyboardAwareScrollView style={styles.body} bounces={false}>
        {active !== null ? (
          <>
            <CarouselPager
              count={rows.length}
              index={index}
              onIndexChange={setIndex}
              renderPage={renderPage}
              style={[styles.stage, { backgroundColor: colors.surface }]}
            />
            <View style={styles.info}>
              <Text numberOfLines={1} style={[styles.plateText, TABULAR, { color: colors.foreground }]}>
                {active.text.length > 0 ? active.text : '—'}
              </Text>
              <Text numberOfLines={1} style={[styles.meta, TABULAR, { color: colors.foregroundMuted }]}>
                {captureCaption(active, locale)}
              </Text>
              {active.vehicleName !== undefined ? (
                <Text numberOfLines={1} style={[styles.meta, { color: colors.foregroundMuted }]}>
                  {active.vehicleName}
                </Text>
              ) : null}
              <View style={styles.scoreRow}>
                <View style={styles.scoreBar}>
                  <FaceConfidenceBar score={active.score} certainty={faceSuggestionCertainty(active.score)} height={6} />
                </View>
                <Text style={[styles.scoreText, TABULAR, { color: colors.foregroundMuted }]}>
                  {`${t('v2.plateReview.confidence')}: ${String(Math.round(active.score * 100))}%`}
                </Text>
              </View>
            </View>

            {single !== null ? (
              <View style={styles.correctRow}>
                <TextInput
                  value={draftText}
                  onChangeText={setDraftText}
                  editable={!correcting}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder={t('v2.plateReview.correctPlaceholder')}
                  placeholderTextColor={colors.foregroundSubtle}
                  accessibilityLabel={t('v2.plateReview.correctPlaceholder')}
                  style={[styles.input, TABULAR, { backgroundColor: colors.surface, color: colors.foreground }]}
                />
                <Pressable
                  onPress={() => onCorrect(single.plateId, normalizedDraft)}
                  disabled={!canCorrect}
                  accessibilityRole="button"
                  accessibilityLabel={t('v2.plateReview.correctButton')}
                  style={[styles.createBtn, { backgroundColor: colors.primary, opacity: canCorrect ? 1 : 0.5 }]}
                >
                  {correcting ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <Check size={16} color={colors.primaryForeground} />
                  )}
                </Pressable>
              </View>
            ) : null}
          </>
        ) : null}

        <SectionLabel style={styles.sectionLabel}>{t('v2.plateReview.knownVehicles')}</SectionLabel>
        {vehicles.length > SEARCHABLE_FROM ? (
          <View style={[styles.searchRow, { backgroundColor: colors.surface }]}>
            <Search size={14} color={colors.foregroundMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              editable={!pending}
              autoCorrect={false}
              placeholder={t('v2.plateReview.pickVehicleSearch')}
              placeholderTextColor={colors.foregroundSubtle}
              accessibilityLabel={t('v2.plateReview.pickVehicleSearch')}
              style={[styles.searchInput, { color: colors.foreground }]}
            />
          </View>
        ) : null}
        <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {shownVehicles.length > 0 ? (
            shownVehicles.map(renderVehicle)
          ) : (
            <Text style={[styles.empty, { color: colors.foregroundMuted }]}>
              {vehicles.length === 0
                ? t('v2.plateReview.noVehicles')
                : t('v2.plateReview.pickVehicleNoMatch', { query: query.trim() })}
            </Text>
          )}
        </ScrollView>

        <View style={styles.createRow}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            editable={!pending}
            placeholder={t('v2.plateReview.newVehiclePlaceholder')}
            placeholderTextColor={colors.foregroundSubtle}
            style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground }]}
          />
          <Pressable
            onPress={handleCreate}
            disabled={pending || newName.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel={t('v2.plateReview.newVehicleButton')}
            style={[
              styles.createBtn,
              { backgroundColor: colors.primary, opacity: pending || newName.trim().length === 0 ? 0.5 : 1 },
            ]}
          >
            {pending ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Plus size={16} color={colors.primaryForeground} />
            )}
          </Pressable>
        </View>
      </KeyboardAwareScrollView>
    </SheetModal>
  )
})

const styles = StyleSheet.create({
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  body: { flexGrow: 0, flexShrink: 1 },
  stage: { height: 150, borderRadius: RADIUS.lg, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  info: { paddingTop: SPACING.sm, gap: 2 },
  plateText: { fontSize: 20, fontWeight: '800', letterSpacing: 1 },
  meta: { fontSize: 11 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingTop: 4 },
  scoreBar: { flex: 1, borderRadius: 3, overflow: 'hidden' },
  scoreText: { fontSize: 11, fontWeight: '600' },
  correctRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center', paddingTop: SPACING.sm },
  sectionLabel: { paddingTop: SPACING.md },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    marginTop: SPACING.xs,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: SPACING.sm },
  list: { flexGrow: 0, maxHeight: 180 },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  vehicleName: { fontSize: 15, flex: 1 },
  empty: { fontSize: 13, paddingVertical: SPACING.md, textAlign: 'center' },
  createRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center', paddingTop: SPACING.sm },
  input: { flex: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm, fontSize: 14 },
  createBtn: { width: 40, height: 40, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
})
