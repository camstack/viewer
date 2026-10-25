/**
 * GridsScreen — list of saved camera grids.
 *
 * Reads grids from the persisted `useGridStore` and renders one card per grid.
 * The card is the whole point of the screen: before opening a wall the operator
 * should be able to tell, without opening it, WHICH cameras it holds and
 * whether it is going to work. Every fact on it comes from
 * `grid/grid-summary.ts` — one pure place, unit-tested — and nothing on it is
 * invented:
 *
 *   • which cameras, by name, in the grid's own display order,
 *   • how many are hidden from the wall, offline, or switched off,
 *   • how many member ids the hub no longer carries (removed, or out of this
 *     user's access scope) — previously these just vanished from the strip,
 *   • the wall settings that are NOT the default (fixed layout, pinned quality,
 *     active-only, highlight off, initial audio).
 *
 * There is deliberately no "last opened": the grid document has never recorded
 * one and nothing else in the app does either.
 *
 * ADHERENCE. This screen used to apply `insets.top` by hand and paint its own
 * ad-hoc card. It now wears the same chrome as the Cameras list — `ScreenHeader`
 * (the single place srcV2 takes the top inset), the shared
 * `SPACING`/`RADIUS`/`TYPOGRAPHY` tokens, and the corner FAB for the primary
 * action.
 *
 * RESPONSIVE. The column count comes from the SAME `useGridColumns` the cameras
 * list uses, capped by `gridCardColumns` (cards carry text, so they stop at 3
 * where tiles go to 6). The preview strip then asks `gridPreviewThumbCount` how
 * many snapshots the resulting card width can actually hold — a fixed four was
 * right on exactly one viewport.
 *
 * Create + edit are PLATFORM-AWARE: on native they push the full
 * `GridBuilderScreen` page (`/grid/<id>/edit`); on web they open the SAME
 * builder inside a modal overlay (one source of truth — the builder body is
 * reused, closed via its `onClose` prop) so the user never leaves the list.
 * Creating a grid opens the builder DIRECTLY (with an i18n'd default name).
 *
 * Sharing a grid opens the `GridShareDialog`: pick quality/layout/highlight +
 * a TTL, mint a scoped view token, and copy/share a standalone embed link.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, FlatList, Pressable, StyleSheet, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useBottomNavInset } from '../navigation/bottom-nav-inset.js'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import {
  Plus,
  LayoutGrid,
  Share2,
  Trash2,
  Pencil,
  Volume2,
  EyeOff,
  WifiOff,
  Power,
  HelpCircle,
  Gauge,
  Filter,
  Zap,
  MapPin,
} from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING, RADIUS, TYPOGRAPHY, type ColorTokens } from '../theme/tokens.js'
import { gridsForServer, useGridStore, resolveGridOptions, type Grid } from '../store/grid-store.js'
import { useActiveServerId } from '../store/server-scope.js'
import { resolveGridLayout, resolveGridQuality, useGridLocalStore } from '../store/grid-local-store.js'
import { GridShareDialog } from '../components/grid/GridShareDialog.js'
import { ScreenHeader } from '../components/ScreenHeader.js'
import { useServer } from '../app/ServerProvider.js'
import { useCameras, type CameraInfo } from '../data/use-cameras.js'
import { useSnapshot } from '../data/use-snapshot.js'
import { SnapshotImage } from '../components/camera/SnapshotImage.js'
import { useScreenActive } from '../hooks/use-screen-active.js'
import { shouldRequestSnapshot } from '../components/camera/tile-snapshot-gate.js'
import { qualityLabelKey } from '../components/camera/stream-quality-labels.js'
import { useGridColumns, snapshotWidthForCssPx } from '../hooks/use-responsive.js'
import { useViewportSize } from '../hooks/use-viewport-size.js'
import {
  gridCardColumns,
  gridCardWidth,
  gridPreviewThumbCount,
  summarizeGrid,
  type GridHealth,
  type GridMemberRef,
  type GridSummary,
} from '../grid/grid-summary.js'
import { GridBuilderScreen } from './GridBuilderScreen.js'
import { SheetModal } from '../components/ui/SheetModal.js'
import { useConfirm } from '../components/ui/confirm.js'

/** Height (pt) of a card's snapshot preview strip. */
const PREVIEW_STRIP_HEIGHT = 76

/** A list cell: a grid card, or an invisible pad that keeps the last row's cards
 *  the same width as full rows (instead of a lone card stretching). */
