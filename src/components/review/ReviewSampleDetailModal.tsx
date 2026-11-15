/**
 * ReviewSampleDetailModal — the ONE detail sheet a Library review sample opens
 * in: a face from the Faces page, a plate read from the Plates page.
 *
 * Issue 557 (operator): the plate detail must match the face detail, original
 * picture included, through the same component. The two used to be a pair of
 * near-identical files that had already drifted (the plate one had no full
 * picture, a shorter stage, a shorter list). They are now two thin adapters
 * (`FaceReviewDetailModal`, `PlateReviewDetailModal`) that fill this one in:
 * what a row is called and scored (`infoFor`), who it can be given to
 * (`targets`), the copy, and an optional slot under the info (the plate's
 * text correction, the face's per-person rescore).
 *
 * Contents, in the order the operator needs them:
 *
 *   1. The crop, LARGE. Several selected samples page through a carousel
 *      (`CarouselPager`), so every crop is checked before one write lands on
 *      all of them.
 *   2. What the hub thinks: headline, capture caption, the exact percentage.
 *   3. The adapter's slot.
 *   4. The FULL PICTURE the crop was cut from, the sample boxed on it, and the
 *      button that opens its track (`FaceFullPicture`).
 *   5. The targets as a searchable list plus a create-new row. Picking one
 *      WRITES, for every page in the carousel.
 *
 * The header's bin deletes ONE sample, and only the one the adapter says may
 * go (`deleteId`): a bin over a carousel could not say which it deletes.
 */
import React, { useCallback, useMemo, useState, type ReactNode } from 'react'
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Plus, ChevronRight, Search, Trash2 } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS, TABULAR } from '../../theme/tokens.js'
import { KeyboardAwareScrollView } from '../ui/KeyboardInset.js'
import { SheetModal } from '../ui/SheetModal.js'
import { CarouselPager } from '../ui/CarouselPager.js'
import { SectionLabel } from '../ui/SectionLabel.js'
import { SheetHeader, SheetIconButton } from '../ui/SheetHeader.js'
import { FaceConfidenceBar } from '../faces/FaceConfidenceBar.js'
import { FaceFullPicture, type FullPictureSubject } from '../faces/FaceFullPicture.js'
import { mediaImageSource } from '../../data/track-media-uri.js'
import type { FaceFullPicture as FullPicture } from '../../data/face-full-picture.js'
import type { FaceSuggestionCertainty } from '../../data/face-cluster-review.js'

/** Someone a sample can be given to: a person, a vehicle. */
export interface ReviewSampleTarget {
  readonly id: string
  readonly name: string
}

/** The score line under the headline. */
export interface ReviewSampleScore {
  readonly value: number
  readonly certainty: FaceSuggestionCertainty
  /** The label before the percentage ("Confidence"). */
  readonly label: string
}

/** What the info block says about the sample on screen. */
export interface ReviewSampleInfo {
  readonly headline: string
  /** `plate` draws the headline as a plate: larger, tabular, spaced. */
  readonly headlineStyle: 'name' | 'plate'
  readonly caption: string
  readonly subline?: string
  readonly score?: ReviewSampleScore
}

/** How a target's score reads: the colour a percentage wears. */
export type ReviewTargetTone = 'success' | 'warning' | 'primary' | 'danger' | 'muted'

/** A fresh score a target wears on its row (the face rescore). */
export interface ReviewTargetScore {
  readonly text: string
  readonly tone: ReviewTargetTone
  /** Higher sorts first: once scored, the best match is the top row. */
  readonly rank: number
}

/** Every string the sheet shows, resolved by the adapter. */
export interface ReviewSampleCopy {
  readonly title: string
  readonly deleteLabel: string
  readonly closeLabel: string
  readonly listTitle: string
  readonly searchPlaceholder: string
  readonly emptyList: string
  readonly noMatch: (query: string) => string
  readonly createPlaceholder: string
  readonly createLabel?: string
}

