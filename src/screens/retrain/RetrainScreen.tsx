/**
 * RetrainScreen — admin Library tab for frames already in the retrain corpus.
 *
 * The shared Library filter bar (camera, collection — single-pick; "+" new
 * collection, `⋯` rename / delete the one browsed) + the shared Library grid
 * (`LibraryTile`, `library-grid.ts`). No marking, no tracks,
 * no labeling canvas — a tap opens the annotation editor route. Collections:
 * create, rename, delete; selection can add/remove frames.
 */
import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  RefreshControl,
} from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useTranslation } from 'react-i18next'
import type { RetrainFrame } from '@camstack/types'
import { LibraryFilterBar, type LibraryFilterDef } from '../../components/ui/LibraryFilterBar.js'
import type { OverflowMenuItem } from '../../components/ui/HeaderOverflowMenu.js'
import { useLibraryGrid } from '../../components/ui/use-library-grid.js'
import {
  LIBRARY_GRID_BOTTOM_PADDING,
  LIBRARY_GRID_GAP,
  LIBRARY_GRID_PADDING,
} from '../../components/ui/library-grid.js'
import { RetrainCorpusSkeleton } from './RetrainCorpusSkeleton.js'
import { useConfirm, usePrompt } from '../../components/ui/confirm.js'
import { PickerSheet } from '../../components/ui/PickerSheet.js'
import { useCameras } from '../../data/use-cameras.js'
import { useKnownCameraIds, useLibraryFilter } from '../../hooks/use-library-filter.js'
import {
  parseRetrainRemembered,
  pruneRetrainRemembered,
  type RetrainRemembered,
} from '../../store/library-filters.js'
import { useRouter } from 'expo-router'
import { retrainFrameHref } from '../../navigation/retrain-routes.js'
import {
  useAddRetrainFramesToCollection,
  useDeleteRetrainCollection,
  useRemoveRetrainFrameFromCollection,
  useRenameRetrainCollection,
  useRetrainCorpusPages,
} from '../../data/use-retrain-corpus.js'
import {
  useCreateRetrainCollection,
  useRetrainCollections,
} from '../../data/use-retrain-collections.js'
import { FolderOpen, Images, Pencil, Plus, Trash2 } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { useTabScrollPadding } from '../../navigation/bottom-nav-inset.js'
import { chunkRetrainRows, sortNewestFirst } from '../../retrain/corpus-list.js'
import { RetrainFrameThumb } from './RetrainFrameThumb.js'
import { EmptyState, ErrorState } from '../../components/ui/EmptyState.js'

type SheetKind = 'move' | null

