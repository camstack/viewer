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
 * The search field was added on 2026-09-13 with the rest of the review tab's
 * person-picking: a bare list is fine at four people and a scroll hunt at
 * forty (*"il selettore li crescerebbe troppo"*). The matching rule is
 * `data/identity-picker.ts`, shared with `IdentityPickerSheet` — this modal
 * keeps its own list rather than opening that sheet because the crop it is
 * showing IS the reason the person is being chosen, and a sheet over a sheet
 * would hide it.
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
import { useTranslation } from 'react-i18next'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Plus, ChevronRight, Search, Trash2 } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS, TABULAR } from '../../theme/tokens.js'
import { KeyboardAwareScrollView } from '../ui/KeyboardInset.js'
import { SheetModal } from '../ui/SheetModal.js'
import { CarouselPager } from '../ui/CarouselPager.js'
import { FaceConfidenceBar } from './FaceConfidenceBar.js'
import { mediaImageSource } from '../../data/track-media-uri.js'
import { filterIdentities } from '../../data/identity-picker.js'
import type { FaceReviewRow } from '../../data/face-cluster-review.js'
import type { PersonIdentity } from '../../data/use-face-gallery.js'
import { SectionLabel } from '../ui/SectionLabel.js'
import { captureCaption } from '../../lib/capture-caption.js'
import { useDateLocale } from '../../lib/date-locale.js'
import { SheetHeader, SheetIconButton } from '../ui/SheetHeader.js'
import { FaceFullPicture } from './FaceFullPicture.js'
import type { FaceFullPicture as FullPicture } from '../../data/face-full-picture.js'
import { faceDeletionReadiness } from '../../data/face-review-deletion.js'

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

/** Above this many people the list gets a search field. */
const SEARCHABLE_FROM = 6

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
  const insets = useSafeAreaInsets()
  const [index, setIndex] = useState(0)
  const [newName, setNewName] = useState('')
  const [personQuery, setPersonQuery] = useState('')

  const shownIdentities = useMemo(
    () => filterIdentities(identities, personQuery),
    [identities, personQuery],
  )

  const visible = rows.length > 0
  // The raw index can outlive the set it points into (a refetch can shrink
  // `rows` under an open modal); every read clamps rather than trusting it,
  // the same rule the pager itself applies.
  const active = rows.length > 0 ? (rows[Math.min(index, rows.length - 1)] ?? null) : null

  // The bin is for ONE face, and only one the hub would delete.
  const deletable = rows.length === 1 && faceDeletionReadiness(rows).ready ? rows[0] : undefined

  const handleClose = useCallback(() => {
    setIndex(0)
    setNewName('')
    setPersonQuery('')
    onClose()
  }, [onClose])

  const handleCreate = useCallback(() => {
    const trimmed = newName.trim()
    if (trimmed.length === 0) return
    onCreate(trimmed)
    setNewName('')
  }, [newName, onCreate])

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

  const renderIdentity = useCallback(
    (item: PersonIdentity) => (
      <Pressable
        key={item.id}
        onPress={() => onAssign(item.id, item.name)}
        disabled={pending}
        accessibilityRole="button"
        style={[styles.personRow, { borderColor: colors.border, opacity: pending ? 0.5 : 1 }]}
      >
        <Text numberOfLines={1} style={[styles.personName, { color: colors.foreground }]}>
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
          ? t('v2.faceReview.detailTitleMany', { count: rows.length })
          : t('v2.faceReview.pickIdentityTitle')
        }
        actions={
          deletable !== undefined ? (
            <SheetIconButton
              icon={Trash2}
              tone="danger"
              label={t('v2.faceReview.deleteOne')}
              testID="face-detail-delete"
              disabled={pending}
              onPress={() => onDelete(deletable.faceId)}
            />
          ) : null
        }
        onClose={handleClose}
        closeLabel={t('v2.faceReview.previewClose')}
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
              <Text numberOfLines={1} style={[styles.name, { color: colors.foreground }]}>
                {active.status === 'assigned'
                  ? (active.assignedIdentityName ?? '')
                  : active.status === 'suggested'
                    ? (active.suggestedIdentityName ?? '')
                    : t('v2.faceReview.filterUnassigned')}
              </Text>
              <Text numberOfLines={1} style={[styles.meta, TABULAR, { color: colors.foregroundMuted }]}>
                {captureCaption(active, locale)}
              </Text>
              {active.suggestedMatchScore !== undefined && active.certainty !== undefined ? (
                <View style={styles.scoreRow}>
                  <View style={styles.scoreBar}>
                    <FaceConfidenceBar
                      score={active.suggestedMatchScore}
                      certainty={active.certainty}
                      height={6}
                    />
                  </View>
                  <Text style={[styles.scoreText, TABULAR, { color: colors.foregroundMuted }]}>
                    {`${t('v2.faceReview.confidence')}: ${String(Math.round(active.suggestedMatchScore * 100))}%`}
                  </Text>
                </View>
              ) : null}
            </View>

            <FaceFullPicture
              picture={fullPictureFor(active)}
              mediaHeaders={mediaHeaders}
              onOpenTrack={() => onOpenTrack(active)}
            />
          </>
        ) : null}

        <SectionLabel style={styles.sectionLabel}>
          {t('v2.faceReview.knownPeople')}
        </SectionLabel>
        {/* Offered only once the list is long enough to hunt through. Three
            people do not need a search box above them, and an empty field
            over an empty gallery reads as a broken picker. */}
        {identities.length > SEARCHABLE_FROM ? (
          <View style={[styles.searchRow, { backgroundColor: colors.surface }]}>
            <Search size={14} color={colors.foregroundMuted} />
            <TextInput
              value={personQuery}
              onChangeText={setPersonQuery}
              editable={!pending}
              autoCorrect={false}
              placeholder={t('v2.faceReview.pickPersonSearch')}
              placeholderTextColor={colors.foregroundSubtle}
              accessibilityLabel={t('v2.faceReview.pickPersonSearch')}
              style={[styles.searchInput, { color: colors.foreground }]}
            />
          </View>
        ) : null}
        <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {shownIdentities.length > 0 ? (
            shownIdentities.map(renderIdentity)
          ) : (
            <Text style={[styles.empty, { color: colors.foregroundMuted }]}>
              {identities.length === 0
                ? t('v2.tracks.noPersons')
                : t('v2.faceReview.pickPersonNoMatch', { query: personQuery.trim() })}
            </Text>
          )}
        </ScrollView>

        <View style={styles.createRow}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            editable={!pending}
            placeholder={t('v2.tracks.newPersonPlaceholder')}
            placeholderTextColor={colors.foregroundSubtle}
            style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground }]}
          />
          <Pressable
            onPress={handleCreate}
            disabled={pending || newName.trim().length === 0}
            accessibilityRole="button"
            style={[
              styles.createBtn,
              {
                backgroundColor: colors.primary,
                opacity: pending || newName.trim().length === 0 ? 0.5 : 1,
              },
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
  stage: { height: 220, borderRadius: RADIUS.lg, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  info: { paddingTop: SPACING.sm, gap: 2 },
  name: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 11 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingTop: 4 },
  scoreBar: { flex: 1, borderRadius: 3, overflow: 'hidden' },
  scoreText: { fontSize: 11, fontWeight: '600' },
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
  list: { flexGrow: 0, maxHeight: 220 },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  personName: { fontSize: 15, flex: 1 },
  empty: { fontSize: 13, paddingVertical: SPACING.md, textAlign: 'center' },
  createRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center', paddingTop: SPACING.sm },
  input: { flex: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm, fontSize: 14 },
  createBtn: { width: 40, height: 40, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
})
