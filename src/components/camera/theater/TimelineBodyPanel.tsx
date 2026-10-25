/**
 * TimelineBodyPanel — routes the timeline body to whichever panel currently
 * owns it.
 *
 * A single switch, so `TheaterTimeline` carries one branch instead of one
 * conditional block per panel, and so the exclusivity the layout depends on is
 * structural: exactly one panel can be resolved from one `TimelinePanelId`.
 *
 * The switch is also the exhaustiveness check. Every arm returns an element and
 * the function is declared to return one, so adding a member to `TimelinePanel`
 * without routing it does not compile — which is the only reason a union this
 * wide is safe to keep growing.
 */
import React from 'react'

import type { EventKindDescriptor } from '../../../data/event-kinds.js'
import { TimelineLinkedDevicesPanel } from './TimelineLinkedDevicesPanel.js'
import { TimelinePtzPanel } from './TimelinePtzPanel.js'
import type { ActivityFilter, TimelineBarKind } from './mock-data.js'
import type { PositionedCluster } from './event-cluster.js'
import type { TimelinePanel } from './timeline-layout.js'
import type { RecordingDaysStatus } from './recording-days-status.js'
import type { CameraOverlayConfig } from '../overlay/overlay-config.js'
import type { GridHighlightSettings } from '../../../store/grid-store.js'
import type { StreamQuality } from '../../../store/settings-store.js'
import type { CameraSelectionMode } from '../../../screens/camera-detail/camera-selection.js'
import type { ZoneShape } from './zone-filter.js'
import { TimelineFilterPanel } from './TimelineFilterPanel.js'
import { TimelineDatePanel } from './TimelineDatePanel.js'
import { TimelineClusterPanel } from './TimelineClusterPanel.js'
import { TimelineCameraPanel } from './TimelineCameraPanel.js'
import { TimelineViewOptionsPanel } from './TimelineViewOptionsPanel.js'
import { TimelineLegendPanel } from './TimelineLegendPanel.js'
import { StorageManagementPanel } from '../management/StorageManagementPanel.js'
import { EventsManagementPanel } from '../management/EventsManagementPanel.js'

/** The activity filter's state + reducers (owned by `TheaterTimeline`). */
export interface TimelineFilterBinding {
  readonly filter: ActivityFilter
  readonly onToggleKind: (kind: TimelineBarKind) => void
  readonly classes: readonly string[]
  readonly classFilter: ReadonlySet<string>
  readonly onToggleClass: (className: string) => void
  readonly onSetClasses: (classes: readonly string[]) => void
  readonly onReset: () => void
  readonly eventKinds?: readonly EventKindDescriptor[]
}

/** The month calendar's state + reducers. */
export interface TimelineDateBinding {
  readonly monthAnchorMs: number
  readonly selectedDayMs: number
  readonly daysSet: ReadonlySet<number>
  /** Whether those days were actually READ — see `recording-days-status`. */
  readonly daysStatus: RecordingDaysStatus
  readonly nowMs: number
  readonly onChangeMonth: (deltaMonths: number) => void
  /** Jump to a day at the SAME time of day as the playhead (`dayAtSameTime`). */
  readonly onPick: (dayEpoch: number) => void
  /** Jump to an exact epoch — the panel's day-at-hour selection. */
  readonly onPickTime: (epochMs: number) => void
}

/** The cluster detail's seek, and whether the moment has footage at all. */
export interface TimelineClusterBinding {
  readonly onSeek: (epochMs: number) => void
  /** False only when the owning surface KNOWS there is no recording there. */
  readonly seekAvailable: (cluster: PositionedCluster) => boolean
}

/**
 * Where the camera panel can take this surface — the footer's camera button and
 * nothing else.
 *
 * One optional GROUP, like {@link TimelineSingleCameraBindings}, because the
 * three members are useless apart: a surface that cannot re-route has no
 * selection to confirm and no mode to confirm it in. Absent ⟺ the panel is
 * never opened, and the button that would open it is not drawn — the type is
 * what says so, not a convention.
 *
 * The grid page omits it. Its timeline exists only above the tablet threshold
 * (`shouldMountGridTimeline`) and the button exists only BELOW it, so the two
 * gates leave nothing there to reach the panel with — and a binding nothing can
 * reach reads as a live feature.
 */
