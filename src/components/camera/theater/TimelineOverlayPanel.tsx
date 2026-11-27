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
 * Now it has both: these sections edit `OverlayConfig` (see
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
  Activity,
  Eye,
  BellRing,
  AudioLines,
  BatteryFull,
  Users,
  Plus,
  X,
  EyeOff,
  Tag,
  Gamepad2,
  Pentagon,
} from '../../../lib/icons.js'
import { useSettingsStore } from '../../../store/settings-store.js'
import { StepperRow } from '../../ui/StepperRow.js'
import { CheckboxRow } from '../../ui/CheckboxRow.js'
import { OVERLAY_STEP_MAX, OVERLAY_STEP_MIN } from '../overlay/overlay-size.js'

import { useTheme } from '../../../theme/theme-provider.js'
import { CONTROL, ICON, SPACING, TYPOGRAPHY, controlHitSlop } from '../../../theme/tokens.js'
import { HighlightTriggerRows } from '../HighlightTriggerRows.js'
import { ActivationRow } from '../ActivationRow.js'
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
  defaultAnchorFor,
  patchOverlay,
  patchReadout,
  placeOverlay,
  setFade,
  setSizeStep,
  type FadeableOverlay,
  type SizedOverlay,
  type OverlayItemId,
  readoutId,
  removeReadout,
  toggleLayer,
  type OverlayConfig,
  type OverlayReadoutSource,
} from '../overlay/overlay-config.js'
import { type OverlayAnchor, type OverlayPosition } from '../overlay/overlay-position.js'