export interface ReviewSampleDetailModalProps<Row, Target extends ReviewSampleTarget> {
  /** EMPTY closes the sheet; several turn the crop into a carousel. */
  readonly rows: readonly Row[]
  readonly targets: readonly Target[]
  readonly filterTargets: (targets: readonly Target[], query: string) => readonly Target[]
  readonly infoFor: (row: Row) => ReviewSampleInfo
  readonly cropUriFor: (row: Row) => string | null
  readonly mediaHeaders: Record<string, string> | undefined
  /** A write is in flight: the list and the create row are disabled. */
  readonly pending: boolean
  readonly onAssign: (targetId: string, name: string) => void
  readonly onCreate: (name: string) => void
  readonly fullPictureFor: (row: Row) => FullPicture | null
  readonly fullPictureSubject: FullPictureSubject
  readonly onOpenTrack: (row: Row) => void
  /** The one sample the bin may delete, or `undefined` for no bin. */
  readonly deleteId: string | undefined
  readonly deleteTestID?: string
  readonly onDelete: (id: string) => void
  readonly onClose: () => void
  /** A target's fresh score for the sample on screen, drawn on its row. */
  readonly scoreOf?: (active: Row, targetId: string) => ReviewTargetScore | undefined
  /** Drawn under the info block for the sample on screen. */
  readonly renderSlot?: (active: Row, single: boolean) => ReactNode
  readonly copy: ReviewSampleCopy
}

/** Above this many targets the list gets a search field. */
const SEARCHABLE_FROM = 6

