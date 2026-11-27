/**
 * Settings → Viewing: everything GLOBAL about watching a camera.
 *
 *   • Stream defaults       — what the player does the moment it opens.
 *   • Timeline              — how the event strip under it is drawn. These rows
 *                             write `settings.clusters`, ONE document read by
 *                             every camera's theater timeline — which is why
 *                             they live here and not in one camera's panel.
 *   • Highlight appearance  — motion / audio / detection colours, thickness,
 *                             and how long the motion highlight lingers.
 *   • Manage cameras        — rename / hide / reorder (`/settings/cameras`).
 *
 * Stream quality is PER-CAMERA (persisted on change, restored on open) and is
 * set from the camera's quality picker, not here. Grid overlays, columns and
 * order are per-grid (the grid builder).
 */
import React from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import { Box, Camera, History, Layers, List, Maximize2, PanelBottom, Volume2, Zap } from '../../lib/icons.js'
import { Section } from '../../components/ui/Section.js'
import { Row } from '../../components/ui/Row.js'
import { ToggleRow } from '../../components/ui/ToggleRow.js'
import { SelectRow, type SelectOption } from '../../components/ui/SelectRow.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { ColorPickerRow } from '../../components/ui/ColorPickerRow.js'
import { AUDIO_ON_OPEN_MODES, type AudioOnOpenMode } from '../../live/audio-on-open.js'
import {
  TOOLBAR_DENSITY_FACTOR,
  type ToolbarDensity,
} from '../../components/camera/theater/timeline-scale-tokens.js'
import { useSettings } from '../../data/use-settings.js'
import { useDeviceSettingsStore } from '../../store/device-settings-store.js'
import { OVERLAY_SIZES, type OverlaySize } from '../../components/camera/overlay/overlay-size.js'
import {
  MOTION_HOLD_SECONDS,
  matchTimelineDensityPreset,
  TIMELINE_DENSITY_PRESETS,
  TIMELINE_DENSITY_PRESET_ORDER,
  type TimelineDensityPreset,
} from '../../store/settings-store.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { SettingsGrid } from './SettingsGrid.js'

/** Segmented-control value space for the timeline density: the presets plus the
 *  never-offered "custom" sentinel shown when the stored pair matches none
 *  (set via a pre-preset install, or a future fine stepper). */
type TimelineDensityChoice = TimelineDensityPreset | 'custom'

const THICKNESS_PX = [1, 2, 3, 4, 6, 8] as const