export interface OverlaySettingsSectionsProps {
  readonly deviceId: number
  /** WHERE these sections are mounted. In a grid cell the rows the grid owns
   *  grid-wide (and the ones no tile paints) are not drawn — see
   *  `grid/view-options-scope`, the one list that decides this. */
  readonly context: ViewOptionsContext
  readonly config: OverlayConfig
  readonly onChange: (next: OverlayConfig) => void
  /** The border's trigger settings (shared `GridHighlightSettings` document —
   *  the cluster-label member of that document is timeline chrome and is
   *  rendered by the hosting menu below these sections, not here). */
  readonly highlight: GridHighlightSettings
  readonly onSetHighlight: (patch: Partial<GridHighlightSettings>) => void
  /** The camera has the doorbell feature AND this host paints the badge (the
   *  single-camera player). Absent ⟺ the doorbell switch is not offered. */
  readonly hasDoorbell?: boolean
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
  hasDoorbell = false,
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
    (p: Partial<OverlayConfig>) => onChange(patchOverlay(config, p)),
    [config, onChange],
  )

  const place = useCallback(
    (id: OverlayItemId, next: OverlayPosition) => onChange(placeOverlay(config, id, next)),
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
        scope?: number
      } = { id: readoutId(source), source, label, corner: 'top-right' }
      // A field of another device is pinned ON this camera: it shows here only.
      if (source.kind === 'deviceField') readout.scope = deviceId
      if (unit !== undefined) readout.unit = unit
      if (precision !== undefined) readout.precision = precision
      onChange(addReadout(config, readout))
      setPickerOpen(false)
    },
    [config, deviceId, onChange],
  )

  const rowCommon = { config, onChange, context } as const

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
          `context === 'grid-cell'` test: on the wall every layer is the grid's,
          so a grid cell offers none. */}
      {visibleLayers(context).length > 0 ? (
        <OverlayLayersRow
          layers={visibleLayers(context)}
          selected={config.layers}
          onToggle={(layer) => onChange(toggleLayer(config, layer))}
        />
      ) : null}

      {/* The configured zones (outline + name) — only the single view draws them. */}
      {context === 'single' ? (
        <ActivationRow
          icon={Pentagon}
          label={t('v2.overlay.zones')}
          on={config.zones}
          onToggle={() => patch({ zones: !config.zones })}
        />
      ) : null}

      {/* The highlight border has NO switch of its own: it is on when any of
          its triggers is (`highlight-border.ts`). */}
      {shows('highlightBorder') ? (
        <>
          <Text style={[styles.section, { color: colors.foregroundMuted }]}>
            {t('v2.overlay.highlightBorder')}
          </Text>
          <HighlightTriggerRows highlight={highlight} onSetHighlight={onSetHighlight} />
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
          {/* ONE row shape for every placeable overlay: the activation row and,
              while it is on, its own position, size and fade. */}
          {shows('audioMeter') ? (
            <OverlayItemRow
              {...rowCommon}
              icon={AudioLines}
              label={t('v2.cameraMenu.audioLevel')}
              item="audioMeter"
              position={config.audioMeter}
              onPlace={(next) => place('audioMeter', next)}
              sized="audioMeter"
              fadeable="audioMeter"
            />
          ) : null}
          {shows('occupancy') ? (
            <OverlayItemRow
              {...rowCommon}
              icon={Users}
              label={t('v2.overlay.occupancy')}
              item="occupancy"
              position={config.occupancy}
              onPlace={(next) => place('occupancy', next)}
              sized="occupancy"
              fadeable="occupancy"
            />
          ) : null}
          {shows('stats') ? (
            <OverlayItemRow
              {...rowCommon}
              icon={Activity}
              label={t('v2.cameraMenu.streamStats')}
              item="stats"
              position={config.stats}
              onPlace={(next) => place('stats', next)}
              sized="stats"
              fadeable="stats"
            />
          ) : null}
          {shows('liveViewers') ? (
            <OverlayItemRow
              {...rowCommon}
              icon={Eye}
              label={t('v2.overlay.liveViewers')}
              item="viewers"
              position={config.viewers}
              onPlace={(next) => place('viewers', next)}
              sized="viewers"
              fadeable="viewers"
            />
          ) : null}
          {hasDoorbell ? (
            <OverlayItemRow
              {...rowCommon}
              icon={BellRing}
              label={t('v2.overlay.doorbell')}
              item="doorbell"
              position={config.doorbell ? config.doorbellAnchor : 'off'}
              onPlace={(next) => {
                if (next === 'off') patch({ doorbell: false })
                else onChange({ ...placeOverlay(config, 'doorbell', next), doorbell: true })
              }}
              sized="doorbell"
              fadeable="doorbell"
            />
          ) : null}
          {shows('deviceInfo') ? (
            <OverlayItemRow
              {...rowCommon}
              icon={BatteryFull}
              label={t('v2.overlay.deviceInfo')}
              item="deviceInfo"
              position={deviceInfo}
              onPlace={setDeviceInfo}
              sized="deviceInfo"
            />
          ) : null}
        </>
      ) : null}

      {/* ── GROUP: layout — where the name and the two control groups sit.
          ONE document for every stream. A tile has no auto-hiding controls and
          draws its own name, so there is nothing to lay out there. */}
      {context === 'single' ? (
        <>
          <Text style={[styles.section, { color: colors.foregroundMuted }]}>
            {t('v2.overlay.layoutSection')}
          </Text>
          <OverlayItemRow
            {...rowCommon}
            icon={Tag}
            label={t('v2.overlay.cameraName')}
            item="cameraName"
            position={config.cameraName}
            onPlace={(next) => place('cameraName', next)}
            sized="cameraName"
            fadeable="cameraName"
          />
          <OverlayItemRow
            {...rowCommon}
            icon={Activity}
            label={t('v2.overlay.motionBadge')}
            item="motionBadge"
            position={config.motionBadge}
            onPlace={(next) => place('motionBadge', next)}
            sized="motionBadge"
            fadeable="motionBadge"
          />
          <OverlayItemRow
            {...rowCommon}
            icon={Gamepad2}
            label={t('v2.overlay.controlsLeft')}
            item="controlsLeft"
            position={config.controlsLeft}
            onPlace={(next) => place('controlsLeft', next)}
            alwaysOn
          />
          <OverlayItemRow
            {...rowCommon}
            icon={Gamepad2}
            label={t('v2.overlay.controlsRight')}
            item="controlsRight"
            position={config.controlsRight}
            onPlace={(next) => place('controlsRight', next)}
            alwaysOn
          />
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
        <React.Fragment key={r.id}>
          <View style={styles.readoutRow}>
            <Text style={[styles.readoutLabel, { color: colors.foreground }]} numberOfLines={1}>
              {r.label}
            </Text>
            <OverlayPositionPicker
              value={r.corner}
              onChange={(position) => {
                if (position === 'off') return
                onChange(patchReadout(config, r.id, { corner: position }))
              }}
            />
            {context === 'single' ? (
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: r.fade === true }}
                accessibilityLabel={t('v2.overlay.fadeReadout')}
                onPress={() => onChange(patchReadout(config, r.id, { fade: r.fade !== true }))}
                hitSlop={controlHitSlop(CONTROL.md)}
              style={styles.removeBtn}
              >
                {r.fade === true ? (
                  <EyeOff size={ICON.md} color={colors.primary} />
                ) : (
                  <Eye size={ICON.md} color={colors.foregroundMuted} />
                )}
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('v2.overlay.removeReadout')}
              onPress={() => onChange(removeReadout(config, r.id))}
              hitSlop={controlHitSlop(CONTROL.md)}
              style={styles.removeBtn}
            >
              <X size={ICON.md} color={colors.foregroundMuted} />
            </Pressable>
          </View>
          <CheckboxRow
            label={t('v2.overlay.showReadoutLabel')}
            value={r.showLabel !== false}
            onValueChange={(v) => onChange(patchReadout(config, r.id, { showLabel: v }))}
          />
        </React.Fragment>
      ))}

      <Pressable
        accessibilityRole="button"
        onPress={() => setPickerOpen(true)}
        style={styles.addRow}
      >
        <Plus size={ICON.md} color={colors.primary} />
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
 * One overlay, as the shared activation row: switch it on and ITS settings
 * appear — position, size, and (single view) whether it hides with the controls.
 *
 * "On" is "has a position": `off` is the switch, so there is no second field
 * to disagree with it. Switching on places the overlay at its default anchor;
 * switching off moves it to `off` and leaves the stacking order alone.
 */