export interface TimelineCameraJumpBinding {
  /** Switch the detail view to another camera (the screen re-routes). */
  readonly onSwitchCamera: (deviceId: number) => void
  /** The camera panel's confirmed selection, in list order. The SCREEN decides
   *  what it means — a view to build here, a route to push on a phone. */
  readonly onOpenAdhocGrid: (deviceIds: readonly number[]) => void
  /** Which of those two it is (`camera-selection.ts`). It travels with the
   *  callback, in the one binding, so the button's wording and the screen's
   *  action can never come from two different answers. */
  readonly cameraSelection: CameraSelectionMode
}

/**
 * The camera this surface is showing.
 *
 * `hasPtz` gates the PTZ cap query, and `name` titles the two management
 * panels — both are the SCREEN's knowledge of the device, not the timeline's.
 */
export interface TimelineDeviceBinding {
  readonly cameraName: string
  readonly hasPtz: boolean
  /** Battery-powered camera — gates the charge query so wired cams never ask. */
  readonly hasBattery: boolean
  /** The device binds `network-link` — gates the link query so a camera
   *  without the cap never asks (one warning per poll, per camera, otherwise). */
  readonly hasNetworkLink: boolean
  /** The device binds `navigation` (a robot camera). Opens the same controls
   *  panel as PTZ — two separate capabilities, one icon (operator, 2026-09-06). */
  readonly hasNavigation: boolean
  /** See {@link TimelineCameraJumpBinding} — absent ⟺ no camera panel here. */
  readonly cameraJump?: TimelineCameraJumpBinding
}

/** The live stream tier — owned by the screen, which derives the WebRTC target. */
export interface TimelineStreamBinding {
  readonly quality: StreamQuality
  readonly onSelectQuality: (quality: StreamQuality) => void
}

/**
 * The per-camera highlight document + its patcher, owned by the screen.
 *
 * ONE binding for one stored document: the view-options panel edits the border
 * TRIGGERS through its inline overlay sections (they gate something drawn on
 * the picture, so they live with the border switch) and the `clusterLabel`
 * member in its timeline section. Splitting the binding per section would put
 * two patchers over one stored document.
 */
export interface TimelineViewOptionsBinding {
  readonly highlight: GridHighlightSettings
  readonly onSetHighlight: (patch: Partial<GridHighlightSettings>) => void
}

/** The per-camera overlay document + its writer (owned by the screen, which
 *  also DRAWS from it — the view-options panel's inline overlay sections are
 *  only the editor). */
export interface TimelineOverlayBinding {
  readonly config: CameraOverlayConfig
  readonly onChange: (next: CameraOverlayConfig) => void
}

/**
 * Panel-to-panel navigation out of the view-options menu.
 *
 * Deliberately NOT part of the view-options binding the screen supplies: these
 * hand THIS body to a sibling panel, which is something only the timeline can
 * do. Folding them into the screen's binding would have forced the screen to
 * pass two callbacks it has no way to implement — a control that does nothing,
 * written down as a type.
 */
export interface TimelineManagementBinding {
  readonly onOpenStorage: () => void
  readonly onOpenEventStore: () => void
  /** The legend, reached from the view-options menu now that the toolbar's
   *  help button is gone. */
  readonly onOpenLegend: () => void
  /** The way BACK from the two panels above — they are reached only from the
   *  view-options menu, so their host's chevron returns there. Toolbar-opened
   *  panels never receive a back handler (nothing is behind them). */
  readonly onBackToViewOptions: () => void
}

/**
 * What this bar may only offer when the surface above it is ONE camera.
 *
 * It is the same rule that removed PTZ, the linked-devices panel and the
 * capture menu on 2026-09-02, applied one step further out. Those four were
 * deleted because no per-camera meaning survives a bar that sits over a VIEW;
 * these three do have a meaning — on camera-detail — so they are supplied
 * there and omitted where they would be a lie:
 *
 *  - the stream TIER is one WebRTC session's; the grid page's wall has N, and
 *    its own control bar already owns the per-grid tier (a second knob that
 *    disagrees with the first is worse than no knob);
 *  - the view-options / overlay documents are ONE camera's stored prefs
 *    (`CameraOverlayConfig`), and the wall draws a different one per cell;
 *  - the ZONE is drawn on the player surface, and the grid page has no single
 *    picture to draw it on.
 *
 * ONE optional group and not six optional props, because they are not
 * independent: the view-options panel edits the overlay document AND the
 * highlight document, so a surface that supplied one without the other would
 * open a half-panel. The type refuses that combination outright.
 */
