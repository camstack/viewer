/**
 * IdentityPickerSheet — the ONE way the review tab picks a person.
 *
 * ## What it replaces
 *
 * Two chip rows that grew with the gallery: every person across the top of
 * `FaceReviewScreen` (the sample-audit entry point) and every person again
 * under EACH group card in the Analyze modal. Both were fine at four people
 * and unusable past a couple of dozen — *"il selettore li crescerebbe troppo,
 * serve una alternativa"* (operator, 2026-09-13).
 *
 * ## Why it looks like this
 *
 * It is not a new idiom. This app already picks out of a long list in exactly
 * one way — a search field over a scrolling list, as the Events camera facet
 * does — so this sheet is that, over `faceGallery.listIdentities`, with the
 * person's own cover crop beside the name because the operator's decision here
 * is visual. The search rule itself is `data/identity-picker.ts`, pure and
 * unit-tested; nothing about matching is decided in this file.
 *
 * ## Creating a person
 *
 * Optional, and OFF unless the caller passes `onCreate`. The Analyze modal
 * deliberately cannot create an identity — a typo there used to fork a
 * gallery in two (`FaceReviewAnalyzeModal`'s header) — so it opens this sheet
 * without the affordance, while the screen's own "new person" flow passes it.
 * The row only appears once something has been typed, and it offers THAT text
 * verbatim: a create button over an empty field has no name to create.
 */
import React, { memo, useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Check, Plus, Search, UserRound, X } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { SheetModal } from '../ui/SheetModal.js'
import { mediaImageSource } from '../../data/track-media-uri.js'
import { filterIdentities } from '../../data/identity-picker.js'
import { identityCoverUri, type PersonIdentity } from '../../data/use-face-gallery.js'
import { SheetHeader } from '../ui/SheetHeader.js'

export interface IdentityPickerSheetProps {
  readonly open: boolean
  /** Header line — the CALLER owns the copy, because "assign this group to"
   *  and "whose samples do you want re-analysed" are different questions over
   *  the same list. */
  readonly title: string
  readonly identities: readonly PersonIdentity[]
  /** Ticked in the list. `undefined` = nothing chosen yet. */
  readonly selectedIdentityId?: string | undefined
  readonly serverUrl: string | null
  readonly mediaHeaders: Record<string, string> | undefined
  /** A write is in flight — the whole list goes inert rather than firing twice. */
  readonly pending?: boolean
  readonly onPick: (identity: PersonIdentity) => void
  /** Omit to hide the create row entirely (the Analyze modal does). */
  readonly onCreate?: (name: string) => void
  readonly onClose: () => void
}

export const IdentityPickerSheet = memo(function IdentityPickerSheet({
  open,
  title,
  identities,
  selectedIdentityId,
  serverUrl,
  mediaHeaders,
  pending = false,
  onPick,
  onCreate,
  onClose,
}: IdentityPickerSheetProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const [query, setQuery] = useState('')

  const shown = useMemo(() => filterIdentities(identities, query), [identities, query])
  const typed = query.trim()

  const handleClose = useCallback(() => {
    setQuery('')
    onClose()
  }, [onClose])

  const handlePick = useCallback(
    (identity: PersonIdentity) => {
      setQuery('')
      onPick(identity)
    },
    [onPick],
  )

  const handleCreate = useCallback(() => {
    if (onCreate === undefined || typed.length === 0) return
    setQuery('')
    onCreate(typed)
  }, [onCreate, typed])

  const renderPerson = useCallback(
    ({ item }: ListRenderItemInfo<PersonIdentity>) => {
      const uri = identityCoverUri(item, serverUrl)
      const active = item.id === selectedIdentityId
      return (
        <Pressable
          onPress={() => handlePick(item)}
          disabled={pending}
          accessibilityRole="button"
          aria-selected={active}
          style={[
            styles.row,
            {
              borderColor: active ? colors.primary : colors.border,
              backgroundColor: active ? `${colors.primary}18` : 'transparent',
              opacity: pending ? 0.5 : 1,
            },
          ]}
        >
          {uri === null ? (
            <View style={[styles.avatar, styles.avatarEmpty, { borderColor: colors.border }]}>
              <UserRound size={16} color={colors.foregroundMuted} />
            </View>
          ) : (
            <Image source={mediaImageSource(uri, mediaHeaders)} style={styles.avatar} contentFit="cover" />
          )}
          <View style={styles.rowBody}>
            <Text numberOfLines={1} style={[styles.name, { color: colors.foreground }]}>
              {item.name}
            </Text>
            <Text style={[styles.meta, { color: colors.foregroundMuted }]}>
              {t('v2.faceReview.pickPersonSamples', { count: item.sampleCount })}
            </Text>
          </View>
          {active ? <Check size={16} color={colors.primary} /> : null}
        </Pressable>
      )
    },
    [serverUrl, mediaHeaders, selectedIdentityId, pending, colors, handlePick, t],
  )

  return (
    <SheetModal
      visible={open}
      onClose={handleClose}
      scrimColor="transparent"
      backdropLabel={t('v2.common.close')}
      sheetStyle={[
        styles.sheet,
        { backgroundColor: colors.backgroundElevated, paddingBottom: insets.bottom + SPACING.md },
      ]}
    >
      <SheetHeader
        title={title}
        onClose={handleClose}
        closeLabel={t('v2.common.close')}
      />

      <View style={[styles.searchRow, { backgroundColor: colors.surface }]}>
        <Search size={14} color={colors.foregroundMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          editable={!pending}
          autoCorrect={false}
          placeholder={t('v2.faceReview.pickPersonSearch')}
          placeholderTextColor={colors.foregroundSubtle}
          accessibilityLabel={t('v2.faceReview.pickPersonSearch')}
          style={[styles.searchInput, { color: colors.foreground }]}
        />
        {query.length > 0 ? (
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('v2.faceReview.pickPersonClear')}
          >
            <X size={14} color={colors.foregroundMuted} />
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={shown}
        keyExtractor={(item) => item.id}
        renderItem={renderPerson}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.foregroundMuted }]}>
            {identities.length === 0
              ? t('v2.tracks.noPersons')
              : t('v2.faceReview.pickPersonNoMatch', { query: typed })}
          </Text>
        }
      />

      {/* Create is offered only once there is a name to create, and only to
          a caller that asked for it. */}
      {onCreate !== undefined && typed.length > 0 ? (
        <Pressable
          onPress={handleCreate}
          disabled={pending}
          accessibilityRole="button"
          style={[styles.createRow, { borderColor: colors.primary, opacity: pending ? 0.5 : 1 }]}
        >
          {pending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Plus size={16} color={colors.primary} />
          )}
          <Text numberOfLines={1} style={[styles.createText, { color: colors.primary }]}>
            {t('v2.faceReview.pickPersonCreate', { name: typed })}
          </Text>
        </Pressable>
      ) : null}
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: SPACING.sm },
  list: { flexGrow: 0, marginTop: SPACING.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  avatar: { width: 40, height: 40, borderRadius: RADIUS.sm },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed' },
  rowBody: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 11 },
  empty: { fontSize: 13, paddingVertical: SPACING.lg, textAlign: 'center' },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginTop: SPACING.sm,
  },
  createText: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
})
