/**
 * GridMenuPanel — the grid runtime "highlight & overlays" menu, rendered inside
 * the `GridControlBar`'s bottom-anchored popover (the same container the
 * audio/quality pickers use — NOT the top-anchored `FloatingPanel`).
 *
 * ## The wall's overlays live HERE, and only here
 *
 * Every row below is grid-wide and PER-GRID persisted. The per-camera menu a
 * cell opens used to offer the same four things against the CAMERA's document —
 * one picture, two controls, two documents, and whichever the operator touched
 * last was the one that looked broken. The cell menu now hides them.
 *
 * Which rows those are is not decided here either: `GRID_BAR_ROWS`
 * (`grid/view-options-scope`) is the one list, and the row map below is keyed by
 * it — promote a row to the bar and this file stops compiling until it draws it.
 *
 * Contents:
 *   • Master highlight toggle — the on/off previously bound to the bare `Zap`
 *     bar button. PER-GRID and persisted (`options.highlightOn`), defaulting
 *     ON: a grid opens with its borders lit unless the operator said no — plus
 *     the PERSISTED per-grid triggers, edited via the shared
 *     `HighlightTriggerRows` (writes flow through the store's
 *     `setGridHighlight` — the same object the builder used to edit).
 *   • The box overlay's DETECTOR layers — per-grid, drawn on every tile as a
 *     checkable set (objects / discarded / stationary). The motion layer of the
 *     same control is NOT here: the tile paints it from each camera's own
 *     document, so it stays in the cell menu (`grid/view-options-scope`).
 *   • Cluster-label mode for the grid timeline's cards.
 *
 * Purely presentational: state + persistence are owned by the screen and
 * driven through callbacks.
 */
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { BatteryFull, Zap } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { ClusterLabelRow, HighlightTriggerRows, PanelToggleRow } from '../camera/HighlightTriggerRows.js'
import { OverlayPositionPicker } from '../camera/overlay/OverlayPositionPicker.js'
import type { GridHighlightSettings } from '../../store/grid-store.js'
import type { OverlayLayer } from '../camera/overlay/overlay-config.js'
import { OverlayLayersRow } from '../camera/overlay/OverlayLayersRow.js'
import { useSettingsStore } from '../../store/settings-store.js'
import {
  BAR_LAYERS,
  GRID_BAR_GROUPS,
  GROUP_HEADER_KEY,
  barRowsInGroup,
  type GridBarRow,
} from '../../grid/view-options-scope.js'

export interface GridMenuPanelProps {
  /** Master highlight toggle — per-grid, persisted, defaults ON. */
  readonly highlightOn: boolean
  readonly onToggleHighlight: () => void
  /** The box overlay's layers — per-grid, persisted. The SAME vocabulary the
   *  camera-detail overlay uses, so the wall and the single view can show the
   *  same picture. Only the layers `BAR_LAYERS` names are edited here. */
  readonly layers: readonly OverlayLayer[]
  readonly onToggleLayer: (layer: OverlayLayer) => void
  /** PERSISTED per-grid highlight triggers + patcher (store-backed). */
  readonly highlight: GridHighlightSettings
  readonly onSetHighlight: (patch: Partial<GridHighlightSettings>) => void
}

export function GridMenuPanel({
  highlightOn,
  onToggleHighlight,
  layers,
  onToggleLayer,
  highlight,
  onSetHighlight,
}: GridMenuPanelProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const deviceInfo = useSettingsStore((s) => s.settings.deviceInfo)
  const setDeviceInfo = useSettingsStore((s) => s.setDeviceInfo)

  // TOTAL over the bar's rows: a row that moves to the bar has no entry here
  // until someone draws it, which is the compile error that replaces the
  // "we forgot to move the control" bug.
  const rows: Readonly<Record<GridBarRow, React.JSX.Element>> = {
    // Same chips, same labels as the camera-detail overlay panel — a second
    // vocabulary here would be a second answer to the same question.
    detectionLayers: (
      <OverlayLayersRow layers={BAR_LAYERS} selected={layers} onToggle={onToggleLayer} />
    ),
    highlightBorder: (
      <>
        <PanelToggleRow
          icon={Zap}
          label={t('v2.gridMenu.highlightMaster')}
          value={highlightOn}
          onValueChange={onToggleHighlight}
        />
        {/* The triggers belong to the switch above them — never a group of
            their own, or the border and the reasons it lights drift apart
            again (they did once, and the trigger rows "did nothing"). */}
        {highlightOn ? (
          <HighlightTriggerRows highlight={highlight} onSetHighlight={onSetHighlight} />
        ) : null}
      </>
    ),
    deviceInfo: (
      <View style={styles.placementRow}>
        <BatteryFull size={18} color={colors.foregroundMuted} />
        <Text style={[styles.placementLabel, { color: colors.foreground }]}>
          {t('v2.overlay.deviceInfo')}
        </Text>
        <OverlayPositionPicker value={deviceInfo} onChange={setDeviceInfo} allowOff />
      </View>
    ),
    clusterLabel: (
      <ClusterLabelRow
        value={highlight.clusterLabel}
        onChange={(mode) => onSetHighlight({ clusterLabel: mode })}
      />
    ),
  }

  return (
    <View style={styles.body}>
      {/* The SAME group headers the per-camera menu wears, in the same order:
          a row that is wall-wide here did not stop being a detection overlay,
          and an operator who learned where it lives must still find it. */}
      {GRID_BAR_GROUPS.map((group) => {
        const header = GROUP_HEADER_KEY[group]
        return (
          <React.Fragment key={group}>
            {header === null ? null : (
              <Text style={[styles.sectionLabel, { color: colors.foregroundMuted }]}>
                {t(header)}
              </Text>
            )}
            {barRowsInGroup(group).map((row) => (
              <React.Fragment key={row}>{rows[row]}</React.Fragment>
            ))}
          </React.Fragment>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xs,
  },
  placementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  placementLabel: { flexShrink: 1, fontSize: 14, fontWeight: '500', paddingTop: 6 },
})
