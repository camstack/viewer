/**
 * AnalyzeGroupCard — one look-alike group inside `FaceReviewAnalyzeModal`.
 *
 * Two things changed here on 2026-09-01, both operator decisions
 * (`docs/2026-09-01-face-review-suggestions-and-groups-design.md`):
 *
 * ## 1. The members are a GRID, not a carousel
 *
 * Excluding a face from a group already existed — but it lived inside a
 * `CarouselPager`, one member visible at a time behind an 11 px ✕. Taking three
 * strangers out of a group of nine meant paging through all nine. The function
 * was there; the road to it was not. Every member is now on screen at once and
 * one tap flips it, so the group can be corrected as fast as it can be read.
 *
 * The carousel is gone rather than kept alongside: two ways to do the same
 * write is the residue this repo treats as worse than none, and a grid shows a
 * large group better than a pager does anyway.
 *
 * ## 2. The person is PICKED, never typed
 *
 * The free-text field resolved what was typed against the saved identities and
 * created a new person when nothing matched — so a typo silently minted a
 * second "Danlel" and split someone's gallery in half. This card can no longer
 * create an identity at all: it offers the known people, and a group with
 * nobody chosen is simply not written (`buildAnalyzeAssignPlan`).
 *
 * How they are offered changed on 2026-09-13. It was a horizontal chip per
 * identity, REPEATED under every group card — three groups over forty people
 * was a hundred and twenty chips, and the operator's word for it was that the
 * selector *"li crescerebbe troppo"*. The card now shows ONE row naming the
 * chosen person (or asking for one) and hands the choosing to
 * `IdentityPickerSheet`, which is searchable and is opened by the MODAL: this
 * card owns exactly one piece of state — which crop is enlarged — and a second
 * `useState` here would be the beginning of a second source of truth, which is
 * what the spec beside it pins.
 *
 * The clustering's own majority vote is carried in as `selectedIdentityId`
 * (seeded by `seedAnalyzeIdentitySelection` from `proposedIdentityId`) — a
 * pre-selection, not a commitment.
 *
 * ## 3. Enlarging one crop, which the carousel used to do for free
 *
 * A 56 px tile is enough to spot a stranger in a group and not enough to
 * settle a small or blurred one. The pager gave that for nothing (one big
 * page); the grid has to earn it back, so a LONG PRESS opens the crop over the
 * grid. The short tap stays the exclusion — `onLongPress` suppresses `onPress`
 * in React Native, which is asserted rather than assumed
 * (`__tests__/analyze-group-card.spec.ts`), because "obviously it does" is how
 * a mis-tap ends up quietly striking a face out of the write.
 *
 * A long press is unreachable with a screen reader, so the same detail is
 * offered as a named `accessibilityActions` entry ({@link SHOW_DETAIL_ACTION})
 * — both entry points call the SAME `showDetail`, and the overlay's own
 * exclude button calls the SAME `onToggleMember` the grid does. One write
 * path, three ways in.
 */