type ListCell = { readonly kind: 'grid'; readonly grid: Grid } | { readonly kind: 'pad'; readonly id: string }

export function GridsScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  // The floating tab bar covers the window's bottom edge; lists scroll under it.
  const navInset = Math.max(useBottomNavInset(), insets.bottom)
  const { server } = useServer()
  const serverUrl = server?.serverUrl ?? null

  // Only THIS hub's grids: camera ids are per hub (`Grid.serverId`).
  const serverId = useActiveServerId()
  const allGrids = useGridStore((s) => s.grids)
  const grids = useMemo(() => gridsForServer(allGrids, serverId), [allGrids, serverId])
  const hydrate = useGridStore((s) => s.hydrate)
  const createGrid = useGridStore((s) => s.createGrid)
  const deleteGrid = useGridStore((s) => s.deleteGrid)

  // `data` is `undefined` until the hub (or the cache) answers. That absence is
  // carried all the way into the card as `null` — an unanswered list must never
  // render as "these cameras are gone".
  const { data: cameras } = useCameras()
  const camerasById = useMemo<ReadonlyMap<number, CameraInfo> | null>(
    () => (cameras === undefined ? null : new Map(cameras.map((c) => [c.id, c]))),
    [cameras],
  )

  const { width } = useViewportSize()
  const columns = gridCardColumns(useGridColumns())
  const cardWidth = gridCardWidth(width, columns)
  const thumbCount = gridPreviewThumbCount(cardWidth)

  const confirm = useConfirm()
  /** Grid whose share dialog is open, or null when closed. */
  const [shareTarget, setShareTarget] = useState<Grid | null>(null)
  /** WEB ONLY: id of the grid whose builder modal is open (native pushes a page). */
  const [builderGridId, setBuilderGridId] = useState<string | null>(null)

  const hydrateGridLocal = useGridLocalStore((s) => s.hydrate)
  useEffect(() => {
    void hydrate()
    void hydrateGridLocal()
  }, [hydrate, hydrateGridLocal])

  /** Open the builder for a grid: a modal overlay on web, a pushed page on native. */
  const openBuilder = (id: string): void => {
    if (Platform.OS === 'web') setBuilderGridId(id)
    else router.push(`/grid/${id}/edit`)
  }

  /** Create with the i18n'd default name and jump straight into the builder —
   *  the ONLY surface where the name (and everything else) is edited. */
  const handleCreate = (): void => {
    if (serverId === null) return
    const id = createGrid('', t('v2.grids.defaultName'), serverId)
    openBuilder(id)
  }

  /** The app's one confirmation (`useConfirm`), destructive. */
  const confirmDelete = async (grid: Grid): Promise<void> => {
    const ok = await confirm({
      title: t('v2.grids.deleteTitle'),
      message: t('v2.grids.deleteConfirm', { name: grid.name }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    })
    if (ok) deleteGrid(grid.id)
  }

  /** Open the share-builder dialog (token mint + frozen-view URL). */
  const shareGrid = (grid: Grid): void => {
    if (!serverUrl) return
    setShareTarget(grid)
  }

  // Pad the last row so multi-column cards keep an equal width.
  const cells = useMemo<readonly ListCell[]>(() => {
    const base: ListCell[] = grids.map((g) => ({ kind: 'grid', grid: g }))
    if (columns > 1) {
      const remainder = base.length % columns
      if (remainder > 0) {
        for (let i = 0; i < columns - remainder; i++) base.push({ kind: 'pad', id: `pad-${i}` })
      }
    }
    return base
  }, [grids, columns])

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader />
      {grids.length === 0 ? (
        <View style={styles.empty}>
          <LayoutGrid size={40} color={colors.foregroundSubtle} />
          <Text style={{ color: colors.foregroundMuted, fontSize: TYPOGRAPHY.size.lg }}>
            {t('v2.grids.empty')}
          </Text>
          <Text
            style={{ color: colors.foregroundSubtle, fontSize: TYPOGRAPHY.size.sm, textAlign: 'center' }}
          >
            {t('v2.grids.emptyHint')}
          </Text>
          <Pressable
            onPress={handleCreate}
            accessibilityRole="button"
            accessibilityLabel={t('v2.grids.createA11y')}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: SPACING.sm,
              marginTop: SPACING.md,
              paddingVertical: SPACING.md,
              paddingHorizontal: SPACING.xl,
              borderRadius: RADIUS.lg,
              backgroundColor: pressed ? colors.surfaceHover : colors.primary,
            })}
          >
            <Plus size={18} color={colors.primaryForeground} />
            <Text
              style={{
                color: colors.primaryForeground,
                fontSize: TYPOGRAPHY.size.lg,
                fontWeight: TYPOGRAPHY.weight.medium,
              }}
            >
              {t('v2.common.create')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          // numColumns is fixed for the life of a list instance — remount on change.
          key={`cols-${columns}`}
          data={cells}
          numColumns={columns}
          keyExtractor={(cell) => (cell.kind === 'grid' ? cell.grid.id : cell.id)}
          columnWrapperStyle={columns > 1 ? { gap: SPACING.md } : undefined}
          contentContainerStyle={{
            padding: SPACING.md,
            paddingBottom: navInset + 88,
            gap: SPACING.md,
          }}
          renderItem={({ item }) =>
            item.kind === 'pad' ? (
              <View style={{ flex: 1 }} />
            ) : (
              <GridCard
                grid={item.grid}
                camerasById={camerasById}
                thumbCount={thumbCount}
                cardWidth={cardWidth}
                onPress={() => router.push(`/grid/${item.grid.id}`)}
                onShare={() => shareGrid(item.grid)}
                onEdit={() => openBuilder(item.grid.id)}
                onDelete={() => { void confirmDelete(item.grid) }}
                canShare={serverUrl !== null}
              />
            )
          }
        />
      )}

      {/* Floating create action — the same corner idiom as the cameras list. */}
      <Pressable
        onPress={handleCreate}
        accessibilityRole="button"
        accessibilityLabel={t('v2.grids.createA11y')}
        style={({ pressed }) => [
          styles.fab,
          {
            bottom: navInset + SPACING.lg,
            backgroundColor: pressed ? colors.surfaceHover : colors.primary,
            shadowColor: '#000', // ui-check-ok: drop shadow, black in both themes
          },
        ]}
        hitSlop={8}
      >
        <Plus size={26} color={colors.primaryForeground} />
      </Pressable>


      <GridShareDialog grid={shareTarget} onClose={() => setShareTarget(null)} />

      {/* WEB: the grid builder opens as a modal overlay (reusing the same builder
          body as the native page) so the user stays on the list. */}
      {Platform.OS === 'web' && builderGridId ? (
        <SheetModal
          visible
          onClose={() => setBuilderGridId(null)}
          sheetStyle={[styles.builderCard, { backgroundColor: colors.background, borderColor: colors.border }]}
        >
          <GridBuilderScreen gridId={builderGridId} onClose={() => setBuilderGridId(null)} />
        </SheetModal>
      ) : null}
    </View>
  )
}

