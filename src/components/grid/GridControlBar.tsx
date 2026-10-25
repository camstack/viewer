/**
 * GridControlBar — the grid's floating control surface in immersive mode.
 *
 * Composes the SHARED `FloatingControlBar` (the unified bar used by both the
 * grid and the single-camera stream — the grid set is the source of truth):
 * back · title · pause/play · AUDIO (combinable multiselect popover) · quality
 * (popover) · layout (popover) · highlight MENU (master toggle + persisted
 * trigger editor + box-overlay layers, via `GridMenuPanel`) · active-only · share ·
 * edit. Purely presentational: renders state, emits intent via callbacks.
 *
 * TWO hosts, one bar. The grid page (saved or `/grid/adhoc`) floats it over the
 * wall; camera-detail's wall (`WorkspaceStage`) docks it under the cells. The
 * saved-grid verbs — share, edit — and the page-only ones — back, title, the
 * timeline clock — are optional props, so a host that has no saved grid or no
 * such page simply does not pass them and the buttons are not drawn.
 */
import React from 'react'
import { Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  Play, Pause, Volume2, VolumeX, Gauge, LayoutGrid, Zap, Filter, Pencil, Share2, Clock,
} from '../../lib/icons.js'
import { hapticTap, hapticAction } from '../../lib/haptics.js'
import { useTheme } from '../../theme/theme-provider.js'
import {
  FloatingControlBar,
  ControlBarOption,
  ControlBarLeadRow,
  ControlBarDivider,
  type ControlBarAction,
} from '../camera/FloatingControlBar.js'
import { SPACING } from '../../theme/tokens.js'
import { GridMenuPanel } from './GridMenuPanel.js'
import type { GridLayout, GridQuality, GridHighlightSettings } from '../../store/grid-store.js'
import { QUALITY_ORDER, qualityLabelKey } from '../camera/stream-quality-labels.js'
import type { OverlayLayer } from '../camera/overlay/overlay-config.js'

interface CameraRow {
  readonly id: number
  readonly name: string
}

export interface GridControlBarProps {
  /** The page's title. Absent ⇒ none drawn (camera-detail names its camera in
   *  its own toolbar). */
  readonly title?: string
  /** Leave the page. Absent ⇒ no back button (camera-detail has its own). */
  readonly onBack?: () => void
  /** Opens the grid builder. Optional — hidden for ad-hoc (unpersisted) grids. */
  readonly onEdit?: () => void
  /** True if ANY tile is paused (mass button shows Play → resumes all). */
  readonly anyPaused: boolean
  readonly onTogglePause: () => void
  /** Cameras for the audio multiselect (combinable audio). */
  readonly cameras: readonly CameraRow[]
  readonly audioOnIds: ReadonlySet<number>
  readonly onToggleAudio: (deviceId: number) => void
  /** True if ANY camera has audio on (master row shows Mute all → mutes all). */
  readonly anyAudioOn: boolean
  readonly onToggleMassAudio: () => void
  readonly quality: GridQuality
  readonly onSelectQuality: (q: GridQuality) => void
  readonly layout: GridLayout
  readonly onSelectLayout: (l: GridLayout) => void
  /** Master highlight toggle (edited inside the runtime menu) — per-grid and
   *  persisted, defaults ON. */
  readonly highlightOn: boolean
  readonly onToggleHighlight: () => void
  /** PERSISTED per-grid highlight triggers + patcher (runtime menu editor). */
  readonly highlightSettings: GridHighlightSettings
  readonly onSetHighlightSettings: (patch: Partial<GridHighlightSettings>) => void
  /** Box-overlay layers (runtime menu) — per-grid and persisted; the SAME
   *  ordered scale the camera-detail overlay uses. */
  readonly layers: readonly OverlayLayer[]
  readonly onToggleLayer: (layer: OverlayLayer) => void
  readonly activeOnly: boolean
  readonly onToggleActiveOnly: () => void
  /** Opens the share-builder dialog (standalone frozen-view link). Optional —
   *  hidden when the surface can't share (e.g. no server URL yet). */
  readonly onShare?: () => void
  /**
   * The clock button: is the timeline's chrome drawn?
   *
   * Absent ⟺ no button, which is a phone: this page mounts no timeline below
   * the tablet threshold (`shouldMountGridTimeline`), so there is nothing to
   * show or hide and a control that does nothing is worse than a missing one.
   *
   * Above it the button is back on the operator's call (2026-09-02) — but it
   * does NOT mount and unmount the timeline any more. The wall is the
   * timeline's child now, so unmounting would re-parent every tile and re-dial
   * every peer; `onToggleTimeline` flips a hidden STATE of a host that stays
   * mounted (`TheaterTimelineProps.chromeHidden`).
   */
  readonly timelineOn?: boolean
  readonly onToggleTimeline?: () => void
  /** The open popover, owned by the SCREEN — see `grid/panel-dismiss`: a tap on
   *  the wall has to be able to close it, and the bar cannot see that tap. */
  readonly panelKey: string | null
  readonly onPanelKey: (key: string | null) => void
  /** In its host's row instead of floating — see `FloatingControlBar`. */
  readonly docked?: boolean
}

