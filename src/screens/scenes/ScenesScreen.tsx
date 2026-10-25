/**
 * ScenesScreen — the Library → Scenes page, PREPARED: header, empty state and a
 * read-only list wired to `sceneMonitor.listScenesBatch`, behind
 * `FEATURE_FLAGS.scenesLibrary` (off).
 *
 * The page carries NO access rule of its own: who may open it is decided where
 * the section is offered (`library-sections.ts`), so opening it to every user
 * later changes one function, not this screen.
 */
import React, { useMemo } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { ScreenHeader, type HeaderAction } from '../../components/ScreenHeader.js'
import { SkeletonBox } from '../../components/ui/SkeletonBox.js'
import { useConnection } from '../../connection/ConnectionProvider.js'
import { useCameras } from '../../data/use-cameras.js'
import { useScenesLibrary, type CameraScenes } from '../../data/scenes-library.js'
import { RefreshCw } from '../../lib/icons.js'
import { useTabScrollPadding } from '../../navigation/bottom-nav-inset.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'

const SKELETON_ROWS = 4

export function ScenesScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const padBottom = useTabScrollPadding(SPACING.sm)
  const { state } = useConnection()
  const enabled = state === 'connected'
  const { data: cameras } = useCameras()
  const scenes = useScenesLibrary(enabled)

  const nameById = useMemo(() => new Map((cameras ?? []).map((c) => [c.id, c.name])), [cameras])
  const rows = scenes.data ?? []

  const actions: readonly HeaderAction[] = [
    {
      id: 'refresh',
      icon: RefreshCw,
      label: t('v2.scenes.refreshButton'),
      onPress: () => {
        void scenes.refetch()
      },
      testID: 'scenes-action-refresh',
    },
  ]

  const renderItem = ({ item }: { item: CameraScenes }): React.JSX.Element => {
    const camera = nameById.get(item.deviceId) ?? `#${String(item.deviceId)}`
    return (
      <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text numberOfLines={1} style={[styles.camera, { color: colors.foreground }]}>
          {camera}
        </Text>
        <Text style={[styles.detail, { color: item.scenes === null ? colors.warning : colors.foregroundMuted }]}>
          {item.scenes === null
            ? t('v2.scenes.unreadable')
            : t('v2.scenes.sceneCount', { count: item.scenes.length })}
        </Text>
      </View>
    )
  }

  let empty: React.ReactElement | null = null
  if (!enabled) {
    // Not connected and nothing cached: no claim either way — the hub-status
    // overlay at the app root says why the list is not filling.
    empty = null
  } else if (scenes.isLoading || (cameras === undefined && !scenes.isError)) {
    empty = (
      <View style={styles.skeleton} testID="scenes-skeleton">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <SkeletonBox key={i} style={styles.skeletonRow} />
        ))}
        <ActivityIndicator color={colors.primary} />
      </View>
    )
  } else if (scenes.isError) {
    empty = <Text style={[styles.message, { color: colors.danger }]}>{t('v2.scenes.loadError')}</Text>
  } else if (rows.length === 0) {
    empty = (
      <View style={styles.emptyBlock} testID="scenes-empty">
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{t('v2.scenes.empty')}</Text>
        <Text style={[styles.message, { color: colors.foregroundMuted }]}>{t('v2.scenes.emptyHint')}</Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader inset={false} actions={actions} />
      <FlatList
        data={rows}
        keyExtractor={(item) => String(item.deviceId)}
        renderItem={renderItem}
        contentContainerStyle={[styles.content, { paddingBottom: padBottom }]}
        ListEmptyComponent={empty}
        refreshing={false}
        onRefresh={() => {
          void scenes.refetch()
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  content: { padding: SPACING.md, gap: SPACING.sm, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    padding: SPACING.lg,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  camera: { flex: 1, fontSize: 15, fontWeight: '600' },
  detail: { fontSize: 12 },
  skeleton: { gap: SPACING.sm },
  skeletonRow: { height: 52, borderRadius: RADIUS.md },
  emptyBlock: { alignItems: 'center', gap: SPACING.sm, padding: SPACING['2xl'] },
  emptyTitle: { fontSize: 15, fontWeight: '600' },
  message: { fontSize: 14, textAlign: 'center', padding: SPACING.md },
})
