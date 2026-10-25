/**
 * OverlaySettingsSections — everything drawn ON this camera's picture, in one
 * place, for this camera.
 *
 * ## Not a panel any more
 *
 * This was `TimelineOverlayPanel`, a body-owning sub-panel reached from an
 * "Overlay" entry in the view-options menu. By 2026-08-02 that menu had ceded
 * every picture setting here, so the entry was the menu's ONLY real content —
 * one tap of pure indirection (operator: "le settings in menu sono tutte
 * dell'Overlay"). The sub-panel is dissolved: these sections now render inline
 * in `TimelineViewOptionsPanel`, which is why this exports a fragment of
 * sections and wears no `TimelinePanelHost`. The file keeps its historical
 * name because an out-of-directory guard
 * (`src/data/__tests__/use-discarded-detections.spec.ts`) pins the path.
 *
 * ## What moved here, and why
 *
 * The overlays were scattered across four owners with three lifetimes: bounding
 * boxes and stream stats were `useState` in the screen (forgotten on every
 * navigation), the audio meter's corner lived in the view-options menu, and the
 * motion badge, the highlight border and the occupancy chips were
 * unconditional — an operator could not turn them off at all. "What is on this
 * camera's picture" had no single answer and no per-camera answer.
 *
 * Now it has both: these sections edit `CameraOverlayConfig` (see
 * `overlay/overlay-config.ts`), persisted per camera with the rest of the
 * prefs, and `CameraDetailScreen` draws from the same document.
 *
 * ## The border section owns its TRIGGERS too
 *
 * The highlight-trigger editor (`HighlightTriggerRows`) used to live in the
 * view-options menu while the border's on/off switch lived here — two editors
 * for one drawn thing, and the split is exactly how "the border settings in the
 * sub-panel do nothing" got reported. Everything that decides whether and when
 * the border draws now sits under one section header. (The border's COLORS and
 * thickness stay global in Settings → appearance: they are shared with every
 * grid tile, not per-camera.)
 *
 * ## Not every section in every host
 *
 * These sections are per-CAMERA, and inside a GRID CELL most of them have no
 * per-camera meaning: a tile paints the grid's boxes and the grid's highlight
 * border, both edited in the control bar, and it paints nothing else on this
 * list at all. Rows are therefore drawn through `shows(row)`, whose answer comes
 * from `grid/view-options-scope` — the ONE list that says which rows the grid
 * owns. A section header disappears with its last row: a header over nothing is
 * how a menu ends up looking broken.
 *
 * ## Readouts
 *
 * The bottom section is the open-ended half. Any live value the device
 * publishes — the camera's own, or one of its linked devices' — can be pinned
 * to a corner. The catalogue (`useDeviceLiveFields`) merges the device-manager
 * live aggregate with the sensor caps' status slices; see that module for the
 * live-hub evidence of why both sources are needed.
 *
 * The live dBFS is offered as a fixed first entry because it is not a device
 * field — it arrives on the audio-inference event stream, per second, not
 * through a poll.
 */
import React, { useCallback, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  Frame,
  Activity,
  Eye,
  AudioLines,
  BatteryFull,
  Users,
  Plus,
  X,
} from '../../../lib/icons.js'
import { useSettingsStore } from '../../../store/settings-store.js'

import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { HighlightTriggerRows, PanelToggleRow } from '../HighlightTriggerRows.js'
import { OverlayPositionPicker } from '../overlay/OverlayPositionPicker.js'
import type { LucideIcon } from '../../../lib/icons.js'
import type { GridHighlightSettings } from '../../../store/grid-store.js'
import {
  GROUP_HEADER_KEY,
  isGroupVisible,
  isRowVisible,
  rowsInGroup,
  visibleLayers,
  type ViewOptionRow,
  type ViewOptionsContext,
} from '../../../grid/view-options-scope.js'
import { OverlayLayersRow } from '../overlay/OverlayLayersRow.js'
import { useLinkedDevices } from '../../../data/use-linked-devices.js'
import { ReadoutPickerSheet } from '../overlay/ReadoutPickerSheet.js'
import {
  addReadout,
  patchOverlay,
  patchReadout,
  readoutId,
  removeReadout,
  toggleLayer,
  type CameraOverlayConfig,
  type OverlayReadoutSource,
} from '../overlay/overlay-config.js'
import { type OverlayAnchor, type OverlayPosition } from '../overlay/overlay-position.js'