interface Option<T> {
  readonly value: T
  readonly label: string
}
const LAYOUT_OPTIONS: readonly Option<GridLayout>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
]
/**
 * The badge letter per tier — one entry per member of the SYSTEM enum plus
 * `auto`, so a tier added upstream is a type error here rather than a blank
 * chip. The tiers themselves and their order come from `QUALITY_ORDER`, and
 * their names from `qualityLabelKey`: this bar used to carry its own English
 * literals ("Auto/High/Mid/Low"), which is how it ended up offering a scale the
 * single-camera picker did not have.
 */
const QUALITY_BADGE: Record<GridQuality, string> = { auto: 'A', high: 'H', mid: 'M', low: 'L' }

export function GridControlBar({
  title,
  onBack,
  onEdit,
  anyPaused,
  onTogglePause,
  cameras,
  audioOnIds,
  onToggleAudio,
  anyAudioOn,
  onToggleMassAudio,
  quality,
  onSelectQuality,
  layout,
  onSelectLayout,
  highlightOn,
  onToggleHighlight,
  highlightSettings,
  onSetHighlightSettings,
  layers,
  onToggleLayer,
  activeOnly,
  onToggleActiveOnly,
  onShare,
  timelineOn,
  onToggleTimeline,
  panelKey,
  onPanelKey,
  docked,
}: GridControlBarProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  const actions: ControlBarAction[] = [
    {
      key: 'pause',
      icon: anyPaused ? Play : Pause,
      tip: anyPaused ? t('v2.gridBar.playAll') : t('v2.gridBar.pauseAll'),
      onPress: () => { hapticAction(); onTogglePause() },
    },
    {
      key: 'audio',
      icon: audioOnIds.size > 0 ? Volume2 : VolumeX,
      tip: t('v2.gridBar.audio'),
      badge: audioOnIds.size > 0 ? String(audioOnIds.size) : undefined,
      panelScroll: true,
      panel: () =>
        cameras.length === 0 ? (
          <Text style={{ color: colors.foregroundMuted, fontSize: 13, padding: SPACING.sm }}>—</Text>
        ) : (
          <>
            <ControlBarLeadRow
              icon={anyAudioOn ? VolumeX : Volume2}
              label={anyAudioOn ? t('v2.gridBar.muteAll') : t('v2.gridBar.unmuteAll')}
              onPress={() => { hapticAction(); onToggleMassAudio() }}
            />
            <ControlBarDivider />
            {cameras.map((c) => (
              <ControlBarOption
                key={c.id}
                label={c.name}
                selected={audioOnIds.has(c.id)}
                onPress={() => { hapticTap(); onToggleAudio(c.id) }}
              />
            ))}
          </>
        ),
    },
    {
      key: 'quality',
      icon: Gauge,
      tip: t('v2.gridBar.quality'),
      badge: QUALITY_BADGE[quality],
      panel: (close) => (
        <>
          {QUALITY_ORDER.map((tier) => (
            <ControlBarOption
              key={tier}
              label={t(qualityLabelKey(tier))}
              selected={tier === quality}
              onPress={() => { hapticTap(); onSelectQuality(tier); close() }}
            />
          ))}
        </>
      ),
    },
    {
      key: 'layout',
      icon: LayoutGrid,
      tip: t('v2.gridBar.layout'),
      badge: layout === 'auto' ? 'A' : String(layout),
      panel: (close) => (
        <>
          {LAYOUT_OPTIONS.map((o) => (
            <ControlBarOption
              key={String(o.value)}
              label={o.label}
              selected={o.value === layout}
              onPress={() => { hapticTap(); onSelectLayout(o.value); close() }}
            />
          ))}
        </>
      ),
    },
    {
      key: 'menu',
      icon: Zap,
      tip: t('v2.gridBar.highlightMenu'),
      active: highlightOn,
      panelScroll: true,
      panel: () => (
        <GridMenuPanel
          highlightOn={highlightOn}
          onToggleHighlight={onToggleHighlight}
          layers={layers}
          onToggleLayer={onToggleLayer}
          highlight={highlightSettings}
          onSetHighlight={onSetHighlightSettings}
        />
      ),
    },
    {
      key: 'activeOnly',
      icon: Filter,
      tip: t('v2.gridBar.activeOnly'),
      active: activeOnly,
      onPress: () => { hapticTap(); onToggleActiveOnly() },
    },
    ...(onToggleTimeline
      ? [
          {
            key: 'timeline',
            icon: Clock,
            tip: t('v2.gridBar.timeline'),
            active: timelineOn === true,
            onPress: () => { hapticTap(); onToggleTimeline() },
          } satisfies ControlBarAction,
        ]
      : []),
    ...(onShare
      ? [{ key: 'share', icon: Share2, tip: t('v2.gridBar.share'), onPress: onShare } satisfies ControlBarAction]
      : []),
    ...(onEdit
      ? [{ key: 'edit', icon: Pencil, tip: t('v2.gridBar.edit'), onPress: onEdit } satisfies ControlBarAction]
      : []),
  ]

  return (
    <FloatingControlBar
      onBack={onBack}
      backTip={t('v2.gridBar.back')}
      docked={docked}
      title={title}
      actions={actions}
      hideTip={t('v2.gridBar.hide')}
      showTip={t('v2.gridBar.show')}
      panelKey={panelKey}
      onPanelKey={onPanelKey}
    />
  )
}