import React, { memo, useCallback, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  type AccessibilityActionEvent,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { Image } from 'expo-image'
import { ChevronRight, X } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { mediaImageSource } from '../../data/track-media-uri.js'
import { includedGroupFaceIds, type AnalyzeGroupMember, type AnalyzeGroupRow } from '../../data/face-cluster-review.js'

/**
 * The `accessibilityActions` name for "open this crop large".
 *
 * VoiceOver and TalkBack cannot perform a long press, so the gesture is
 * mirrored as a named action. The tile ADVERTISES this name and the handler
 * ANSWERS to it: a rename that touches only one of the two would kill the
 * accessible path in silence, which is why both read the constant.
 */
export const SHOW_DETAIL_ACTION = 'showDetail'

export interface AnalyzeGroupCardProps {
  readonly group: AnalyzeGroupRow
  /** The person this group will be written to. `undefined` ⇒ not written. */
  readonly selectedIdentityId: string | undefined
  /** That person's display NAME, resolved by the caller from the same list the
   *  picker shows. `undefined` when nobody is chosen — the row then asks. */
  readonly selectedIdentityName: string | undefined
  readonly excluded: ReadonlySet<string>
  /** Injected so this component never needs to know the media plane. */
  readonly cropUriFor: (member: AnalyzeGroupMember) => string | null
  readonly mediaHeaders: Record<string, string> | undefined
  /** A batch write is in flight — nothing may change under it. */
  readonly disabled: boolean
  readonly onToggleMember: (faceId: string) => void
  /** Opens the searchable picker for THIS group. The sheet is owned by the
   *  modal, not by the card — see the header. */
  readonly onOpenPicker: () => void
}

export const AnalyzeGroupCard = memo(function AnalyzeGroupCard({
  group,
  selectedIdentityId,
  selectedIdentityName,
  excluded,
  cropUriFor,
  mediaHeaders,
  disabled,
  onToggleMember,
  onOpenPicker,
}: AnalyzeGroupCardProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const kept = includedGroupFaceIds(group, excluded).length

  const [detailFaceId, setDetailFaceId] = useState<string | null>(null)
  const showDetail = useCallback((faceId: string) => setDetailFaceId(faceId), [])
  const closeDetail = useCallback(() => setDetailFaceId(null), [])

  // DERIVED, never synchronised through an effect: a re-analysis that drops
  // this member simply closes the overlay, instead of leaving it open over a
  // crop that is no longer in the group.
  const detailMember =
    detailFaceId === null ? undefined : group.members.find((m) => m.faceId === detailFaceId)
  // Read from the PROP, so the overlay shows the same inclusion state the grid
  // does. A local copy here would be a second source of truth for one fact.
  const detailExcluded = detailMember !== undefined && excluded.has(detailMember.faceId)
  const detailCropUri = detailMember === undefined ? null : cropUriFor(detailMember)

  return (
    <View style={[styles.card, { borderColor: colors.border }]}>
      <Text style={[styles.size, { color: colors.foregroundMuted }]}>
        {t('v2.faceReview.groupSize', { count: kept })}
      </Text>

      <View style={styles.grid}>
        {group.members.map((member) => {
          const cropUri = cropUriFor(member)
          const isExcluded = excluded.has(member.faceId)
          return (
            <Pressable
              key={member.faceId}
              onPress={() => onToggleMember(member.faceId)}
              onLongPress={() => showDetail(member.faceId)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ checked: !isExcluded }}
              accessibilityLabel={t(
                isExcluded ? 'v2.faceReview.groupIncludeFace' : 'v2.faceReview.groupExcludeFace',
              )}
              accessibilityActions={[{ name: SHOW_DETAIL_ACTION, label: t('v2.faceReview.groupShowDetail') }]}
              onAccessibilityAction={(event: AccessibilityActionEvent) => {
                if (event.nativeEvent.actionName === SHOW_DETAIL_ACTION) showDetail(member.faceId)
              }}
              style={[
                styles.tile,
                {
                  backgroundColor: colors.surfaceHover,
                  borderColor: isExcluded ? colors.danger : colors.border,
                },
              ]}
            >
              {cropUri !== null ? (
                <Image
                  source={mediaImageSource(cropUri, mediaHeaders)}
                  style={[styles.tileImg, isExcluded ? styles.excludedImg : null]}
                  contentFit="cover"
                />
              ) : null}
              {isExcluded ? (
                <View style={[styles.excludedBadge, { backgroundColor: colors.danger }]}>
                  <X size={10} color={colors.background} />
                </View>
              ) : null}
            </Pressable>
          )
        })}
      </View>

      <Text style={[styles.pickLabel, { color: colors.foregroundSubtle }]}>
        {t('v2.faceReview.groupPickPerson')}
      </Text>
      <Pressable
        onPress={onOpenPicker}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t('v2.faceReview.groupPickPerson')}
        // `aria-selected` rather than `accessibilityState` — RN 0.71+ treats
        // the two as aliases, and this is the one that survives into the DOM,
        // so "does this group have a person" is observable to a screen reader
        // AND to a mount test.
        aria-selected={selectedIdentityId !== undefined}
        style={[
          styles.pickRow,
          {
            borderColor: selectedIdentityId === undefined ? colors.border : colors.primary,
            backgroundColor:
              selectedIdentityId === undefined ? colors.surface : `${colors.primary}18`,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.pickRowText,
            { color: selectedIdentityId === undefined ? colors.foregroundMuted : colors.primary },
          ]}
        >
          {selectedIdentityName ?? t('v2.faceReview.groupPickNone')}
        </Text>
        <ChevronRight size={16} color={colors.foregroundSubtle} />
      </Pressable>

      {/* The crop, large. Excluding from here goes through the SAME
          `onToggleMember` the grid tile calls — a second write path for one
          fact is how the UI and the hub end up disagreeing. */}
      <Modal
        visible={detailMember !== undefined}
        transparent
        animationType="fade"
        onRequestClose={closeDetail}
      >
        <View style={styles.detailBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closeDetail}
            accessibilityRole="button"
            accessibilityLabel={t('v2.faceReview.previewClose')}
          />
          <View style={[styles.detailCard, { backgroundColor: colors.backgroundElevated }]}>
            {detailCropUri !== null ? (
              <Image
                source={mediaImageSource(detailCropUri, mediaHeaders)}
                style={[styles.detailImg, { backgroundColor: colors.surfaceHover }]}
                contentFit="contain"
              />
            ) : (
              <View style={[styles.detailImg, { backgroundColor: colors.surfaceHover }]} />
            )}
            <View style={styles.detailActions}>
              <Pressable
                onPress={closeDetail}
                accessibilityRole="button"
                style={styles.detailCloseBtn}
              >
                <Text style={[styles.detailCloseText, { color: colors.foregroundMuted }]}>
                  {t('v2.faceReview.previewClose')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (detailMember !== undefined) onToggleMember(detailMember.faceId)
                }}
                disabled={disabled}
                accessibilityRole="button"
                style={[
                  styles.detailToggleBtn,
                  {
                    borderColor: detailExcluded ? colors.primary : colors.danger,
                    opacity: disabled ? 0.5 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.detailToggleText,
                    { color: detailExcluded ? colors.primary : colors.danger },
                  ]}
                >
                  {t(
                    detailExcluded
                      ? 'v2.faceReview.groupDetailInclude'
                      : 'v2.faceReview.groupDetailExclude',
                  )}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
})

const styles = StyleSheet.create({
  card: {
    gap: SPACING.xs,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  size: { fontSize: 11, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  tile: {
    width: 56,
    height: 56,
    borderRadius: RADIUS.sm,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  tileImg: { width: '100%', height: '100%' },
  excludedImg: { opacity: 0.25 },
  excludedBadge: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', paddingTop: SPACING.xs },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  pickRowText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  detailBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  detailCard: { width: '100%', maxWidth: 360, borderRadius: RADIUS.lg, padding: SPACING.md, gap: SPACING.md },
  detailImg: { width: '100%', height: 260, borderRadius: RADIUS.md },
  detailActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm },
  detailCloseBtn: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  detailCloseText: { fontSize: 13, fontWeight: '600' },
  detailToggleBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  detailToggleText: { fontSize: 13, fontWeight: '700' },
})
