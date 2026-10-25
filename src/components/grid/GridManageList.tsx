/**
 * GridManageList — per-grid camera management in "reorder mode":
 *   • drag-reorder (native long-press via the left grip handle)
 *   • hide / show a camera on the live wall (eye toggle; hidden rows greyed)
 *   • remove a camera from the grid (trash)
 *
 * Supersedes the reorder-only `GridReorderList`: it still renders lightweight
 * rows (NOT live tiles) so we never mount N WebRTC peers mid-drag, but each row
 * carries the hide/remove affordances V1 parity needs. Local optimistic order is
 * kept in state and committed up via `onReorder`; hide/remove are committed
 * immediately through their callbacks.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Pressable, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import DraggableFlatList, {
  ScaleDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist'
import { GripVertical, Eye, EyeOff, Trash2, Volume2, VolumeX } from '../../lib/icons.js'
import { hapticTap, hapticAction } from '../../lib/haptics.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import type { CameraInfo } from '../../data/use-cameras.js'

interface GridManageListProps {
  /** Grid members in display order. */
  readonly cameras: readonly CameraInfo[]
  /** Device ids currently hidden from the live wall. */
  readonly hiddenIds: ReadonlySet<number>
  /** Device ids whose audio starts ON when the grid opens. */
  readonly audioOnIds: ReadonlySet<number>
  /** Commit the new device-id order (drag end). */
  readonly onReorder: (order: readonly number[]) => void
  /** Hide/show one camera on the live wall. */
  readonly onToggleHidden: (cameraId: number, hidden: boolean) => void
  /** Toggle whether a camera's audio starts ON when the grid opens. */
  readonly onToggleAudio: (cameraId: number, on: boolean) => void
  /** Remove one camera from the grid entirely. */
  readonly onRemove: (cameraId: number) => void
}

/** Manage list: drag-reorder + hide/show + initial-audio + remove a grid's cameras. */
export function GridManageList({
  cameras,
  hiddenIds,
  audioOnIds,
  onReorder,
  onToggleHidden,
  onToggleAudio,
  onRemove,
}: GridManageListProps) {
  const [data, setData] = useState<readonly CameraInfo[]>(cameras)

  // Keep local order in sync when membership changes externally (add/remove).
  useEffect(() => {
    setData(cameras)
  }, [cameras])

  const handleDragEnd = useCallback(
    ({ data: next }: { data: CameraInfo[] }) => {
      setData(next)
      onReorder(next.map((c) => c.id))
    },
    [onReorder],
  )

  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<CameraInfo>) => (
      <GridManageRow
        camera={item}
        hidden={hiddenIds.has(item.id)}
        audioOn={audioOnIds.has(item.id)}
        drag={drag}
        isActive={isActive}
        onToggleHidden={onToggleHidden}
        onToggleAudio={onToggleAudio}
        onRemove={onRemove}
      />
    ),
    [hiddenIds, audioOnIds, onToggleHidden, onToggleAudio, onRemove],
  )

  return (
    <DraggableFlatList
      data={data as CameraInfo[]}
      keyExtractor={(c) => String(c.id)}
      onDragEnd={handleDragEnd}
      renderItem={renderItem}
      contentContainerStyle={styles.content}
      activationDistance={8}
    />
  )
}

/** A single manage row. Greyed when hidden; the eye toggles wall visibility,
 *  the trash removes the camera from the grid. The grip is the drag handle. */
const GridManageRow = React.memo(function GridManageRow({
  camera,
  hidden,
  audioOn,
  drag,
  isActive,
  onToggleHidden,
  onToggleAudio,
  onRemove,
}: {
  readonly camera: CameraInfo
  readonly hidden: boolean
  readonly audioOn: boolean
  readonly drag: () => void
  readonly isActive: boolean
  readonly onToggleHidden: (cameraId: number, hidden: boolean) => void
  readonly onToggleAudio: (cameraId: number, on: boolean) => void
  readonly onRemove: (cameraId: number) => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  // The platform's drag cue, fired ONCE wherever the drag was started from —
  // the row's long-press or the grip. Only one of the two ever gets the touch,
  // and neither buzzes without the other because both go through here.
  const startDrag = useCallback((): void => {
    hapticTap()
    drag()
  }, [drag])
  return (
    <ScaleDecorator>
      <Pressable
        style={[
          styles.row,
          {
            backgroundColor: isActive ? colors.surfaceHover : colors.surface,
            borderColor: colors.border,
            opacity: hidden ? 0.5 : 1,
          },
        ]}
        onLongPress={startDrag}
        delayLongPress={200}
      >
        <Pressable onPressIn={startDrag} hitSlop={8} accessibilityLabel={t('v2.gridView.dragA11y')}>
          <GripVertical size={20} color={colors.foregroundMuted} />
        </Pressable>
        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
          {camera.name}
        </Text>
        <Pressable
          onPress={() => { hapticTap(); onToggleHidden(camera.id, !hidden) }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={hidden ? t('v2.gridView.showA11y') : t('v2.gridView.hideA11y')}
          accessibilityState={{ selected: !hidden }}
        >
          {hidden ? (
            <EyeOff size={18} color={colors.foregroundMuted} />
          ) : (
            <Eye size={18} color={colors.primary} />
          )}
        </Pressable>
        <Pressable
          onPress={() => { hapticTap(); onToggleAudio(camera.id, !audioOn) }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Initial audio"
          accessibilityState={{ selected: audioOn }}
        >
          {audioOn ? (
            <Volume2 size={18} color={colors.primary} />
          ) : (
            <VolumeX size={18} color={colors.foregroundMuted} />
          )}
        </Pressable>
        <Pressable
          onPress={() => { hapticAction(); onRemove(camera.id) }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('v2.gridView.removeA11y')}
        >
          <Trash2 size={18} color={colors.danger} />
        </Pressable>
      </Pressable>
    </ScaleDecorator>
  )
})

const styles = StyleSheet.create({
  content: { padding: SPACING.md, gap: SPACING.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
  },
  name: { flex: 1, fontSize: 16, fontWeight: '600' },
})
