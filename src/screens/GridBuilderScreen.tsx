/**
 * GridBuilderScreen — edit a grid's name, per-grid display options, and camera
 * membership (create + edit reuse this same screen).
 *
 * Name lives in a `TextInput` and is committed on blur / back. Below it a
 * compact options card (name overlay toggle) writes through `setGridOptions`,
 * and an Export row shares the grid as JSON. Runtime view settings (quality /
 * layout / highlight) are NOT edited here — the grid runtime toolbar owns
 * them. The body
 * is a multi-select list of the server's cameras (`useCameras`, the
 * authoritative `deviceManager.listAll` query); a lucide `Check` marks members.
 * Toggling a row adds/removes through the store so membership persists
 * immediately — "Done" (the glass back button) just commits the name + navigates
 * back. The name/options/export ride in the list header so the whole screen
 * scrolls as one (no nested scroll views).
 */
import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { Check, Plus, ArrowUpDown } from '../lib/icons.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import { useTheme } from '../theme/theme-provider.js'
import { ScreenHeader } from '../components/ScreenHeader.js'
import { GridBuilderHeader } from '../components/grid/GridBuilderHeader.js'
import { GridManageList } from '../components/grid/GridManageList.js'
import { useCameras, type CameraInfo } from '../data/use-cameras.js'
import { SPACING, RADIUS } from '../theme/tokens.js'
import { findServerGrid, useGridStore, resolveGridOptions } from '../store/grid-store.js'
import { useActiveServerId } from '../store/server-scope.js'
import { useGridLocalStore } from '../store/grid-local-store.js'
import { exportGrid } from '../data/grid-export.js'

interface GridBuilderScreenProps {
  readonly gridId: string
  /** When set, "Done"/back calls this instead of `router.back()` — lets the web
   *  builder render inside a modal (close the overlay) while mobile keeps page
   *  navigation. */
  readonly onClose?: () => void
}