export function ViewingSegment() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { settings, setGridDefault, setStreamDefault, setHighlightAppearance, setCluster } = useSettings()

  // A DEVICE setting — never part of the account settings.
  const overlaySize = useDeviceSettingsStore((st) => st.settings.overlaySize)
  const setOverlaySize = useDeviceSettingsStore((st) => st.setOverlaySize)
  const overlaySizeOptions: readonly SelectOption<OverlaySize>[] = OVERLAY_SIZES.map((size) => ({
    value: size,
    label: t(`v2.settings.overlaySize${size === 'small' ? 'Small' : size === 'medium' ? 'Medium' : 'Large'}`),
  }))

  const thicknessOptions: readonly SelectOption<number>[] = THICKNESS_PX.map((n) => ({
    value: n,
    label: `${n}px`,
  }))

  // Single-camera toolbar height. Derived from the factor table so the offer
  // and the behaviour cannot drift: a density added there appears here.
  const toolbarDensityOptions: readonly SelectOption<ToolbarDensity>[] = (
    Object.keys(TOOLBAR_DENSITY_FACTOR) as ToolbarDensity[]
  ).map((d) => ({ value: d, label: t(`v2.settings.toolbarDensity.${d}`) }))

  // How a camera's sound starts. Each option carries WHAT it does rather than
  // leaving the row to explain three behaviours in one line.
  const audioOnOpenOptions: readonly SelectOption<AudioOnOpenMode>[] = AUDIO_ON_OPEN_MODES.map((m) => ({
    value: m,
    label: t(`v2.settings.audioOnOpenMode.${m}`),
    detail: t(`v2.settings.audioOnOpenModeHint.${m}`),
  }))

  // Motion-highlight linger: 0 reads as "Off" (clear the instant motion ends).
  const motionHoldOptions: readonly SelectOption<number>[] = MOTION_HOLD_SECONDS.map((s) => ({
    value: s,
    label: s === 0 ? t('v2.settings.motionHoldOff') : t('v2.settings.secondsValue', { count: s }),
  }))

  const densityPreset = matchTimelineDensityPreset(settings.clusters)
  const densityOptions: readonly { value: TimelineDensityChoice; label: string }[] =
    TIMELINE_DENSITY_PRESET_ORDER.map((preset) => ({
      value: preset,
      label: t(`v2.cameraMenu.density_${preset}`),
    }))
  const applyDensityPreset = (choice: TimelineDensityChoice): void => {
    if (choice === 'custom') return
    const values = TIMELINE_DENSITY_PRESETS[choice]
    setCluster('gapPercent', values.gapPercent)
    setCluster('cardWidthFraction', values.cardWidthFraction)
  }

  return (
    <SettingsGrid>
      <Section title={t('v2.settings.streamDefaults')}>
        {/* `last-selected` opens a camera the way IT was left; a camera nobody
            has chosen on yet opens silent (`opensMuted`). */}
        <SelectRow
          icon={Volume2}
          label={t('v2.settings.audioOnOpen')}
          options={audioOnOpenOptions}
          value={settings.stream.audioOnOpen}
          onChange={(v) => setStreamDefault('audioOnOpen', v)}
        />
        <ToggleRow
          icon={Maximize2}
          label={t('v2.settings.pinchExpandsHeight')}
          description={t('v2.settings.pinchExpandsHeightHint')}
          value={settings.stream.pinchExpandsHeight}
          onValueChange={(v) => setStreamDefault('pinchExpandsHeight', v)}
        />
        {/* Multiplies the width-derived scale that already sizes every element
            of the single-camera bar, so the controls grow with it. */}
        <SelectRow
          icon={PanelBottom}
          label={t('v2.settings.toolbarDensity')}
          options={toolbarDensityOptions}
          value={settings.stream.toolbarDensity}
          onChange={(v) => setStreamDefault('toolbarDensity', v)}
        />
        {/* The camera detail is a stacked route painted OVER the tabs; see
            `camera-detail/stream-nav-bar.ts`. */}
        <ToggleRow
          icon={PanelBottom}
          label={t('v2.settings.navBarOnStream')}
          description={t('v2.settings.navBarOnStreamHint')}
          value={settings.stream.navBarOnStream}
          onValueChange={(v) => setStreamDefault('navBarOnStream', v)}
        />
        {/* Remembered only while the single stream is where the operator LEFT
            off — changing page clears it (`navigation/last-camera.ts`). */}
        <ToggleRow
          icon={History}
          label={t('v2.settings.reopenLastCamera')}
          description={t('v2.settings.reopenLastCameraHint')}
          value={settings.stream.reopenLastCamera}
          onValueChange={(v) => setStreamDefault('reopenLastCamera', v)}
          last
        />
      </Section>

      <Section title={t('v2.settings.overlays')}>
        {/* This phone / tablet / browser only (`device-settings-store`): the size
            is a share of the picture on THIS screen, so it is a device
            setting and never travels with the account. */}
        <SelectRow
          icon={Maximize2}
          label={t('v2.settings.overlaySize')}
          options={overlaySizeOptions}
          value={overlaySize}
          onChange={setOverlaySize}
          last
        />
        <Text
          style={{
            color: colors.foregroundMuted,
            fontSize: 11,
            paddingHorizontal: SPACING.xl,
            paddingBottom: SPACING.lg,
          }}
        >
          {t('v2.settings.overlaySizeHint')}
        </Text>
      </Section>

      <Section title={t('v2.settings.timeline')}>
        <View style={{ paddingHorizontal: SPACING.xl, paddingTop: SPACING.lg, gap: SPACING.sm }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{t('v2.cameraMenu.densityTitle')}</Text>
          <SegmentedControl<TimelineDensityChoice>
            options={densityOptions}
            value={densityPreset ?? 'custom'}
            onChange={applyDensityPreset}
          />
          {densityPreset === null ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{t('v2.cameraMenu.densityCustom')}</Text>
          ) : null}
        </View>
        <ToggleRow
          icon={List}
          label={t('v2.cameraMenu.showClass')}
          value={settings.clusters.showClass}
          onValueChange={(v) => setCluster('showClass', v)}
          last
        />
      </Section>

      <Section title={t('v2.settings.highlightAppearance')}>
        <ColorPickerRow
          icon={Zap}
          label={t('v2.settings.highlightMotionColor')}
          value={settings.highlight.motionColor}
          onChange={(c) => setHighlightAppearance('motionColor', c)}
        />
        <ColorPickerRow
          icon={Volume2}
          label={t('v2.settings.highlightAudioColor')}
          value={settings.highlight.audioColor}
          onChange={(c) => setHighlightAppearance('audioColor', c)}
        />
        <ColorPickerRow
          icon={Box}
          label={t('v2.settings.highlightDetectionColor')}
          value={settings.highlight.detectionColor}
          onChange={(c) => setHighlightAppearance('detectionColor', c)}
        />
        <SelectRow
          icon={Maximize2}
          label={t('v2.settings.highlightThickness')}
          options={thicknessOptions}
          value={settings.highlight.thickness}
          onChange={(v) => setHighlightAppearance('thickness', v)}
        />
        {/* It describes the HIGHLIGHT, and was never wall-only — it drives
            useMotionHighlight everywhere. */}
        <SelectRow
          icon={Zap}
          label={t('v2.settings.motionHold')}
          options={motionHoldOptions}
          value={settings.grid.motionHoldSec}
          onChange={(v) => setGridDefault('motionHoldSec', v)}
          last
        />
      </Section>

      <Section title={t('v2.settings.cameras')}>
        <Row
          icon={Camera}
          label={t('v2.settings.manageCameras')}
          value={t('v2.settings.manageCamerasHint')}
          onPress={() => router.push('/settings/cameras')}
          last
        />
      </Section>
    </SettingsGrid>
  )
}
