/**
 * GridBuilderScreen (web) — the richer, mouse-first grid builder.
 *
 * Web has a pointer + real drag affordances that native does not, so instead of
 * the native checklist + long-press reorder list, the web builder shows the
 * grid's cameras as a @dnd-kit **sortable thumbnail grid** you drag to reorder
 * (mirrors the legacy `WebCamerasGridWithDnd`), plus an "add cameras" grid of
 * the remaining devices below. Reorder commits through `reorderGridCameras`;
 * add/remove through `addGridCamera`/`removeGridCamera`. The name + options
 * header is the shared `GridBuilderHeader`, identical to native.
 *
 * Platform note: this `.web.tsx` is auto-selected by Metro on web; native keeps
 * `GridBuilderScreen.tsx`. @dnd-kit is DOM-only, hence the web-only split.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { Plus, X } from '../lib/icons.js'
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useConnection } from '../connection/ConnectionProvider.js'
import { useTheme } from '../theme/theme-provider.js'
import { ScreenHeader } from '../components/ScreenHeader.js'
import { GridBuilderHeader } from '../components/grid/GridBuilderHeader.js'
import { useCameras, type CameraInfo } from '../data/use-cameras.js'
import { useSnapshot } from '../data/use-snapshot.js'
import { SnapshotImage } from '../components/camera/SnapshotImage.js'
import { useScreenActive } from '../hooks/use-screen-active.js'
import { shouldRequestSnapshot } from '../components/camera/tile-snapshot-gate.js'
import { SPACING, RADIUS, withAlpha } from '../theme/tokens.js'
import { findServerGrid, useGridStore, resolveGridOptions } from '../store/grid-store.js'
import { useActiveServerId } from '../store/server-scope.js'
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
  const setGridOptions = useGridStore((s) => s.setGridOptions)

  // A grid of ANOTHER hub is not found here: its camera ids name that hub's cameras.
  const serverId = useActiveServerId()
  const grid = useMemo(() => findServerGrid(grids, gridId, serverId), [grids, gridId, serverId])
  const selected = useMemo(() => new Set(grid?.cameraIds ?? []), [grid?.cameraIds])
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
  }, [hydrate])

  const commitName = (): void => {
    if (grid) renameGrid(grid.id, name)
  }

  const handleBack = (): void => {
    commitName()
    if (onClose) onClose()
    else router.back()
  }

  // Grid members in display order (drag reorders these); availables are the rest.
  const byId = useMemo(() => new Map(cameras.map((c) => [c.id, c])), [cameras])
  const orderedMembers = useMemo<readonly CameraInfo[]>(() => {
    if (!grid) return []
    const out: CameraInfo[] = []
    for (const id of grid.cameraIds) {
      const cam = byId.get(id)
      if (cam) out.push(cam)
    }
    return out
  }, [grid, byId])
  const available = useMemo<readonly CameraInfo[]>(
    () => cameras.filter((c) => !selected.has(c.id)),
    [cameras, selected],
  )

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = orderedMembers.map((c) => c.id)
    const oldIndex = ids.indexOf(Number(active.id))
    const newIndex = ids.indexOf(Number(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    reorderGridCameras(gridId, arrayMove(ids, oldIndex, newIndex))
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
      <ScreenHeader title={t('v2.gridBuilder.title')} bordered onBack={handleBack} />
      {/* Not connected: just the header below. The hub-status overlay at the
          app root conveys the state once, never duplicated by a central
          "connecting/offline" line. (FIX 5) */}

      {state !== 'connected' ? (
        header
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {header}

          <SectionLabel text={t('v2.gridBuilder.orderSection')} hint={t('v2.gridBuilder.orderHint')} />
          {orderedMembers.length === 0 ? (
            <Text style={[styles.emptyLine, { color: colors.foregroundSubtle }]}>
              {t('v2.gridBuilder.emptyOrder')}
            </Text>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={orderedMembers.map((c) => c.id)} strategy={rectSortingStrategy}>
                <div style={gridContainerStyle}>
                  {orderedMembers.map((cam) => (
                    <SortableThumb
                      key={cam.id}
                      camera={cam}
                      onRemove={() => removeGridCamera(gridId, cam.id)}
                      removeA11y={t('v2.gridBuilder.removeA11y')}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {available.length > 0 ? (
            <>
              <SectionLabel text={t('v2.gridBuilder.addSection')} />
              <div style={gridContainerStyle}>
                {available.map((cam) => (
                  <AddThumb
                    key={cam.id}
                    camera={cam}
                    onAdd={() => addGridCamera(gridId, cam.id)}
                    addA11y={t('v2.gridBuilder.addA11y')}
                  />
                ))}
              </div>
            </>
          ) : null}
        </div>
      )}
    </View>
  )
}

/** Responsive auto-fill grid of ~16:9 thumbnail cells. */
const gridContainerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: 8,
  padding: SPACING.md,
}

/** A small section heading + optional hint line (RN text on the web flow). */
function SectionLabel({ text, hint }: { readonly text: string; readonly hint?: string }) {
  const { colors } = useTheme()
  return (
    <View style={styles.sectionHead}>
      <Text style={[styles.sectionLabel, { color: colors.foregroundMuted }]}>{text}</Text>
      {hint ? <Text style={[styles.sectionHint, { color: colors.foregroundSubtle }]}>{hint}</Text> : null}
    </View>
  )
}

/** One draggable member thumbnail (snapshot + name) with a remove button. */
function SortableThumb({
  camera,
  onRemove,
  removeA11y,
}: {
  readonly camera: CameraInfo
  readonly onRemove: () => void
  readonly removeA11y: string
}) {
  const { colors } = useTheme()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: camera.id,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 50 : 0,
    cursor: 'grab',
    position: 'relative',
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <CameraThumb camera={camera} />
      <button
        type="button"
        aria-label={removeA11y}
        // Stop the drag sensor from claiming the pointer so the click registers.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        style={{ ...removeButtonStyle, background: withAlpha(colors.dangerFill, 0.92) }}
      >
        <X size={14} color={colors.dangerOn} />
      </button>
    </div>
  )
}

/** One available-camera thumbnail; clicking adds it to the grid. */
function AddThumb({
  camera,
  onAdd,
  addA11y,
}: {
  readonly camera: CameraInfo
  readonly onAdd: () => void
  readonly addA11y: string
}) {
  const { colors } = useTheme()
  return (
    <button type="button" aria-label={addA11y} onClick={onAdd} style={addButtonStyle}>
      <CameraThumb camera={camera} dimmed />
      <span style={{ ...addBadgeStyle, background: withAlpha(colors.primaryFill, 0.95) }}>
        <Plus size={16} color={colors.primaryOn} />
      </span>
    </button>
  )
}

/** Requested width for a palette thumb, in device px (200-400 CSS px tile). */
const PALETTE_THUMB_SNAPSHOT_WIDTH = 480

/** Snapshot-backed 16:9 thumbnail with a name + status footer. */
function CameraThumb({ camera, dimmed }: { readonly camera: CameraInfo; readonly dimmed?: boolean }) {
  const { colors } = useTheme()
  const screenActive = useScreenActive()
  const snapshotEnabled = shouldRequestSnapshot({
    screenActive,
    online: camera.online,
    disabled: camera.disabled,
    sleeping: false,
  })
  // Palette tiles are a CSS grid of `minmax(200px, 1fr)`, so 200-400 px wide —
  // and the palette can render EVERY camera on the install at once.
  // Every camera on the install, whatever its state — the hub provisions the
  // tile (D190), so an offline camera is still recognisable when you are
  // building a wall out of them. Demand still dies when this surface is covered.
  const snapshot = useSnapshot(camera.id, snapshotEnabled, PALETTE_THUMB_SNAPSHOT_WIDTH)
  return (
    <View
      style={[
        styles.thumb,
        // ui-check-ok: video letterbox — a camera picture sits on black in both themes
        { borderColor: colors.border, backgroundColor: '#000', opacity: dimmed ? 0.7 : 1 },
      ]}
    >
      {snapshot.uri !== null ? (
        <SnapshotImage source={snapshot} deviceId={camera.id} style={styles.thumbImage} />
      ) : (
        <View style={[styles.thumbImage, styles.thumbPlaceholder]} />
      )}
      <View style={styles.thumbFooter} pointerEvents="none">
        <View
          style={[
            styles.dot,
            { backgroundColor: camera.online ? colors.success : colors.foregroundDisabled },
          ]}
        />
        <Text style={styles.thumbName} numberOfLines={1}>
          {camera.name}
        </Text>
      </View>
    </View>
  )
}

const removeButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 6,
  width: 24,
  height: 24,
  borderRadius: 12,
  border: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
}

const addButtonStyle: React.CSSProperties = {
  position: 'relative',
  padding: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  display: 'block',
  width: '100%',
}

const addBadgeStyle: React.CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 6,
  width: 24,
  height: 24,
  borderRadius: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING['2xl'],
  },
  sectionHead: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    gap: SPACING.xs,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHint: {
    fontSize: 12,
  },
  emptyLine: {
    fontSize: 14,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
  },
  thumb: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    backgroundColor: '#111', // ui-check-ok: video letterbox placeholder
  },
  thumbFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: '#0009', // ui-check-ok: scrim over a camera picture
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  thumbName: { flex: 1, color: '#fafaf9', fontSize: 12, fontWeight: '600' }, // ui-check-ok: text on the picture scrim
})