export function GridBuilderScreen({ gridId, onClose }: GridBuilderScreenProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const { state } = useConnection()
  const { data: cameras = [] } = useCameras()

  const grids = useGridStore((s) => s.grids)
  const hydrate = useGridStore((s) => s.hydrate)
  const renameGrid = useGridStore((s) => s.renameGrid)
  const addGridCamera = useGridStore((s) => s.addGridCamera)
  const removeGridCamera = useGridStore((s) => s.removeGridCamera)
  const reorderGridCameras = useGridStore((s) => s.reorderGridCameras)
  const setGridCameraHidden = useGridStore((s) => s.setGridCameraHidden)
  const setGridOptions = useGridStore((s) => s.setGridOptions)
  // Which cameras open with sound is DEVICE-LOCAL (`grid-local-store`).
  const setGridAudioInitial = useGridLocalStore((s) => s.setGridAudioInitial)
  const storedAudioOnIds = useGridLocalStore((s) => s.local.byId[gridId]?.audioOnIds)
  const hydrateGridLocal = useGridLocalStore((s) => s.hydrate)

  // A grid of ANOTHER hub is not found here: its camera ids name that hub's cameras.
  const serverId = useActiveServerId()
  const grid = useMemo(() => findServerGrid(grids, gridId, serverId), [grids, gridId, serverId])
  const selected = useMemo(() => new Set(grid?.cameraIds ?? []), [grid?.cameraIds])
  // Members resolved to live camera info, in grid order — for the arrange mode
  // (drag-reorder + hide/show + remove all live here, in "edit").
  const memberCameras = useMemo<readonly CameraInfo[]>(() => {
    if (!grid) return []
    const byId = new Map(cameras.map((c) => [c.id, c]))
    const out: CameraInfo[] = []
    for (const id of grid.cameraIds) {
      const cam = byId.get(id)
      if (cam) out.push(cam)
    }
    return out
  }, [grid, cameras])
  const hiddenIds = useMemo(() => new Set(grid?.hiddenCameraIds ?? []), [grid?.hiddenCameraIds])
  const audioOnIds = useMemo(() => new Set(storedAudioOnIds ?? []), [storedAudioOnIds])
  const [mode, setMode] = useState<'add' | 'arrange'>('add')
  // Effective options (per-grid → built-in defaults). The builder shows/edits
  // the per-grid override directly so an unset field stays inherited.
  const options = useMemo(() => resolveGridOptions(grid?.options), [grid?.options])

  const [name, setName] = useState('')
  // Seed the name field once per grid id (post-hydration), adjusted during
  // render — no setState-in-effect cascade, and store updates (add camera,
  // commit) never clobber in-progress typing.
  const [seededGridId, setSeededGridId] = useState<string | null>(null)
  if (grid && seededGridId !== grid.id) {
    setSeededGridId(grid.id)
    setName(grid.name)
  }

  useEffect(() => {
    void hydrate()
    void hydrateGridLocal()
  }, [hydrate, hydrateGridLocal])

  const commitName = (): void => {
    if (grid) renameGrid(grid.id, name)
  }

  const toggleCamera = (id: number): void => {
    if (!grid) return
    if (selected.has(id)) removeGridCamera(grid.id, id)
    else addGridCamera(grid.id, id)
  }

  const handleBack = (): void => {
    commitName()
    if (onClose) onClose()
    else router.back()
  }

  const header = (
    <GridBuilderHeader
      name={name}
      onChangeName={setName}
      onCommitName={commitName}
      options={options}
      onSetOption={(patch) => setGridOptions(gridId, patch)}
      onExport={() => {
        if (grid) void exportGrid(grid)
      }}
      selectedCount={selected.size}
    />
  )

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={t('v2.gridBuilder.title')}
        bordered
        onBack={handleBack}
        actions={
          memberCameras.length > 0
            ? [
                {
                  id: 'mode',
                  icon: mode === 'add' ? ArrowUpDown : Plus,
                  label: mode === 'add' ? t('v2.gridBuilder.orderSection') : t('v2.gridBuilder.addSection'),
                  onPress: () => setMode((m) => (m === 'add' ? 'arrange' : 'add')),
                  active: mode === 'arrange',
                },
              ]
            : undefined
        }
      />
      {/* Not connected: just the header below. The hub-status overlay at the
          app root conveys the state once, never duplicated by a central
          "connecting/offline" line. (FIX 5) */}

      {state !== 'connected' ? (
        header
      ) : mode === 'arrange' ? (
        <GridManageList
          cameras={memberCameras}
          hiddenIds={hiddenIds}
          audioOnIds={audioOnIds}
          onReorder={(order) => reorderGridCameras(gridId, order)}
          onToggleHidden={(cameraId, hidden) => setGridCameraHidden(gridId, cameraId, hidden)}
          onToggleAudio={(cameraId, on) => setGridAudioInitial(gridId, cameraId, on)}
          onRemove={(cameraId) => removeGridCamera(gridId, cameraId)}
        />
      ) : (
        <FlatList
          data={cameras}
          keyExtractor={(c) => String(c.id)}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={{ color: colors.foregroundMuted, fontSize: 15 }}>{t('v2.cameras.empty')}</Text>
            </View>
          }
          contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingBottom: SPACING['2xl'], gap: SPACING.md }}
          renderItem={({ item }) => (
            <CameraSelectRow
              camera={item}
              selected={selected.has(item.id)}
              onToggle={() => toggleCamera(item.id)}
            />
          )}
        />
      )}
    </View>
  )
}

/** A selectable camera row (checkbox + name + online status). */
function CameraSelectRow({
  camera,
  selected,
  onToggle,
}: {
  readonly camera: CameraInfo
  readonly selected: boolean
  readonly onToggle: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.lg,
        backgroundColor: pressed ? colors.surfaceHover : colors.surface,
        borderColor: selected ? colors.primary : colors.border,
        borderWidth: 1,
        borderRadius: RADIUS.md,
        paddingVertical: SPACING.lg,
        paddingHorizontal: SPACING.xl,
      })}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: RADIUS.sm,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.primary : 'transparent',
        }}
      >
        {selected ? <Check size={16} color={colors.primaryForeground} /> : null}
      </View>
      <View style={{ flex: 1, gap: SPACING.xs }}>
        <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: '600' }}>{camera.name}</Text>
        <Text style={{ color: camera.online ? colors.success : colors.foregroundMuted, fontSize: 12 }}>
          {camera.online ? t('v2.common.online') : t('v2.common.offline')}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING['2xl'],
  },
})
