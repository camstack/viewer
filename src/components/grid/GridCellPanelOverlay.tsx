/**
 * GridCellPanelOverlay — the ONE panel the wall mounts for ONE cell.
 *
 * The grid used to mount exactly one thing over itself: `PtzControls`, in a
 * hand-rolled card, opened by a tile's in-tile PTZ button. Two more cell
 * actions arrived on 2026-08-13 — the camera's LINKED DEVICES and its
 * view-options MENU — and both are surfaces the single-camera view already
 * owns. Neither is re-implemented here: this file is a HOST.
 *
 *   • `PtzControls`            — the camera-detail PTZ pad, unchanged.
 *   • `CameraAccessoryPanel`   — the linked companion devices with the
 *                                registry-picked accessory controls (siren,
 *                                floodlight, switches …), the local edit mode
 *                                and the function switches — the ONE
 *                                composition every host mounts, unchanged.
 *   • `CameraViewOptionsSurface` — the per-camera configuration menu, driven by
 *                                `useCameraViewOptions`, the same binding the
 *                                camera screen's menu is driven by. A change
 *                                made from a tile is the change the camera
 *                                screen shows.
 *   • the compact ACTIONS list — the rows a cell too small for two buttons
 *                                offers instead (`cell-controls`).
 *
 * ## Mounted on demand, one instance
 *
 * A wall is N cells. Everything here is behind `panel !== null`: with no panel
 * open the whole subtree — the linked-device query, the live-field catalogue
 * the overlay sections read, the switch group's cap reads — does not exist. A
 * menu mounted per tile would run each of those N times to draw chrome the
 * operator is not looking at. The panel is keyed by device id, so switching
 * cameras remounts the body cleanly instead of feeding stale data into it.
 *
 * The frame is `TimelinePanelHost` — the same title/close/scroll frame the
 * theater's panels wear, so the two hosts of the shared surface do not drift
 * apart in chrome either.
 */
import React from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Move, Lightbulb, SlidersHorizontal, ChevronRight, type LucideIcon } from '../../lib/icons.js'
import { hapticTap } from '../../lib/haptics.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import { TimelinePanelHost } from '../camera/theater/TimelinePanelHost.js'
import { STREAM_SLOT_Z } from '../camera/theater/stream-slot.js'
import { PtzControls } from '../camera/PtzControls.js'
import { CameraAccessoryPanel } from '../camera/accessory-panel/CameraAccessoryPanel.js'
import { CameraViewOptionsSurface } from '../camera/CameraViewOptionsSurface.js'
import { useCameraViewOptions } from '../../hooks/use-camera-view-options.js'
import { cellActionRows, type GridCellPanel, type GridCellPanelKind } from '../../grid/cell-controls.js'

export interface GridCellPanelOverlayProps {
  /** The open panel, or null — nothing below is mounted while it is null. */
  readonly panel: GridCellPanel | null
  /** Display name of the panel's camera (the card's title). */
  readonly cameraName: string
  /** Whether that camera has PTZ (gates the compact list's first row). */
  readonly hasPtz: boolean
  /** A row of the compact list was chosen — the host swaps the open panel. */
  readonly onSelect: (kind: GridCellPanelKind) => void
  readonly onClose: () => void
}

export function GridCellPanelOverlay({
  panel,
  cameraName,
  hasPtz,
  onSelect,
  onClose,
}: GridCellPanelOverlayProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()

  if (panel === null) return null

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} pointerEvents="box-none">
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('v2.cameraDetail.close')}
      />
      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <TimelinePanelHost title={cameraName} onClose={onClose}>
            <PanelBody
              key={`${panel.kind}:${panel.deviceId}`}
              panel={panel}
              cameraName={cameraName}
              hasPtz={hasPtz}
              onSelect={onSelect}
            />
          </TimelinePanelHost>
        </View>
      </View>
    </View>
  )
}

interface PanelBodyProps {
  readonly panel: GridCellPanel
  readonly cameraName: string
  readonly hasPtz: boolean
  readonly onSelect: (kind: GridCellPanelKind) => void
}