export function ReviewSampleDetailModal<Row, Target extends ReviewSampleTarget>({
  rows,
  targets,
  filterTargets,
  infoFor,
  cropUriFor,
  mediaHeaders,
  pending,
  onAssign,
  onCreate,
  fullPictureFor,
  fullPictureSubject,
  onOpenTrack,
  deleteId,
  deleteTestID,
  onDelete,
  onClose,
  renderSlot,
  scoreOf,
  copy,
}: ReviewSampleDetailModalProps<Row, Target>) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const [index, setIndex] = useState(0)
  const [newName, setNewName] = useState('')
  const [query, setQuery] = useState('')

  const visible = rows.length > 0
  // The raw index can outlive the set it points into (a refetch can shrink
  // `rows` under an open sheet); every read clamps rather than trusting it.
  const active = rows.length > 0 ? (rows[Math.min(index, rows.length - 1)] ?? null) : null

  const scoreFor = useCallback(
    (targetId: string): ReviewTargetScore | undefined =>
      active !== null && scoreOf !== undefined ? scoreOf(active, targetId) : undefined,
    [active, scoreOf],
  )
  // Best-first once scored: the operator's next tap is almost always the top row.
  const shownTargets = useMemo(() => {
    const filtered = filterTargets(targets, query)
    if (!filtered.some((target) => scoreFor(target.id) !== undefined)) return filtered
    const rank = (id: string): number => scoreFor(id)?.rank ?? Number.NEGATIVE_INFINITY
    return [...filtered].sort((a, b) => rank(b.id) - rank(a.id))
  }, [filterTargets, targets, query, scoreFor])
  const info = active !== null ? infoFor(active) : null

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

  const toneColor: Readonly<Record<ReviewTargetTone, string>> = {
    success: colors.success,
    warning: colors.warning,
    primary: colors.primary,
    danger: colors.danger,
    muted: colors.foregroundSubtle,
  }

  const renderTarget = (item: Target) => {
    const score = scoreFor(item.id)
    return (
      <Pressable
        key={item.id}
        onPress={() => onAssign(item.id, item.name)}
        disabled={pending}
        accessibilityRole="button"
        style={[styles.targetRow, { borderColor: colors.border, opacity: pending ? 0.5 : 1 }]}
      >
        <Text numberOfLines={1} style={[styles.targetName, { color: colors.foreground }]}>
          {item.name}
        </Text>
        {score !== undefined ? (
          <Text style={[styles.targetScore, TABULAR, { color: toneColor[score.tone] }]}>{score.text}</Text>
        ) : null}
        <ChevronRight size={16} color={colors.foregroundSubtle} />
      </Pressable>
    )
  }

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
        title={copy.title}
        actions={
          deleteId !== undefined ? (
            <SheetIconButton
              icon={Trash2}
              tone="danger"
              label={copy.deleteLabel}
              testID={deleteTestID}
              disabled={pending}
              onPress={() => onDelete(deleteId)}
            />
          ) : null
        }
        onClose={handleClose}
        closeLabel={copy.closeLabel}
      />

      {/* Everything under the header scrolls once the keyboard leaves less
          room than the card needs: the field being typed into, and the
          button next to it, stay above the keyboard. */}
      <KeyboardAwareScrollView style={styles.body} bounces={false}>
        {active !== null && info !== null ? (
          <>
            <CarouselPager
              count={rows.length}
              index={index}
              onIndexChange={setIndex}
              renderPage={renderPage}
              style={[styles.stage, { backgroundColor: colors.surface }]}
            />

            <View style={styles.info}>
              <Text
                numberOfLines={1}
                style={[
                  info.headlineStyle === 'plate' ? [styles.plate, TABULAR] : styles.name,
                  { color: colors.foreground },
                ]}
              >
                {info.headline}
              </Text>
              <Text numberOfLines={1} style={[styles.meta, TABULAR, { color: colors.foregroundMuted }]}>
                {info.caption}
              </Text>
              {info.subline !== undefined ? (
                <Text numberOfLines={1} style={[styles.meta, { color: colors.foregroundMuted }]}>
                  {info.subline}
                </Text>
              ) : null}
              {info.score !== undefined ? (
                <View style={styles.scoreRow}>
                  <View style={styles.scoreBar}>
                    <FaceConfidenceBar score={info.score.value} certainty={info.score.certainty} height={6} />
                  </View>
                  <Text style={[styles.scoreText, TABULAR, { color: colors.foregroundMuted }]}>
                    {`${info.score.label}: ${String(Math.round(info.score.value * 100))}%`}
                  </Text>
                </View>
              ) : null}
            </View>

            {renderSlot !== undefined ? renderSlot(active, rows.length === 1) : null}

            <FaceFullPicture
              picture={fullPictureFor(active)}
              mediaHeaders={mediaHeaders}
              onOpenTrack={() => onOpenTrack(active)}
              subject={fullPictureSubject}
            />
          </>
        ) : null}

        <SectionLabel style={styles.sectionLabel}>{copy.listTitle}</SectionLabel>
        {/* Offered only once the list is long enough to hunt through: an
            empty field over an empty list reads as a broken picker. */}
        {targets.length > SEARCHABLE_FROM ? (
          <View style={[styles.searchRow, { backgroundColor: colors.surface }]}>
            <Search size={14} color={colors.foregroundMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              editable={!pending}
              autoCorrect={false}
              placeholder={copy.searchPlaceholder}
              placeholderTextColor={colors.foregroundSubtle}
              accessibilityLabel={copy.searchPlaceholder}
              style={[styles.searchInput, { color: colors.foreground }]}
            />
          </View>
        ) : null}
        <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {shownTargets.length > 0 ? (
            shownTargets.map(renderTarget)
          ) : (
            <Text style={[styles.empty, { color: colors.foregroundMuted }]}>
              {targets.length === 0 ? copy.emptyList : copy.noMatch(query.trim())}
            </Text>
          )}
        </ScrollView>

        <View style={styles.createRow}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            editable={!pending}
            placeholder={copy.createPlaceholder}
            placeholderTextColor={colors.foregroundSubtle}
            style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground }]}
          />
          <Pressable
            onPress={handleCreate}
            disabled={pending || newName.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel={copy.createLabel}
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
}

/** The styles an adapter's slot shares with the sheet (an input row). */
export const reviewSampleSlotStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center', paddingTop: SPACING.sm },
  input: { flex: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm, fontSize: 14 },
  button: { width: 40, height: 40, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
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
  plate: { fontSize: 20, fontWeight: '800', letterSpacing: 1 },
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
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  targetName: { fontSize: 15, flex: 1 },
  targetScore: { fontSize: 14, fontWeight: '800', minWidth: 44, textAlign: 'right', marginRight: SPACING.xs },
  empty: { fontSize: 13, paddingVertical: SPACING.md, textAlign: 'center' },
  createRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center', paddingTop: SPACING.sm },
  input: { flex: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm, fontSize: 14 },
  createBtn: { width: 40, height: 40, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
})