/**
 * Zone filter (v0, client-side) — state owned by `CameraDetailScreen`.
 *
 * Its own group, and OPTIONAL inside a group that is itself optional, because
 * the zone is the one member here whose availability does not follow the
 * others'. It is drawn on the PLAYER SURFACE (`ZoneDrawOverlay`, over the video
 * box) and the timeline only applies it as a filter — so a surface that has the
 * per-camera documents but no single picture to draw on (camera-detail once the
 * workspace wall has replaced the picture) supplies everything else and omits
 * this. Absent ⟺ the zone button is not drawn: a button that opens a drawing
 * mode over a wall of six cameras would have no frame to mean anything in.
 */
export interface TimelineZoneBinding {
  /** The active zone (normalised 0..1 of the 16:9 frame), or null. */
  readonly zoneRect: ZoneShape | null
  /** Drawing mode is open on the player: the zone button reads as engaged. */
  readonly drawing: boolean
  /** Zone button tap with NO active zone → enter drawing mode on the player. */
  readonly onRequestZoneDraw: () => void
  /** Zone button tap while the flow is ACTIVE (drawing or a zone applied) →
   *  cancel the drawing and drop the zone. */
  readonly onClearZone: () => void
}

export interface TimelineSingleCameraBindings {
  /** Current live stream tier (drives the quality chip label) + its setter. */
  readonly streamBinding: TimelineStreamBinding
  /** The video-overlay toggles edited by the view-options panel. */
  readonly viewOptionsBinding: TimelineViewOptionsBinding
  readonly overlayBinding: TimelineOverlayBinding
  /** See {@link TimelineZoneBinding} — absent ⟺ no zone button here. */
  readonly zone?: TimelineZoneBinding
  /**
   * Open THIS camera's linked-devices panel. Absent ⟺ no button.
   *
   * It lives in this group and not on the shared bar for the reason the bar's
   * own header gives: over a wall, a control that acted on one camera out of
   * six — whichever happened to be in the picture — is worse than no control.
   * That objection is about ambiguity, and it does not apply to a surface
   * showing exactly one camera. Removing it from the bar (2026-09-02) left the
   * single-camera player with no route at all, because the surfaces the
   * decision pointed at — the shelf and the wall tile — are the two this screen
   * does not mount.
   */
  readonly onOpenLinkedDevices?: () => void
  /** Whether that panel is up — the toolbar chip's active state. Its host is
   *  outside the timeline, so the state cannot be derived from `panel`. */
  readonly linkedDevicesOpen?: boolean
}

export interface TimelineBodyPanelProps {
  readonly panel: TimelinePanel
  readonly deviceId: number
  /** Hand the body back to the timeline. */
  readonly onClose: () => void
  readonly filterBinding: TimelineFilterBinding
  readonly dateBinding: TimelineDateBinding
  readonly clusterBinding: TimelineClusterBinding
  readonly deviceBinding: TimelineDeviceBinding
  /** Absent when the surface aggregates N cameras — see
   *  {@link TimelineSingleCameraBindings}. */
  readonly singleCamera?: TimelineSingleCameraBindings
  readonly managementBinding: TimelineManagementBinding
}