/** Route the open panel to the component that already implements it. */
function PanelBody({ panel, cameraName, hasPtz, onSelect }: PanelBodyProps): React.JSX.Element {
  switch (panel.kind) {
    case 'ptz':
      // Centred in the card: the pad is short and the frame is the same tall
      // card every other cell panel uses.
      return (
        <View style={styles.centredBody}>
          <PtzControls deviceId={panel.deviceId} hasFeature />
        </View>
      )
    case 'devices':
      // This host IS the single-camera screen's linked-devices panel (the
      // shelf route), and on the wall it is one cell — one camera either way,
      // so the panel's "+" (a LOCAL addition) is never ambiguous.
      return <CameraAccessoryPanel deviceId={panel.deviceId} cameraName={cameraName} />
    case 'viewOptions':
      return <CellViewOptions deviceId={panel.deviceId} />
    case 'actions':
      return <CellActionsList deviceId={panel.deviceId} hasPtz={hasPtz} onSelect={onSelect} />
  }
}

/**
 * The shared configuration surface, bound to the SAME per-camera document the
 * camera screen's menu edits. Two things are dropped here, both because the host
 * cannot honour them: the management entries (no sibling panel to hand the body
 * to) and — through `context="grid-cell"` — every overlay row the WALL owns
 * grid-wide or never paints. The bar's menu is where those live now; see
 * `grid/view-options-scope`.
 */
function CellViewOptions({ deviceId }: { readonly deviceId: number }): React.JSX.Element {
  const viewOptions = useCameraViewOptions(deviceId)
  return (
    <CameraViewOptionsSurface
      deviceId={deviceId}
      context="grid-cell"
      overlayConfig={viewOptions.overlay}
      onChangeOverlay={viewOptions.setOverlay}
      highlight={viewOptions.highlight}
      onSetHighlight={viewOptions.setHighlight}
    />
  )
}

const ROW_ICONS: Readonly<Record<GridCellPanelKind, LucideIcon>> = {
  ptz: Move,
  devices: Lightbulb,
  viewOptions: SlidersHorizontal,
  // Never drawn as a row (the list does not offer itself) — present so the
  // record is total and a new panel kind cannot be forgotten here.
  actions: SlidersHorizontal,
}

const ROW_LABELS: Readonly<Record<GridCellPanelKind, string>> = {
  ptz: 'v2.cameraDetail.ptz',
  devices: 'v2.cameraDetail.devices',
  viewOptions: 'v2.cameraMenu.title',
  actions: 'v2.gridView.cellActions',
}

interface CellActionsListProps {
  readonly deviceId: number
  readonly hasPtz: boolean
  readonly onSelect: (kind: GridCellPanelKind) => void
}

/** The compact cell's list: the same panels, reached in one more tap, on a cell
 *  too small to carry their buttons. */
function CellActionsList({ hasPtz, onSelect }: CellActionsListProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <>
      {cellActionRows({ hasPtz }).map((kind) => {
        const Icon = ROW_ICONS[kind]
        return (
          <Pressable
            key={kind}
            accessibilityRole="button"
            onPress={() => { hapticTap(); onSelect(kind) }}
            style={({ pressed }) => [
              styles.actionRow,
              { borderColor: colors.borderSubtle, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Icon size={18} color={colors.foregroundMuted} />
            <Text style={[styles.actionLabel, { color: colors.foreground }]}>{t(ROW_LABELS[kind])}</Text>
            <ChevronRight size={18} color={colors.foregroundSubtle} />
          </Pressable>
        )
      })}
    </>
  )
}

/**
 * MUST out-rank the STREAM SLOT (`STREAM_SLOT_Z`, `stream-slot.ts`).
 *
 * On the WALL this overlay had no stacking competition and worked without a
 * zIndex for months. On the SINGLE-CAMERA player the picture is an opaque box
 * carrying z 50, so a sibling without one paints UNDER it: the panel mounted,
 * received the press, and was invisible — "the button does nothing".
 *
 * This is the second time this exact defect has been paid for here;
 * `LandscapeTimelineOverlay` carries the same constant and the same comment
 * for the same reason. The relation is asserted by test, not left to two
 * literals in two files.
 */
export const CELL_PANEL_OVERLAY_Z = STREAM_SLOT_Z + 10

const styles = StyleSheet.create({
  root: {
    zIndex: CELL_PANEL_OVERLAY_Z,
    elevation: CELL_PANEL_OVERLAY_Z,
  },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    // A DEFINITE height: `TimelinePanelHost` is `flex: 1` and would collapse to
    // nothing in an auto-height card (flexBasis 0 with no space to grow into).
    height: '82%',
    maxHeight: 640,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  centredBody: { flex: 1, justifyContent: 'center' },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
})
