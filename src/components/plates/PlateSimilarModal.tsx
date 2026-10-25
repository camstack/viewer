/**
 * PlateSimilarModal — the Plates page's "Similar plates" groups (the twin of
 * People's look-alike groups): reads whose text is within a couple of edits of
 * each other, i.e. probably one physical plate. A group is not written from
 * here: "Select group" closes the modal with that group selected on the page,
 * where the ONE assignment path (the detail modal) puts a vehicle on all of it.
 */
import React, { memo } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { X } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, TABULAR } from '../../theme/tokens.js'
import { mediaImageSource } from '../../data/track-media-uri.js'
import type { PlateCluster } from '../../data/plate-review.js'
import { SheetModal } from '../ui/SheetModal.js'
import { SheetHeader } from '../ui/SheetHeader.js'

export interface PlateSimilarModalProps {
  readonly open: boolean
  readonly loading: boolean
  readonly failed: boolean
  readonly groups: readonly PlateCluster[]
  /** The representative's crop, when its row is in the loaded window. */
  readonly cropUriFor: (plateId: string) => string | null
  readonly mediaHeaders: Record<string, string> | undefined
  readonly onSelectGroup: (plateIds: readonly string[]) => void
  readonly onClose: () => void
}

export const PlateSimilarModal = memo(function PlateSimilarModal({
  open,
  loading,
  failed,
  groups,
  cropUriFor,
  mediaHeaders,
  onSelectGroup,
  onClose,
}: PlateSimilarModalProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()

  let body: React.ReactElement
  if (loading) {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{t('v2.plateReview.similarLoading')}</Text>
      </View>
    )
  } else if (failed) {
    body = <Text style={[styles.message, { color: colors.danger }]}>{t('v2.plateReview.loadError')}</Text>
  } else if (groups.length === 0) {
    body = <Text style={[styles.message, { color: colors.foregroundMuted }]}>{t('v2.plateReview.similarEmpty')}</Text>
  } else {
    body = (
      <FlatList
        data={groups}
        keyExtractor={(group) => group.representativePlateId}
        style={styles.list}
        renderItem={({ item }) => {
          const uri = cropUriFor(item.representativePlateId)
          return (
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              {uri !== null ? (
                <Image source={mediaImageSource(uri, mediaHeaders)} style={styles.crop} contentFit="cover" />
              ) : (
                <View style={[styles.crop, { backgroundColor: colors.surfaceHover }]} />
              )}
              <View style={styles.cardText}>
                <Text numberOfLines={1} style={[styles.plate, TABULAR, { color: colors.foreground }]}>
                  {item.representativeText}
                </Text>
                <Text style={[styles.count, { color: colors.foregroundMuted }]}>
                  {t('v2.plateReview.groupSize', { count: item.size })}
                </Text>
              </View>
              <Pressable
                onPress={() => onSelectGroup(item.plateIds)}
                accessibilityRole="button"
                accessibilityLabel={`${t('v2.plateReview.selectGroup')} ${item.representativeText}`}
                style={[styles.selectBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.selectText, { color: colors.primaryForeground }]}>
                  {t('v2.plateReview.selectGroup')}
                </Text>
              </Pressable>
            </View>
          )
        }}
      />
    )
  }

  return (
    <SheetModal
      visible={open}
      onClose={onClose}
      sheetStyle={[
        styles.sheet,
        { backgroundColor: colors.backgroundElevated, paddingBottom: insets.bottom + SPACING.md },
      ]}
    >
      <SheetHeader
        title={t('v2.plateReview.similarTitle')}
        onClose={onClose}
        closeLabel={t('v2.plateReview.previewClose')}
      />
      {body}
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
  centered: { alignItems: 'center', gap: SPACING.md, padding: SPACING['2xl'] },
  message: { fontSize: 14, textAlign: 'center', padding: SPACING['2xl'] },
  list: { flexGrow: 0 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  crop: { width: 88, height: 44, borderRadius: RADIUS.sm },
  cardText: { flex: 1, gap: 2 },
  plate: { fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
  count: { fontSize: 11 },
  selectBtn: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderRadius: RADIUS.md },
  selectText: { fontSize: 12, fontWeight: '700' },
})