export interface OverlaySettingsSectionsProps {
  readonly deviceId: number
  /** WHERE these sections are mounted. In a grid cell the rows the grid owns
   *  grid-wide (and the ones no tile paints) are not drawn — see
   *  `grid/view-options-scope`, the one list that decides this. */
  readonly context: ViewOptionsContext
  readonly config: CameraOverlayConfig
  readonly onChange: (next: CameraOverlayConfig) => void
  /** The border's trigger settings (shared `GridHighlightSettings` document —
   *  the cluster-label member of that document is timeline chrome and is
   *  rendered by the hosting menu below these sections, not here). */
  readonly highlight: GridHighlightSettings
  readonly onSetHighlight: (patch: Partial<GridHighlightSettings>) => void
}

/** Everything drawn ON the picture — the two groups above the readouts. Derived
 *  from the shared groups, so a row added to either one joins the live-only
 *  preamble without a second edit here. */
const PICTURE_ROWS: readonly ViewOptionRow[] = [
  ...rowsInGroup('detection'),
  ...rowsInGroup('liveIndicators'),
]

export function OverlaySettingsSections({
  deviceId,
  context,
  config,
  onChange,
  highlight,
  onSetHighlight,
}: OverlaySettingsSectionsProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const deviceInfo = useSettingsStore((s) => s.settings.deviceInfo)
  const setDeviceInfo = useSettingsStore((s) => s.setDeviceInfo)
  const [pickerOpen, setPickerOpen] = useState(false)
  // One question per row, answered by the shared list — never by a local
  // `context === 'grid-cell'` test, which is how two menus diverge.
  const shows = useCallback(
    (row: ViewOptionRow): boolean => isRowVisible(row, context),
    [context],
  )
  // Section by section: a header (and the live-only preamble above them all) is
  // drawn only while the section still HAS a row. A header over nothing is how
  // a menu looks broken, and in a grid cell the grid owns every picture row.
  const anyPictureRow = PICTURE_ROWS.some(shows)

  const { data: linked } = useLinkedDevices(deviceId)

  const patch = useCallback(
    (p: Partial<CameraOverlayConfig>) => onChange(patchOverlay(config, p)),
    [config, onChange],
  )

  const pin = useCallback(
    (source: OverlayReadoutSource, label: string, unit?: string, precision?: number) => {
      const readout: {
        id: string
        source: OverlayReadoutSource
        label: string
        unit?: string
        precision?: number
        corner: OverlayAnchor
      } = { id: readoutId(source), source, label, corner: 'top-right' }
      if (unit !== undefined) readout.unit = unit
      if (precision !== undefined) readout.precision = precision
      onChange(addReadout(config, readout))
      setPickerOpen(false)
    },
    [config, onChange],
  )

  return (
    <>
      {/* Everything in the first three sections draws on the LIVE picture only.
          Without saying so, a toggle flipped during playback or while paused
          looks broken — which is how it was reported. */}
      {anyPictureRow ? (
        <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>
          {t('v2.overlay.liveOnlyHint')}
        </Text>
      ) : null}

      {/* ── GROUP: detection overlays — everything the analysis pipeline puts
          on the picture. Boxes ("what is it?", `detection.result`), motion
          regions ("where did the picture change?",
          `detection.motion-analysis`), the motion pill and the highlight
          border. In a grid the boxes and the border are the WALL's (see the
          hint above); the motion rows stay per camera and the tile draws them. */}
      {isGroupVisible('detection', context) ? (
        <Text style={[styles.section, { color: colors.foregroundMuted }]}>
          {t(GROUP_HEADER_KEY.detection)}
        </Text>
      ) : null}
      {/* ONE control for the whole box overlay: four INDEPENDENT layers, drawn
          as chips. It replaced an ordered off/kept/all selector plus a separate
          motion toggle — a scale that forced `discarded ⊃ objects` and had no
          state at all for the parked objects, which therefore rode the object
          switch (default OFF, so a fresh install never drew a parked car).
          Which chips appear is the shared list's answer, never a local
          `context === 'grid-cell'` test: on the wall the detector layers are
          the grid's and only motion stays per camera. */}
      <OverlayLayersRow
        layers={visibleLayers(context)}
        selected={config.layers}
        onToggle={(layer) => onChange(toggleLayer(config, layer))}
      />

      {/* The highlight border: the switch AND its triggers, never apart. */}
      {shows('highlightBorder') ? (
        <>
          <PanelToggleRow
            icon={Frame}
            label={t('v2.overlay.highlightBorder')}
            value={config.highlightBorder}
            onValueChange={() => patch({ highlightBorder: !config.highlightBorder })}
          />
          {config.highlightBorder ? (
            <HighlightTriggerRows highlight={highlight} onSetHighlight={onSetHighlight} />
          ) : null}
        </>
      ) : null}

      {/* ── GROUP: live indicators — read-outs of the stream itself rather than
          of the analysis. Per camera in EVERY context: the tile draws them for
          the cameras the operator placed them on (that is what makes them
          offerable here at all). */}
      {isGroupVisible('liveIndicators', context) ? (
        <>
          <Text style={[styles.section, { color: colors.foregroundMuted }]}>
            {t(GROUP_HEADER_KEY.liveIndicators)}
          </Text>
          {/* ONE row shape for every placeable overlay — label left, drop-down
              right, exactly like the app's other selectors. */}
          {shows('audioMeter') ? (
            <PanelPositionRow
              icon={AudioLines}
              label={t('v2.cameraMenu.audioLevel')}
              value={config.audioMeter}
              onChange={(audioMeter) => patch({ audioMeter })}
            />
          ) : null}
          {shows('occupancy') ? (
            <PanelPositionRow
              icon={Users}
              label={t('v2.overlay.occupancy')}
              value={config.occupancy}
              onChange={(occupancy) => patch({ occupancy })}
            />
          ) : null}
          {shows('stats') ? (
            <PanelPositionRow
              icon={Activity}
              label={t('v2.cameraMenu.streamStats')}
              value={config.stats}
              onChange={(stats) => patch({ stats })}
            />
          ) : null}
          {shows('liveViewers') ? (
            <PanelPositionRow
              icon={Eye}
              label={t('v2.overlay.liveViewers')}
              value={config.viewers}
              onChange={(viewers) => patch({ viewers })}
            />
          ) : null}
          {shows('deviceInfo') ? (
            <PanelPositionRow
              icon={BatteryFull}
              label={t('v2.overlay.deviceInfo')}
              value={deviceInfo}
              onChange={setDeviceInfo}
            />
          ) : null}
        </>
      ) : null}

      {/* ── GROUP: sensors & values — the open-ended per-camera set. */}
      <Text style={[styles.section, { color: colors.foregroundMuted }]}>
        {t(GROUP_HEADER_KEY.sensors)}
      </Text>
      {config.readouts.length === 0 ? (
        <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>
          {t('v2.overlay.readoutsHint')}
        </Text>
      ) : null}
      {config.readouts.map((r) => (
        <View key={r.id} style={styles.readoutRow}>
          <Text style={[styles.readoutLabel, { color: colors.foreground }]} numberOfLines={1}>
            {r.label}
          </Text>
          <OverlayPositionPicker
            value={r.corner}
            onChange={(position) => {
              if (position === 'off') return
              onChange(patchReadout(config, r.id, { corner: position }))
            }}
            cellSize={22}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('v2.overlay.removeReadout')}
            onPress={() => onChange(removeReadout(config, r.id))}
            style={styles.removeBtn}
          >
            <X size={16} color={colors.foregroundMuted} />
          </Pressable>
        </View>
      ))}

      <Pressable
        accessibilityRole="button"
        onPress={() => setPickerOpen(true)}
        style={styles.addRow}
      >
        <Plus size={18} color={colors.primary} />
        <Text style={[styles.addLabel, { color: colors.primary }]}>
          {t('v2.overlay.addReadout')}
        </Text>
      </Pressable>
      <ReadoutPickerSheet
        visible={pickerOpen}
        cameraDeviceId={deviceId}
        linkedDevices={linked?.devices ?? []}
        onPin={pin}
        onClose={() => setPickerOpen(false)}
      />
    </>
  )
}