/** The dot beside a grid's name: what the wall is going to look like. Grey while
 *  the camera list has not answered — unknown is not a fault (D315). */
function healthColor(health: GridHealth, colors: ColorTokens): string {
  switch (health) {
    case 'ok':
      return colors.success
    case 'degraded':
      return colors.warning
    case 'empty':
      return colors.foregroundDisabled
    case 'unknown':
      return colors.foregroundSubtle
  }
}

/** A single grid card: snapshot preview strip, the member cameras by name, the
 *  wall settings that are not the default, and the faults. Tap opens the wall. */
function GridCard({
  grid,
  camerasById,
  thumbCount,
  cardWidth,
  onPress,
  onShare,
  onEdit,
  onDelete,
  canShare,
}: {
  readonly grid: Grid
  readonly camerasById: ReadonlyMap<number, CameraInfo> | null
  readonly thumbCount: number
  readonly cardWidth: number
  readonly onPress: () => void
  readonly onShare: () => void
  readonly onEdit: () => void
  readonly onDelete: () => void
  readonly canShare: boolean
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  const summary = useMemo<GridSummary>(() => summarizeGrid(grid, camerasById), [grid, camerasById])

  const count = summary.memberCount
  const countLabel =
    count === 0 ? t('v2.grids.countNone') : count === 1 ? t('v2.grids.countOne') : t('v2.grids.countOther', { count })

  // This device's layout, sound and tier for the wall (device settings).
  const gridLocal = useGridLocalStore((s) => s.local.byId[grid.id])
  const options = resolveGridOptions(grid.options, resolveGridLayout(gridLocal))
  const quality = resolveGridQuality(gridLocal)
  const layoutLabel =
    options.layout === 'auto' ? t('v2.grids.layoutAuto') : t('v2.grids.layoutColumns', { count: options.layout })
  const audioCount = gridLocal?.audioOnIds?.length ?? 0

  // The strip shows the members the wall will show, in wall order.
  const stripMembers = summary.members.filter((m) => !m.hidden)
  const shownThumbs = stripMembers.slice(0, thumbCount)
  // Counted over the RESOLVED members, not over `visibleCount`: an id the hub
  // no longer carries has no thumbnail to be "one more" of, and it already has
  // its own chip. Folding it in here would promise a tile that never paints.
  const overflow = stripMembers.length - shownThumbs.length
  // Per-thumb CSS width, so each snapshot is asked for at the size it is drawn.
  const thumbWidth = thumbCount > 0 ? (cardWidth - SPACING.md * 2) / thumbCount : 0

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${grid.name} · ${countLabel}`}
      style={({ pressed }) => [
        styles.card,
        {
          flex: 1,
          backgroundColor: pressed ? colors.surfaceHover : colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      {/* Camera preview strip */}
      <View style={styles.strip}>
        {shownThumbs.length === 0 ? (
          <View style={[styles.thumb, { borderColor: colors.border }]}>
            <LayoutGrid size={22} color={colors.foregroundSubtle} />
          </View>
        ) : (
          <>
            {shownThumbs.map((member) => (
              <GridCamThumb key={member.id} member={member} cssWidth={thumbWidth} />
            ))}
            {overflow > 0 ? (
              <View style={[styles.thumb, styles.overflowTile, { borderColor: colors.border }]}>
                <Text
                  style={{
                    color: colors.foreground,
                    fontSize: TYPOGRAPHY.size.lg,
                    fontWeight: TYPOGRAPHY.weight.bold,
                  }}
                >
                  +{overflow}
                </Text>
              </View>
            ) : null}
          </>
        )}
      </View>

      {/* Title + actions */}
      <View style={styles.cardHeaderRow}>
        <View style={[styles.healthDot, { backgroundColor: healthColor(summary.health, colors) }]} />
        <Text
          style={{
            flex: 1,
            color: colors.foreground,
            fontSize: TYPOGRAPHY.size.lg,
            fontWeight: TYPOGRAPHY.weight.medium,
          }}
          numberOfLines={1}
        >
          {grid.name}
        </Text>
        {canShare ? (
          <Pressable onPress={onShare} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('v2.grids.shareA11y')}>
            <Share2 size={18} color={colors.foregroundMuted} />
          </Pressable>
        ) : null}
        <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('v2.grids.editA11y')}>
          <Pencil size={18} color={colors.foregroundMuted} />
        </Pressable>
        <Pressable onPress={onDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('v2.grids.deleteA11y')}>
          <Trash2 size={18} color={colors.danger} />
        </Pressable>
      </View>

      {/* WHICH cameras. The names line is the single most useful thing the card
          can carry and it was the one thing it never said — two grids of four
          cameras used to be told apart only by opening them. While the camera
          list has not answered there are no names to print, and the line says
          that rather than rendering blank. */}
      <Text style={{ color: colors.foregroundMuted, fontSize: TYPOGRAPHY.size.sm }} numberOfLines={2}>
        {summary.health === 'unknown'
          ? t('v2.grids.camerasUnknown')
          : summary.visibleNames.length > 0
            ? summary.visibleNames.join(' · ')
            : t('v2.grids.countNone')}
      </Text>

      {/* Facts, then faults. Both are chips so they wrap on a narrow card. */}
      <View style={styles.metaRow}>
        <MetaChip icon={LayoutGrid} label={countLabel} tone={colors.foregroundMuted} />
        <MetaChip icon={Filter} label={layoutLabel} tone={colors.foregroundMuted} />
        {/* Only the NON-default settings earn a chip — a card that repeats every
            default states nothing. */}
        {quality !== 'auto' ? (
          <MetaChip icon={Gauge} label={t(qualityLabelKey(quality))} tone={colors.foregroundMuted} />
        ) : null}
        {options.activeOnly ? (
          <MetaChip icon={Filter} label={t('v2.gridBar.activeOnly')} tone={colors.foregroundMuted} />
        ) : null}
        {!options.highlightOn ? (
          <MetaChip icon={Zap} label={t('v2.grids.highlightOff')} tone={colors.foregroundMuted} />
        ) : null}
        {audioCount > 0 ? (
          <MetaChip icon={Volume2} label={String(audioCount)} tone={colors.foregroundMuted} />
        ) : null}
        {summary.locations.length > 0 ? (
          <MetaChip icon={MapPin} label={summary.locations.join(' · ')} tone={colors.foregroundMuted} />
        ) : null}

        {summary.hiddenCount > 0 ? (
          <MetaChip
            icon={EyeOff}
            label={t('v2.grids.hiddenCount', { count: summary.hiddenCount })}
            tone={colors.foregroundSubtle}
          />
        ) : null}
        {summary.offlineCount > 0 ? (
          <MetaChip
            icon={WifiOff}
            label={t('v2.grids.offlineCount', { count: summary.offlineCount })}
            tone={colors.warning}
          />
        ) : null}
        {/* A camera the operator switched off is REPORTED off, never as broken
            (D62) — its own chip, its own wording, a neutral tone. */}
        {summary.disabledCount > 0 ? (
          <MetaChip
            icon={Power}
            label={t('v2.grids.disabledCount', { count: summary.disabledCount })}
            tone={colors.foregroundSubtle}
          />
        ) : null}
        {summary.unknownIds.length > 0 ? (
          <MetaChip
            icon={HelpCircle}
            label={t('v2.grids.missingCount', { count: summary.unknownIds.length })}
            tone={colors.danger}
          />
        ) : null}
      </View>
    </Pressable>
  )
}

/** One meta chip on a card. Outlined in its own tone so a fault reads as one
 *  without a second shape to learn. */
function MetaChip({
  icon: Icon,
  label,
  tone,
}: {
  readonly icon: React.ComponentType<{ size: number; color: string }>
  readonly label: string
  readonly tone: string
}) {
  const { colors } = useTheme()
  return (
    <View style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <Icon size={12} color={tone} />
      <Text style={{ color: tone, fontSize: TYPOGRAPHY.size.xs }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

/** One camera snapshot cell in a card's preview strip. */
function GridCamThumb({ member, cssWidth }: { readonly member: GridMemberRef; readonly cssWidth: number }) {
  const { colors } = useTheme()
  // Tabs stay mounted under a pushed camera detail (`freezeOnBlur: false`).
  // An unconditional `true` here kept getSnapshotLinks capturing every thumb
  // every 5 s while the operator scrubbed — a standing capture order, not a
  // metadata read. Same gate as CameraCard: only ask while this tab is looked at.
  const screenActive = useScreenActive()
  const snapshotEnabled = shouldRequestSnapshot({
    screenActive,
    online: member.online,
    disabled: member.disabled,
    sleeping: false,
  })
  // Ask for the width the thumb is actually DRAWN at — the strip used to ask a
  // flat 160 px whatever the viewport, and before that it was served the full
  // 4 K capture, the worst bytes-to-pixels ratio anywhere in the app. The
  // server snaps the request to its own ladder, so nearby cards share one
  // derived image.
  const snapshot = useSnapshot(member.id, snapshotEnabled, snapshotWidthForCssPx(cssWidth))
  return (
    // ui-check-ok: video letterbox — a camera picture sits on black in both themes
    <View style={[styles.thumb, { borderColor: colors.border, backgroundColor: '#000' }]}>
      {snapshot.uri !== null ? (
        <SnapshotImage source={snapshot} deviceId={member.id} style={styles.thumbImg} />
      ) : (
        <View style={[styles.thumbImg, { backgroundColor: '#111' }]} /> // ui-check-ok: video letterbox placeholder
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING['2xl'],
    gap: SPACING.md,
  },
  fab: {
    position: 'absolute',
    right: SPACING.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  card: {
    borderWidth: 1,
    // RADIUS.lg — the same corner the shared `Section` card uses, so a grid card
    // and a settings card are visibly the same material.
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    gap: SPACING.md,
    overflow: 'hidden',
  },
  strip: {
    flexDirection: 'row',
    gap: SPACING.xs,
    height: PREVIEW_STRIP_HEIGHT,
  },
  thumb: {
    flex: 1,
    height: '100%',
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  overflowTile: {
    backgroundColor: '#0006', // ui-check-ok: scrim over a camera thumbnail
    flex: 0,
    width: 56,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
  },
  healthDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.md,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '100%',
  },
  builderCard: {
    width: '100%',
    maxWidth: 960,
    height: '88%',
    borderWidth: 1,
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
  },
})