interface OverlayItemRowProps {
  readonly icon: LucideIcon
  readonly label: string
  readonly item: OverlayItemId
  readonly position: OverlayPosition
  readonly onPlace: (position: OverlayPosition) => void
  /** Has a size step (everything drawn as a pill / read-out). */
  readonly sized?: SizedOverlay
  /** Has its own hide-with-the-controls flag. */
  readonly fadeable?: FadeableOverlay
  /** Cannot be switched off (the two control groups). */
  readonly alwaysOn?: boolean
  readonly config: OverlayConfig
  readonly onChange: (next: OverlayConfig) => void
  readonly context: ViewOptionsContext
}

function OverlayItemRow({
  icon,
  label,
  item,
  position,
  onPlace,
  sized,
  fadeable,
  alwaysOn = false,
  config,
  onChange,
  context,
}: OverlayItemRowProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const on = position !== 'off'
  const anchor = position === 'off' ? defaultAnchorFor(item) : position
  return (
    <ActivationRow
      icon={icon}
      label={label}
      on={on}
      alwaysOn={alwaysOn}
      onToggle={() => onPlace(on ? 'off' : defaultAnchorFor(item))}
    >
      <View style={styles.placementRow}>
        <Text style={[styles.placementLabel, { color: colors.foreground }]}>{t('v2.overlay.position')}</Text>
        <OverlayPositionPicker value={anchor} onChange={onPlace} allowOff={false} />
      </View>
      {sized !== undefined ? (
        <StepperRow
          compact
          label={t('v2.overlay.size')}
          value={config.sizeStep[sized]}
          min={OVERLAY_STEP_MIN}
          max={OVERLAY_STEP_MAX}
          formatValue={(n) => (n === 0 ? t('v2.overlay.sizeAuto') : n > 0 ? `+${n}` : `${n}`)}
          onChange={(n) => onChange(setSizeStep(config, sized, n))}
        />
      ) : null}
      {fadeable !== undefined && context === 'single' ? (
        <CheckboxRow
          label={t('v2.overlay.fadeReadout')}
          value={config.fade[fadeable]}
          onValueChange={(v) => onChange(setFade(config, fadeable, v))}
        />
      ) : null}
    </ActivationRow>
  )
}

const styles = StyleSheet.create({
  section: { fontSize: 12, fontWeight: '600', paddingTop: SPACING.sm, paddingBottom: SPACING.xs },
  hint: { fontSize: 11, paddingVertical: SPACING.xs },
  placementRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.md, paddingVertical: SPACING.xs },
  // Content-sized (flexShrink, not flex:1): the position picker stretches into
  // the leftover width and MEASURES it to choose grid vs drop-down.
  placementLabel: { flexShrink: 1, fontSize: TYPOGRAPHY.size.md, fontWeight: TYPOGRAPHY.weight.regular },
  readoutRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: CONTROL.lg },
  readoutLabel: { flexShrink: 1, fontSize: TYPOGRAPHY.size.md, fontWeight: TYPOGRAPHY.weight.regular },
  removeBtn: { width: CONTROL.md, height: CONTROL.md, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: CONTROL.lg },
  addLabel: { fontSize: TYPOGRAPHY.size.md, fontWeight: TYPOGRAPHY.weight.medium },
})