export function TimelineBodyPanel({
  panel,
  deviceId,
  onClose,
  filterBinding,
  dateBinding,
  clusterBinding,
  deviceBinding,
  singleCamera,
  managementBinding,
}: TimelineBodyPanelProps): React.JSX.Element | null {
  switch (panel.kind) {
    case 'filter':
      return (
        <TimelineFilterPanel
          filter={filterBinding.filter}
          onToggleKind={filterBinding.onToggleKind}
          classes={filterBinding.classes}
          classFilter={filterBinding.classFilter}
          onToggleClass={filterBinding.onToggleClass}
          onSetClasses={filterBinding.onSetClasses}
          onReset={filterBinding.onReset}
          eventKinds={filterBinding.eventKinds}
          onClose={onClose}
        />
      )
    case 'date':
      return (
        <TimelineDatePanel
          monthAnchorMs={dateBinding.monthAnchorMs}
          selectedDayMs={dateBinding.selectedDayMs}
          daysSet={dateBinding.daysSet}
          daysStatus={dateBinding.daysStatus}
          nowMs={dateBinding.nowMs}
          onChangeMonth={dateBinding.onChangeMonth}
          onPick={dateBinding.onPick}
          onPickTime={dateBinding.onPickTime}
          onClose={onClose}
        />
      )
    case 'clusterDetail':
      return (
        <TimelineClusterPanel
          deviceId={deviceId}
          cluster={panel.cluster}
          onSeek={clusterBinding.onSeek}
          seekAvailable={clusterBinding.seekAvailable(panel.cluster)}
          onClose={onClose}
        />
      )
    case 'cameraSwitcher':
      // Unreachable without `cameraJump`, exactly as `viewOptions` is without
      // `singleCamera`: the footer's camera button is the panel's only trigger
      // and it is not rendered when the group is absent (`TimelineFooterBar`).
      // The guard is here so the TYPE refuses a panel with nothing behind it.
      if (!deviceBinding.cameraJump) return null
      return (
        <TimelineCameraPanel
          currentId={deviceId}
          onSwitch={deviceBinding.cameraJump.onSwitchCamera}
          onOpenGrid={deviceBinding.cameraJump.onOpenAdhocGrid}
          selectionMode={deviceBinding.cameraJump.cameraSelection}
          onClose={onClose}
        />
      )
    case 'ptz':
      // Gated on the CAPABILITIES, not only on `singleCamera`: a camera with
      // neither a gimbal nor a drive has no pad to show, and the chip that
      // opens this is not drawn for it. The robot camera has `navigation` and
      // no PTZ: it drew no chip and reached no panel (2026-09-06).
      if (!singleCamera || !(deviceBinding.hasPtz || deviceBinding.hasNavigation)) return null
      return (
        <TimelinePtzPanel
          deviceId={deviceId}
          cameraName={deviceBinding.cameraName}
          hasPtz={deviceBinding.hasPtz}
          hasNavigation={deviceBinding.hasNavigation}
          onClose={onClose}
        />
      )
    case 'linkedDevices':
      // Same gate and same reason as `viewOptions`: the chip that opens this
      // is not drawn without `singleCamera`, and the TYPE is what refuses a
      // panel with nothing behind it.
      if (!singleCamera) return null
      return (
        <TimelineLinkedDevicesPanel
          deviceId={deviceId}
          cameraName={deviceBinding.cameraName}
          onClose={onClose}
        />
      )
    case 'viewOptions':
      // Unreachable without `singleCamera`: the ≡ button that opens this panel
      // is not rendered at all when the bindings are absent
      // (`TimelineToolbarInline`). The guard is here because a panel kind that
      // could only be opened by convention is exactly the shape this union was
      // made to retire — the type, not a comment, is what refuses it.
      if (!singleCamera) return null
      return (
        <TimelineViewOptionsPanel
          deviceId={deviceId}
          overlayConfig={singleCamera.overlayBinding.config}
          onChangeOverlay={singleCamera.overlayBinding.onChange}
          highlight={singleCamera.viewOptionsBinding.highlight}
          onSetHighlight={singleCamera.viewOptionsBinding.onSetHighlight}
          onOpenStorage={managementBinding.onOpenStorage}
          onOpenEventStore={managementBinding.onOpenEventStore}
          onOpenLegend={managementBinding.onOpenLegend}
          onClose={onClose}
        />
      )
    case 'legend':
      return <TimelineLegendPanel onClose={onClose} />
    case 'storage':
      return (
        <StorageManagementPanel
          deviceId={deviceId}
          cameraName={deviceBinding.cameraName}
          onBack={managementBinding.onBackToViewOptions}
          onClose={onClose}
        />
      )
    case 'eventStore':
      return (
        <EventsManagementPanel
          deviceId={deviceId}
          cameraName={deviceBinding.cameraName}
          onBack={managementBinding.onBackToViewOptions}
          onClose={onClose}
        />
      )
  }
}
