/**
 * GridBuilderScreen — edit a grid's name, per-grid display options, and camera
 * membership (create + edit reuse this same screen).
 *
 * Name lives in a `TextInput` and is committed on blur / back. Below it a
 * compact options card (name overlay toggle) writes through `setGridOptions`,
 * and an Export row shares the grid as JSON. Runtime view settings (quality /
 * layout / highlight) are NOT edited here — the grid runtime toolbar owns
 * them. The body
 * is the device → value picker's list inline (`DeviceValueList`, issue #496):
 * the cameras (`camera-streams`) from `deviceManager.search`, with search and
 * the Location / Integration / Type facets; a ✓ marks members. A camera
 * hidden from the app is not offered.
 * Toggling a row adds/removes through the store so membership persists
 * immediately — "Done" (the glass back button) just commits the name + navigates
 * back. The name/options/export ride in the list header so the whole screen
 * scrolls as one (no nested scroll views).
 */
import React, { useEffect, useMemo, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { Plus, ArrowUpDown } from '../lib/icons.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import { useTheme } from '../theme/theme-provider.js'
import { ScreenHeader } from '../components/ScreenHeader.js'
import { GridBuilderHeader } from '../components/grid/GridBuilderHeader.js'
import { GridManageList } from '../components/grid/GridManageList.js'
import { useCameras, type CameraInfo } from '../data/use-cameras.js'
import { SPACING } from '../theme/tokens.js'
import { DeviceValueList } from '../components/device-value-picker/DeviceValueList.js'
import { CAMERA_REQUIRES, pickedDevices } from '../components/device-value-picker/picked-devices.js'
import { useDeviceValueBrowse } from '../components/device-value-picker/use-device-value-browse.js'
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
  // A camera hidden from the app's lists is not offered here either.
  const { data: allCameras } = useCameras({ includeHidden: true })
  const hiddenFromApp = useMemo(() => {
    const visible = new Set(cameras.map((c) => c.id))
    return (allCameras ?? []).filter((c) => !visible.has(c.id)).map((c) => c.id)
  }, [cameras, allCameras])

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
  const picked = useMemo(() => pickedDevices(grid?.cameraIds ?? []), [grid?.cameraIds])
  const browse = useDeviceValueBrowse({
    requires: CAMERA_REQUIRES,
    excludeIds: hiddenFromApp,
    recentIds: NO_RECENTS,
    enabled: state === 'connected',
  })
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
        <DeviceValueList
          testID="grid-builder-cameras"
          browse={browse}
          caps={CAMERA_REQUIRES.caps}
          kind="device"
          multiple
          picked={picked}
          onPick={(value) => toggleCamera(value.deviceId)}
          onDrill={() => undefined}
          header={<View style={styles.header}>{header}</View>}
        />
      )}
    </View>
  )
}

const NO_RECENTS: readonly number[] = []

const styles = StyleSheet.create({
  header: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.md },
})