/**
 * One placement row: icon, label, and the position drop-down.
 *
 * Every placeable overlay uses it — the audio meter, the occupancy strip and
 * (since 2026-08-02) the motion badge — so a fourth cannot invent a fourth
 * layout, which is how the panel ended up with two position vocabularies
 * before.
 */
interface PanelPositionRowProps {
  readonly icon: LucideIcon
  readonly label: string
  readonly value: OverlayPosition
  readonly onChange: (position: OverlayPosition) => void
}

function PanelPositionRow({
  icon: Icon,
  label,
  value,
  onChange,
}: PanelPositionRowProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View style={styles.placementRow}>
      <Icon size={18} color={colors.foregroundMuted} />
      <Text style={[styles.placementLabel, { color: colors.foreground }]}>{label}</Text>
      <OverlayPositionPicker value={value} onChange={onChange} allowOff />
    </View>
  )
}

const styles = StyleSheet.create({
  section: { fontSize: 12, fontWeight: '600', paddingTop: SPACING.sm, paddingBottom: SPACING.xs },
  hint: { fontSize: 11, paddingVertical: SPACING.xs },
  placementRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.md, paddingVertical: SPACING.xs },
  // Content-sized (flexShrink, not flex:1): the position picker stretches into
  // the leftover width and MEASURES it to choose grid vs drop-down.
  placementLabel: { flexShrink: 1, fontSize: 14, fontWeight: '500', paddingTop: 6 },
  readoutRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 2 },
  readoutLabel: { flexShrink: 1, fontSize: 13, fontWeight: '500' },
  removeBtn: { padding: 4 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm },
  addLabel: { fontSize: 14, fontWeight: '600' },
})