export function RetrainScreen() {
  const { t } = useTranslation()
  const gridPadBottom = useTabScrollPadding(LIBRARY_GRID_BOTTOM_PADDING)
  const grid = useLibraryGrid()
  const { colors } = useTheme()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const router = useRouter()
  const camerasQuery = useCameras()
  const cameras = camerasQuery.data ?? []
  const cameraNames = useMemo(() => {
    const map = new Map<number, string>()
    for (const c of cameras) map.set(c.id, c.name)
    return map
  }, [cameras])

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [sheet, setSheet] = useState<SheetKind>(null)

  const collections = useRetrainCollections()
  // The camera and the collection are remembered on this device; one that is
  // no longer on the hub (a deleted camera, a deleted collection) is dropped.
  const knownCameras = useKnownCameraIds()
  const knownCollections = useMemo(
    () => (collections.data === undefined ? undefined : new Set(collections.data.map((c) => c.id))),
    [collections.data],
  )
  const pruneRemembered = useCallback(
    (value: RetrainRemembered) => pruneRetrainRemembered(value, knownCameras, knownCollections),
    [knownCameras, knownCollections],
  )
  const remembered = useLibraryFilter('retrain', parseRetrainRemembered, pruneRemembered)
  const { deviceId, collectionId } = remembered.value
  const { set: remember, clear: forgetFilters } = remembered
  const setDeviceId = useCallback(
    (update: (prev: number | null) => number | null) => remember((prev) => ({ ...prev, deviceId: update(prev.deviceId) })),
    [remember],
  )
  const setCollectionId = useCallback(
    (update: (prev: string | null) => string | null) =>
      remember((prev) => ({ ...prev, collectionId: update(prev.collectionId) })),
    [remember],
  )
  const corpus = useRetrainCorpusPages(
    {
      ...(deviceId !== null ? { deviceIds: [deviceId] } : {}),
      ...(collectionId !== null ? { collectionIds: [collectionId] } : {}),
    },
    remembered.hydrated,
  )
  const createCollection = useCreateRetrainCollection()
  const renameCollection = useRenameRetrainCollection()
  const deleteCollection = useDeleteRetrainCollection()
  const addToCollection = useAddRetrainFramesToCollection()
  const removeFromCollection = useRemoveRetrainFrameFromCollection()

  const frames = useMemo(() => sortNewestFirst(corpus.frames), [corpus.frames])
  const rows = useMemo(() => chunkRetrainRows(frames, grid.columns), [frames, grid.columns])
  const [pulling, setPulling] = useState(false)
  const { refetch } = corpus
  const onPullRefresh = useCallback(() => {
    setPulling(true)
    void refetch().finally(() => setPulling(false))
  }, [refetch])
  const collectionRows = collections.data ?? []

  const toggleSelect = useCallback((frameId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(frameId)) next.delete(frameId)
      else next.add(frameId)
      return next
    })
  }, [])

  const onFramePress = useCallback(
    (frame: RetrainFrame) => {
      if (selectedIds.size > 0) {
        toggleSelect(frame.frameId)
        return
      }
      router.push(retrainFrameHref(frame.frameId, { deviceId, collectionId }))
    },
    [selectedIds.size, toggleSelect, router, deviceId, collectionId],
  )

  const onCreateCollection = useCallback(async () => {
    const name = await prompt({
      title: t('v2.retrain.collections.createTitle', 'New collection'),
      message: t('v2.retrain.collections.createMessage', 'Name for this working set.'),
      placeholder: t('v2.retrain.collections.namePlaceholder', 'Name'),
    })
    if (name === null || name.trim() === '') return
    await createCollection.mutateAsync(name.trim())
  }, [createCollection, prompt, t])

  const onRenameCollection = useCallback(async () => {
    if (collectionId === null) return
    const current = collectionRows.find((c) => c.id === collectionId)
    const name = await prompt({
      title: t('v2.retrain.collections.renameTitle', 'Rename collection'),
      message: t('v2.retrain.collections.renameMessage', 'New name.'),
      placeholder: current?.name ?? '',
      initialValue: current?.name,
    })
    if (name === null || name.trim() === '') return
    await renameCollection.mutateAsync({ id: collectionId, name: name.trim() })
  }, [collectionId, collectionRows, prompt, renameCollection, t])

  const onDeleteCollection = useCallback(async () => {
    if (collectionId === null) return
    const current = collectionRows.find((c) => c.id === collectionId)
    const ok = await confirm({
      title: t('v2.retrain.collections.deleteTitle', 'Delete collection?'),
      message: t(
        'v2.retrain.collections.deleteMessage',
        'Remove “{{name}}”. Frames stay in the corpus.',
        { name: current?.name ?? collectionId },
      ),
      confirmLabel: t('v2.common.delete', 'Delete'),
      destructive: true,
    })
    if (!ok) return
    await deleteCollection.mutateAsync(collectionId)
    setCollectionId(() => null)
  }, [collectionId, collectionRows, confirm, deleteCollection, setCollectionId, t])

  const onMoveToCollection = useCallback(
    async (targetId: string) => {
      const ids = [...selectedIds]
      if (ids.length === 0) return
      await addToCollection.mutateAsync({ collectionId: targetId, frameIds: ids })
      setSelectedIds(new Set())
      setSheet(null)
    },
    [addToCollection, selectedIds],
  )

  const onRemoveFromCollection = useCallback(async () => {
    if (collectionId === null || selectedIds.size === 0) return
    for (const frameId of selectedIds) {
      await removeFromCollection.mutateAsync({ collectionId, frameId })
    }
    setSelectedIds(new Set())
  }, [collectionId, removeFromCollection, selectedIds])

  const cameraLabel =
    deviceId === null
      ? t('v2.retrain.filter.allCameras', 'All cameras')
      : (cameraNames.get(deviceId) ?? `#${String(deviceId)}`)
  const collectionLabel =
    collectionId === null
      ? t('v2.retrain.filter.allCollections', 'All collections')
      : (collectionRows.find((c) => c.id === collectionId)?.name ?? collectionId)

  const pending = corpus.isLoading || corpus.isPending
  const failed = corpus.isError

  const closeSheet = useCallback(() => setSheet(null), [])

  // The Library's one filter idiom: a chip per facet, each a single-pick list
  // in the anchored menu (picking the ticked row clears it back to "all").
  const filters: readonly LibraryFilterDef[] = [
    {
      id: 'camera',
      label: deviceId === null ? t('v2.retrain.filter.camera', 'Camera') : cameraLabel,
      count: 0,
      active: deviceId !== null,
      sections: [
        {
          title: t('v2.retrain.filter.camera', 'Camera'),
          options: cameras.map((c) => ({ key: String(c.id), label: c.name })),
          selected: deviceId === null ? [] : [String(deviceId)],
          closeOnPick: true,
          onToggle: (key) => setDeviceId((prev) => (prev === Number(key) ? null : Number(key))),
          searchPlaceholder: t('v2.events.searchCameras'),
        },
      ],
    },
    {
      id: 'collection',
      label: collectionId === null ? t('v2.retrain.filter.collection', 'Collection') : collectionLabel,
      count: 0,
      active: collectionId !== null,
      sections: [
        {
          title: t('v2.retrain.filter.collection', 'Collection'),
          options: collectionRows.map((c) => ({ key: c.id, label: `${c.name} (${String(c.frameCount)})` })),
          selected: collectionId === null ? [] : [collectionId],
          closeOnPick: true,
          onToggle: (key) => setCollectionId((prev) => (prev === key ? null : key)),
        },
      ],
    },
  ]
  const onResetFilters = forgetFilters
  // The collection being browsed can be renamed or deleted: the `⋯` menu.
  const moreItems: readonly OverflowMenuItem[] =
    collectionId !== null
      ? [
          {
            id: 'rename-collection',
            icon: Pencil,
            label: t('v2.retrain.collections.rename'),
            onPress: () => void onRenameCollection(),
          },
          {
            id: 'delete-collection',
            icon: Trash2,
            label: t('v2.retrain.collections.delete'),
            onPress: () => void onDeleteCollection(),
          },
        ]
      : []

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]} onLayout={grid.onLayout}>
      <LibraryFilterBar
        filters={filters}
        onReset={onResetFilters}
        more={moreItems}
        moreTestID="retrain-action-more"
        primary={{
          id: 'new-collection',
          icon: Plus,
          label: t('v2.retrain.collections.create'),
          onPress: () => void onCreateCollection(),
          testID: 'retrain-action-new-collection',
        }}
        summary={
          pending || failed
            ? ' '
            : t('v2.retrain.frameCount', { count: corpus.total > 0 ? corpus.total : frames.length })
        }
        testID="retrain-toolbar"
      />

      {selectedIds.size > 0 ? (
        <View
          style={[
            styles.selectionBar,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={{ color: colors.foreground, fontSize: 12 }}>
            {t('v2.retrain.selected', '{{count}} selected', { count: selectedIds.size })}
          </Text>
          <Pressable onPress={() => setSheet('move')}>
            <Text style={{ color: colors.primary, fontSize: 12 }}>
              {t('v2.retrain.moveToCollection', 'Add to collection')}
            </Text>
          </Pressable>
          {collectionId !== null ? (
            <Pressable onPress={() => void onRemoveFromCollection()}>
              <Text style={{ color: colors.danger, fontSize: 12 }}>
                {t('v2.retrain.removeFromCollection', 'Remove from collection')}
              </Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => setSelectedIds(new Set())}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
              {t('v2.common.clear', 'Clear')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {pending ? (
        <RetrainCorpusSkeleton />
      ) : failed ? (
        <ErrorState title={t('v2.retrain.corpusError')} onRetry={() => { void refetch() }} />
      ) : frames.length === 0 ? (
        <EmptyState icon={Images} title={t('v2.retrain.corpusEmptyTitle')} body={t('v2.retrain.corpusEmptyBody')} />
      ) : (
        <FlashList
          key={`cols-${String(grid.columns)}`}
          data={rows}
          extraData={selectedIds}
          keyExtractor={(row) => row.map((frame) => frame.frameId).join('|')}
          onEndReached={corpus.fetchNextPage}
          onEndReachedThreshold={0.6}
          refreshControl={
            <RefreshControl
              refreshing={pulling}
              onRefresh={onPullRefresh}
              tintColor={colors.foregroundMuted}
              colors={[colors.primary]}
            />
          }
          contentContainerStyle={[styles.grid, { paddingBottom: gridPadBottom }]}
          renderItem={({ item }) => (
            <View style={styles.row}>
              {item.map((frame) => (
                <RetrainFrameThumb
                  key={frame.frameId}
                  frame={frame}
                  width={grid.tileWidth}
                  selected={selectedIds.has(frame.frameId)}
                  selectionMode={selectedIds.size > 0}
                  cameraName={cameraNames.get(frame.deviceId) ?? `#${String(frame.deviceId)}`}
                  onPress={() => onFramePress(frame)}
                  onLongPress={() => toggleSelect(frame.frameId)}
                />
              ))}
            </View>
          )}
          ListFooterComponent={
            corpus.isFetchingNextPage ? <ActivityIndicator style={{ margin: SPACING.md }} /> : null
          }
        />
      )}

      {sheet === 'move' ? (
        <PickerSheet
          title={t('v2.retrain.moveToCollection', 'Add to collection')}
          onClose={closeSheet}
          headerRight={
            <Pressable onPress={closeSheet} hitSlop={8}>
              <Text style={{ color: colors.primary, fontWeight: '600' }}>
                {t('v2.common.close', 'Close')}
              </Text>
            </Pressable>
          }
        >
          <ScrollView>
            {collectionRows.length === 0 ? (
              <EmptyState fill={false} icon={FolderOpen} title={t('v2.retrain.collections.empty')} />
            ) : (
              collectionRows.map((c) => (
                <OptionRow
                  key={c.id}
                  label={c.name}
                  selected={false}
                  onPress={() => void onMoveToCollection(c.id)}
                />
              ))
            )}
          </ScrollView>
        </PickerSheet>
      ) : null}
    </View>
  )
}

function OptionRow({
  label,
  selected,
  onPress,
}: {
  readonly label: string
  readonly selected: boolean
  readonly onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.option,
        {
          backgroundColor: selected ? colors.surfaceHover : colors.surface,
          borderBottomColor: colors.border,
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={{ color: colors.foreground, fontSize: 14 }}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  selectionBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  grid: { paddingVertical: SPACING.sm, gap: LIBRARY_GRID_GAP },
  row: { flexDirection: 'row', gap: LIBRARY_GRID_GAP, paddingHorizontal: LIBRARY_GRID_PADDING },
  option: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
})
