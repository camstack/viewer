/**
 * TheaterTimeline — the master component rendered BELOW the live stream on the
 * camera-detail page.
 *
 * Below the main toolbar there are exactly TWO states, and this component's job
 * is to choose between them:
 *
 *   TIMELINE  →  `TimelineView`: the docked playback bar, the heatmap + vertical
 *                scroller + now-line, and the docked footer bar.
 *   PANEL     →  `TimelineBodyPanel`: filter / date / capture / export /
 *                cluster detail / PTZ / devices / camera switcher / quality /
 *                view options / storage / event store, owning the entire box
 *                and carrying its own way back.
 *
 * Clips is a MODE of the timeline (same chrome, compressed visit axis), not a
 * panel. The footer clapperboard toggles it; the body stays `TimelineView`.
 *
 * The last seven joined on 2026-08-01 from `CameraDetailScreen`, where five
 * were floating cards and two were `<Modal>`s. Their state came with them: the
 * screen used to hold an `activePanel` union of its own, which the toolbar's
 * active chips were then derived from — two unions that had to agree about
 * which surface was open. There is now ONE, and the chips read `panel?.kind`.
 *
 * The two bands belong to the timeline, not to this component, so opening a
 * panel cannot leave one of them behind (see `TimelineView`). Nothing floats
 * and nothing is presented in a window of its own: the previous arrangement —
 * a transport pill anchored above the now-line, a FAB row pinned over the
 * bottom of the list, and a slide-up modal for the cluster detail — had each of
 * them negotiating for a space it did not own, and all of them read wrong the
 * moment the window changed shape.
 *
 * What stays here is the MODEL: the live-edge clock, the day window and its
 * progressive back-scroll, the per-camera activity filter, clustering, the
 * heatmap bins, and the wiring from the scroll gesture into the playback
 * machine (`use-timeline-scrub`).
 */
import { clusterRenderStateSignature } from './cluster-render-state-signature.js'
import type { ServedProfileReport } from '../../../recording/recording-messages.js'
import React, { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { cancelAnimation, useSharedValue, withTiming } from 'react-native-reanimated'
import { useViewportSize } from '../../../hooks/use-viewport-size.js'
import type { LayoutChangeEvent } from 'react-native'
import { useBattery } from '../../../data/use-battery.js'
import { useIsAdmin } from '../../../data/use-me.js'
import type { LaneSelection } from './activity-view-types.js'
import { lanesActiveAt } from './timeline-lanes-layout.js'
import { trainingCollectVisible } from '../../../recording/record-menu.js'
import { useNetworkLink } from '../../../data/use-network-link.js'
import { useTranslation } from 'react-i18next'
import { floatingToolsBottomInset, floatingToolsTopInset } from './TimelineFloatingTools.js'

import { useReducedMotion } from '../../../theme/motion.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { TimelineToolbarInline } from './TimelineToolbarInline.js'
import { MeasuredTimelineScale } from './MeasuredTimelineScale.js'
import { TIMELINE_RAIL_WIDTH_NARROW } from '../../../screens/camera-detail/wide-detail-sizes.js'
import { LandscapeTimelineOverlay } from './LandscapeTimelineOverlay.js'
import {
  detailShapeTestId,
  type DetailLayoutMode,
} from '../../../screens/camera-detail/detail-layout.js'
import { streamSlotStyle } from './stream-slot.js'
import { qualityLabelKey, QUALITY_ORDER } from '../stream-quality-labels.js'
import { useTimelineFilter } from './use-timeline-filter.js'
import { TimelineView } from './TimelineView.js'
import { SendFrameToTrainingControl } from './SendFrameToTrainingControl.js'
import { FreezeWhileCovered } from './FreezeWhileCovered.js'
import {
  TimelineBodyPanel,
  type TimelineDeviceBinding,
  type TimelineSingleCameraBindings,
} from './TimelineBodyPanel.js'
import { useTimelinePanels } from './use-timeline-panels.js'
import {
  clampZoomIndex,
  DEFAULT_ZOOM_INDEX,
  heatmapCursorFraction,
  TIMELINE_ROW_HEIGHT,
} from './mock-data.js'
import { layoutAnchorMs, mappedEpochToOffset, pxPerHour, type TimelineEpochMap } from './timeline-geometry.js'
import { dayFractionToEpoch, epochToDayFraction, localDayWindow } from './heatmap-scrub.js'
import {
  indicatorOffsetPx,
  resolveIndicatorPct,
} from './timeline-indicator.js'
import {
  CURSOR_SHIFT_MS,
  cursorShiftEase,
  cursorShiftStartPx,
  shouldAnimateCursorShift,
} from './timeline-cursor-shift.js'
import {
  ZOOM_SHIFT_MS,
  zoomShiftEase,
  zoomShiftScaleStart,
  shouldAnimateZoomShift,
} from './timeline-zoom-shift.js'
import { beginAutoZoom, mapAutoZoomSample, type AutoZoomState } from '../../../utils/auto-zoom-map.js'
import type { TimelineZoomMode } from './timeline-zoom-mode.js'
import { clipsModeDefaultFor } from './clips-mode-default.js'
import {
  cardCenterScrollOffsetPx,
  holdsTapPlacement,
  type TapPlacement,
} from './timeline-card-centering.js'
import { clipExitResumeMs } from '../../../clips/clip-exit-resume.js'
import { useRecordingMode, useRecordingAvailability, useDaysWithRecordings } from '../../../data/use-recording.js'
import { useTimelineScrub } from './use-timeline-scrub.js'
import { useTabletViewport } from '../../../hooks/use-responsive.js'
import { useTimelineDeferral } from './use-timeline-deferral.js'
import type { PlaybackMode, ScrubSource } from '../../../recording/playback-machine.js'
import { eventMomentSeekMs } from '../../../recording/playback-status.js'
import type { ScrubDirection } from '../../../recording/scrub-direction.js'
import { hapticDetent, hapticTap } from '../../../lib/haptics.js'
import {
  DETENT_INITIAL,
  detentKeyWhileScrubbing,
  resolveDetent,
  type DetentState,
} from '../../../lib/scrub-detent.js'
import { initTimelineScope } from './timeline-scope.js'
import { idsFromScopeKey, scopeIdsKey } from './timeline-scope-read.js'
import { unionUnknownIds, type ScopeNoticeInput } from './timeline-scope-notice.js'
import type { TimeRange } from '../../../timeline/coverage.js'
import { recordingKnownAt } from '../../../recording/recording-availability.js'
import { describeExportSelection } from '../../../recording/export-selection.js'
import {
  resolveRecordControl,
  type ExportSelectionFlow,
  type LiveCaptureFlow,
} from '../../../recording/record-control.js'
import { log } from '../../../lib/logger.js'
import { isSettledDayChange, nextLookbackDaysAfterDayChange } from './lookback-walk.js'
import { composeHeatmapBins, filterDetectionsByKind } from './event-highlights.js'
import { usePaletteView } from '../../../../shared/palette.js'
import { filterEventsByZone, resolveFrameSize, zonePillAction } from './zone-filter.js'
import { collapseToMacro, expandSelectionToServerClasses } from '../../../data/event-kinds.js'
import { monthBoundsForMs } from '../../ui/calendar-grid.js'
import { shiftLocalDay } from '../../../lib/local-day.js'
import { dayAtSameTime, dateLabel } from '../../../recording/day-nav.js'
import { useDateLocale } from '../../../lib/date-locale.js'
import { useSettings } from '../../../data/use-settings.js'
import { useDeviceTracks } from '../../../data/use-device-tracks.js'
import { resolveClipsStatus } from '../../../clips/clips-status.js'
import { useCameraClips } from '../../../data/use-camera-clips.js'
import { useCameraClipProvider } from '../../../data/use-camera-prefs.js'
import { resolveClipTap } from '../../../clips/clip-tap.js'
import type { Clip } from '../../../clips/clip-model.js'
import {
  resolveClipDownload,
} from '../../../clips/clip-download.js'
import { useClipExport } from '../../../clips/use-clip-export.js'
import type { ClipQualityOption } from '../../../clips/clip-export-quality.js'
import type { ClipProfile } from '../../../clips/clip-quality.js'
import { ClipExportModal } from './ClipExportModal.js'
import { EventDownloadModal } from './EventDownloadModal.js'
import { useCameras } from '../../../data/use-cameras.js'
import { IDLE_CLIP_EXPORT } from '../../../clips/clip-export-progress.js'
import { resolveTimelineCursor } from './timeline-cursor.js'
import type { ClipSaveBinding } from './TimelineScroller.js'
import { resolveClipsSurface } from '../../../clips/clips-surface.js'
import type { ClipProgressBinding } from '../../../clips/clip-progress.js'
import type { ClipLoopBinding } from '../../../clips/clip-loop.js'
import type { ClipControlsView } from '../../../clips/clip-controls.js'
import type { ClipIncompleteNotice } from '../../../clips/clip-incomplete-notice.js'
import {
  UNKNOWN_CLIP_ROW_PLAYBACK,
  clipRowFromEpoch,
  clipRowFromHeld,
  type ClipRowPlayback,
} from '../../../clips/clip-row-playback.js'
import { noteClipOpenStep, noteTimelineInputIgnored } from '../../../clips/clip-telemetry.js'
import { useConnection } from '../../../connection/ConnectionProvider.js'
import {
  resolveTimelineFaults,
  activeFaultSources,
  pruneDismissals,
  type FaultSource,
  type TimelineFaultSignals,
} from './timeline-faults.js'
import { resolveRecordingDaysStatus } from './recording-days-status.js'
import { useTimelineActivity } from '../../../data/use-timeline-activity.js'
import { clusterCardHeight } from './cluster-frame-box.js'
import { memberSeekMs } from './cluster-members.js'
import { clusterByZoom, type ObjectEvent, type PositionedCluster } from './event-cluster.js'
import {
  clipEndByCardId,
  cardIdForClip,
  clipForCardId,
  clipStartByCardId,
  deriveClipsFromClusters,
  nativeDerivedClips,
  positionDerivedClips,
  type DerivedClip,
} from './clips-from-clusters.js'
import { clipAtEpoch, clipDayCoverage } from '../../../clips/clip-pick.js'
import {
  buildClipAxis,
  clipAxisEpochToOffset,
  clipAxisOffsetToEpoch,
  clipAxisTicks,
} from '../../../clips/clip-axis.js'
import {
  DEFAULT_END_GUARD_MS,
  EMPTY_RIBBON,
  normalizeClips,
  resolveClipAdvance,
} from '../../../clips/clip-timeline.js'
import {
  buildExpansionMap,
  expansionMapsEqual,
  nearestClusterId,
  type ClusterExpansionMap,
} from './cluster-proximity.js'

/**
 * The clip whose quality picker is open, and the copies to offer it.
 *
 * The OPTIONS are captured with the clip rather than re-derived when the modal
 * renders: the list behind it refetches every 60 s, and a picker that re-read
 * the row mid-gesture could offer a different set of copies than the one the
 * operator opened.
 */
interface ClipQualityPick {
  readonly clip: Clip
  readonly options: readonly ClipQualityOption[]
}

/**
 * The PICTURE's health, from the screen that owns the player.
 *
 * The stream is the one of the theater's three loadable things this component
 * does not fetch, so its signal arrives as a prop while recordings and events
 * are read here. All three then go through the SAME reduction — a stream fault
 * with its own private rendering is exactly what this replaced.
 */
export interface TimelineStreamFaultBinding {
  /** The player reported a hard failure (live `error`, or a recorded playback
   *  that could not be read). */
  readonly failed: boolean
  /** A connection attempt is in flight. */
  readonly fetching: boolean
  /** The reason the player gave, when it gave one. */
  readonly reason: string | null
  /** Retry NOW. The auto-retry loop runs with or without this; the button only
   *  makes the next attempt sooner. */
  readonly onRetry: () => void
}

/**
 * What a host may ask of the timeline from OUTSIDE its chrome. One member:
 * the robot's landscape drive overlay carries a "…" that opens the controls
 * panel — the same `ptz` kind the toolbar chip toggles, through the same
 * `useTimelinePanels` union. A second union, or a `'drive'` kind, would be
 * two answers to "which panel is open" (operator, 2026-09-06).
 */
export interface TheaterTimelineHandle {
  readonly openControls: () => void
}

export interface TheaterTimelineProps {
  /** The imperative handle above; React 19 passes `ref` as a plain prop. */
  readonly ref?: React.Ref<TheaterTimelineHandle>
  /** Landscape overlay mode: no opaque background (the host wrapper draws a
   *  translucent scrim over the video instead). */
  readonly transparent?: boolean
  /** The app's bottom navigation bar is drawn right under this column
   *  (`stream.navBarOnStream`): it already covers the home-indicator inset, so the
   *  footer adds none of its own. */
  readonly navBarVisible?: boolean
  readonly deviceId: number
  /**
   * Every camera this timeline aggregates — the workspace's members plus the
   * one in the picture, in that order.
   *
   * `deviceId` stays what it always was: the camera the SINGULAR things act on
   * (the player above, the export, the cluster detail's media authorization).
   * This is what the timeline READS. Absent (or a single id) is camera-detail
   * exactly as it shipped: the singular wire, the singular cache entries, no
   * behavioural difference of any kind.
   */
  readonly scopeIds?: readonly number[]
  readonly name: string
  readonly onBack: () => void
  /** Wide rail: hide the toolbar's back arrow (app sidebar navigates). */
  readonly hideBack?: boolean
  /**
   * The PLAYER, hosted in this component's stream slot — in EVERY layout.
   *
   * This component owns the whole camera-detail column: the toolbar, the
   * picture and the body, plus the landscape drawer and the wide rail. That is
   * not empire-building, it is the only arrangement in which the player has ONE
   * parent. Two earlier attempts failed the other way round:
   *
   *  - 1.0.263 put the player here in portrait and under the SCREEN in
   *    landscape. Rotating changed its parent chain, React remounted it, and
   *    the WebRTC session was renegotiated on every turn of the phone.
   *  - 1.0.265 moved it to a single absolutely-positioned host at the screen
   *    root and had this component publish a spacer offset via `onLayout`.
   *    `onLayout` reports coordinates relative to the PARENT, not the window,
   *    so the host landed an app-header's worth too high: a strip of video
   *    appeared above the toolbar and a dead band opened between the picture
   *    and the controls.
   *
   * The slot needs no measurement at all. It is plain flow in portrait, which
   * is what rendered correctly for years, and the player keeps its size styles
   * (`videoWrap` / `videoWrapFull`) exactly as before.
   *
   * Supplied only by the PORTRAIT stack (`toolbarPlacementFor(mode) === 'top'`),
   * where the operator asked for the toolbar at the TOP of the screen rather
   * than pinned under the picture. Reserving the space here is what makes that
   * possible with ONE toolbar: the alternative — rendering a second toolbar
   * above the stream in the screen — would need every piece of panel/quality
   * state lifted out of this component, and two unions that have to agree about
   * which panel is open is the exact defect the panel consolidation removed.
   *
   */
  readonly stream?: React.ReactNode
  /**
   * A clip that is a FILE was tapped — hand it to the camera's own frame.
   *
   * It goes UP rather than being opened here, because the frame belongs to the
   * screen: `ClipStageView` renders inside `streamBox`, and the playback
   * machine that has to be detached for it lives there too. Opening a player of
   * its own here is what the old `NativeClipModal` did, and it left a WebRTC
   * session running behind a sheet (D570).
   *
   * Absent on a caller with no frame of its own (the grid wall's timeline),
   * where a file clip simply does nothing rather than opening a sheet over a
   * wall of cameras.
   */
  /**
   * Open a clip in the camera's frame, NAMING the provider that holds it.
   *
   * The name travels because nobody downstream can work it out: the broker
   * reads the bytes through a collection capability with several providers on
   * one camera, and an unnamed read resolves in-process to its own addon's
   * sibling (D554's rule, one method over). Deriving it from the clip id's
   * shape is what D482 forbids.
   */
  readonly onOpenClipInFrame?: (clip: Clip, provider: string) => void
  /**
   * The clip list this body is showing, in its own order, whenever it changes.
   *
   * Published rather than asked for: the screen needs it to STEP (prev/next in
   * the frame, `clipStageStep`), and the list is derived here from the read,
   * the source choice and the day window. A second derivation in the screen
   * would be a second answer to "which clips does this camera have".
   */
  readonly onClipsChange?: (clips: readonly Clip[]) => void
  /** The screen's resolved shape. Decides where the toolbar sits and whether
   *  the chrome is a column, the landscape drawer or the wide rail. */
  /**
   * A surface that shares the STREAM SLOT with the picture, under it.
   *
   * It is a prop rather than something the screen renders around `stream`,
   * because wrapping `stream` would change the player's parent chain — and the
   * player having ONE parent in every layout is what keeps a rotation from
   * remounting the WebRTC session (see `stream`). A sibling added at index 1 of
   * the slot leaves the picture exactly where it was.
   *
   * Only the `wide` shape reserves space for it (`STREAM_MAX_HEIGHT_FRACTION`);
   * in `stack` and `fill` the caller passes nothing and the slot is unchanged.
   */
  readonly belowStream?: React.ReactNode
  readonly layoutMode?: DetailLayoutMode
  /** Rail width for `wide` (from `computeWideDetailSizes`). */
  readonly railWidth?: number
  /**
   * The timeline's chrome is HIDDEN: the toolbar, the two bands and the body
   * are still mounted, still hold their scroll offset, their zoom and their
   * measured viewport — they are simply not drawn and take no space, and the
   * stream slot takes the whole surface.
   *
   * ## Why hiding and not unmounting
   *
   * This component is the PARENT of the picture in every layout (see `stream`).
   * Unmounting it — which is what an ordinary on/off toggle does — changes the
   * player's parent chain, so React remounts it and every WebRTC peer under it
   * is torn down and re-dialled. On the grid page that is a whole wall of
   * sessions renegotiated per tap, which is why the toggle was DELETED rather
   * than kept when the wall moved inside the timeline (2026-09-02).
   *
   * The operator asked for it back ("riporta indietro l'orologio per la grid"),
   * so "off" became a state of the always-mounted host instead: a hidden style
   * on the chrome and a fuller box for the slot. Nothing above the slot moves,
   * so nothing under it is re-parented.
   *
   * Hidden ALSO stops the timeline's own reads — a surface nobody can see must
   * not cost four batched calls per view — and freezes its reconciliation
   * (`FreezeWhileCovered`), so the live-edge tick does not re-lay-out a column
   * that is not on screen.
   *
   * Absent ⇒ shown, which is camera-detail: there the timeline is the point of
   * the screen and has never been optional.
   */
  readonly chromeHidden?: boolean
  // ── Playback machine surface (the single owner of playhead + live/mode) ──
  /** Current machine mode — drives the LIVE pill + indicator color. `live` ⟺
   *  the live edge; every other mode renders the recorded/red indicator. */
  readonly mode: PlaybackMode
  /** The epoch to render the cursor/indicator at: the seek preview while
   *  seeking, else the playhead. `null` ⟺ live → falls back to wall-clock now. */
  readonly activeEpoch: number | null
  /**
   * The epoch a seek is still waiting to land on — `PlaybackState.seekAnchor`,
   * null once it landed or when none is in flight.
   *
   * REQUIRED, not optional: this gates the clips-mode advance loop, and an
   * absent prop would silently read as "a seek is pending" and disable the
   * feature. See the advance effect for what an unlanded seek does to it.
   */
  readonly seekAnchor: number | null
  /** Seek to an absolute epoch (heatmap tap, cluster tap, day-nav, detail). */
  readonly onSeek: (epochMs: number, source: ScrubSource) => void
  /** Drag lifecycle — begin, per-move preview epoch, settle/commit epoch. */
  readonly onScrubBegin: (source: ScrubSource) => void
  readonly onScrubMove: (
    epochMs: number,
    source: ScrubSource,
    hint?: { readonly mode: 'fine' | 'coarse'; readonly velocityPxPerS: number },
  ) => void
  readonly onScrubCommit: (epochMs: number, source: ScrubSource) => void
  /** Return the player to the live edge (remounts the WebRTC session). */
  readonly onGoLive: () => void
  /** The live lock: browsing the timeline leaves the picture where it is.
   *  Owned by the playback machine, rendered in the bar's leading control. */
  readonly liveLocked: boolean
  readonly onToggleLiveLock: () => void
  /**
   * Live local-record: the screen owns the capture session (it owns the
   * player). ABSENT ⟺ there is no picture to record from (the wall).
   *
   * Three named callbacks rather than one `onToggleCapture`, because a toggle
   * is what shipped the defect: the bar could press it in a recorded mode,
   * where there is no live view, and the screen answered "cannot record the
   * live view". A press now reaches the flow the MODE selected, and stopping is
   * two different acts — keep, or throw away — which the operator says out loud
   * instead of being asked afterwards.
   */
  readonly liveCapture?: LiveCaptureFlow
  /**
   * Recorded-export selection. ABSENT ⟺ this surface cannot export (a wall of
   * N has no single camera), and an absent binding draws no control at all.
   *
   * The timeline owns NEITHER end of the selection. The anchor is the playback
   * machine's, the free end is `activeEpoch` — the same value the indicator is
   * drawn at — and the hub call is the screen's. What this component adds is the
   * one thing only it can: the recorded coverage under the range, which it has
   * already fetched for the heatmap. It hands that verdict BACK on save, so the
   * screen can tell the operator before anything is queued.
   */
  readonly exportSelection?: TimelineExportSelectionBinding
  /**
   * Cut the frame on screen — live or recorded — into the Activity list. The
   * screen owns it (it owns the player). ABSENT ⟺ the player cannot hand over
   * a frame (the wall), and the REC menu then has no snapshot entry.
   */
  readonly onSnapshot?: () => void

  // ── Playback bar (docked under the toolbar; controls vary by mode) ────────
  /** Selected play rate (never 0 — pause is a separate control). */
  readonly playbackRate: number
  /** EFFECTIVE pause: the live poster pause, or the recorded rate-0 hold. The
   *  SAME binding the on-video overlay receives — one state, two affordances. */
  readonly paused: boolean
  /** The recorded tier the player is really on, next to the one asked for —
   *  the bar's tier badge. Null until the embed has said. */
  readonly servedTier?: ServedProfileReport | null
  /** The picture is not there yet — live connecting, or a recorded seek in
   *  flight. Drawn as a ring around the bar's play/pause. */
  readonly loading: boolean
  /** The PICTURE's health — see {@link TimelineStreamFaultBinding}. Owned by
   *  the screen (it owns the player); reduced here with the two loads this
   *  component owns into the timeline's single fault slot. */
  readonly streamFault: TimelineStreamFaultBinding
  /** Which way an in-flight scrub is heading — replaces the glyph on
   *  play/pause while a drag is live. Null when no drag is active. */
  readonly scrubDirection?: ScrubDirection | null
  readonly onTogglePlayPause: () => void
  readonly onJogBack: () => void
  /**
   * A clip holds the camera's own frame, and the previous / next clip (D575).
   * Threaded to the playback bar, which turns the jog pair into clip stepping
   * — see `PlaybackBarLayout.jogMeans`.
   */
  readonly clipHeld?: boolean
  /**
   * Leaving clips mode, and WHERE the clip had got to in wall-clock ms —
   * `null` when no clip was on the frame.
   *
   * The operator's ask: *"quando chiudo la modalità clip deve tornare sul
   * playback sul punto che lasciamo"*. The timeline knows the position (it
   * holds the clip's start as `activeEpoch` and the file-relative offset as
   * `clipProgress`); only the SCREEN can release the clip and drive the
   * recorded axis, so the arithmetic is done here and the two actions there.
   */
  readonly onLeaveClipsMode?: ((resumeAtMs: number | null) => void) | null
  readonly onClipPrev?: (() => void) | null
  readonly onClipNext?: (() => void) | null
  /**
   * The held clip's position inside its file and the seek along it
   * (`clip-progress.ts`). Forwarded to the bar only while the surface says a
   * FILE is on screen (`axis === 'clip'`) — the same gate as `clipHeld`.
   */
  readonly clipProgress?: ClipProgressBinding
  /**
   * The LOOP switch for the held file (`clips/clip-loop.ts`). Forwarded to the
   * bar on the same statement as {@link clipProgress} — a surface with no file
   * on it has nothing to loop.
   */
  readonly clipLoop?: ClipLoopBinding
  /**
   * What the hub says this camera's clips can be driven to do
   * (`clip-controls.ts`, D612) — the rate ladder and the backward
   * frame-step. Unlike {@link clipProgress} it is NOT gated on a clip being
   * on screen: it is a statement about the camera and its provider, and the
   * bar needs it to decide what the speed menu may offer.
   */
  readonly clipControls?: ClipControlsView
  /**
   * The camera cut the held clip's replay short (D623), already resolved
   * against the clip on the stage by the screen that owns it.
   *
   * A prop, like `streamFault`, because only the screen holds the clip stage
   * the report is named by — and threaded through rather than re-derived, so
   * `resolveClipIncompleteNotice` keeps exactly one caller.
   */
  readonly clipIncomplete?: ClipIncompleteNotice
  /**
   * WHICH clip holds the frame, by id — what {@link clipHeld} leaves out.
   *
   * The list needs the identity, not the boolean: the row that is running has
   * to be findable among the cards, and the boolean says only that one of them
   * is. Null (or absent) means the session has the frame; a derived clip
   * played by SEEKING is not on this prop at all, because it is not on the
   * clip stage — the timeline already knows that one as `activeClipId`.
   */
  readonly clipOnFrameId?: string | null
  readonly onJogForward: () => void
  /** Frame-step. Absent on a surface with no frame-stepping verb (the grid
   *  page's wall) — the two step buttons are then not drawn. */
  readonly onStepFrame?: (dir: 1 | -1) => void
  readonly onSelectRate: (rate: number) => void

  // The footer band takes no props beyond what is already here: it is pure
  // timeline chrome (zoom / filter / zone / camera). Volume and talk belong to
  // the STREAM and live on the video overlay.

  // ── Toolbar button cluster (capture / PTZ / devices / ≡ menu / quality) ───
  // No `ptzOpen` / `onTogglePtz` pairs here any more: the PTZ, devices,
  // view-options, quality and camera-switcher surfaces are PANELS of this
  // timeline, and every one of their triggers is timeline chrome (the toolbar
  // row, the footer's camera button). What the screen still supplies is what it
  // OWNS — the device, the stream tier, the video overlays — as bindings.
  /** The camera itself: name, PTZ capability, and where a switch navigates. */
  readonly deviceBinding: TimelineDeviceBinding
  /**
   * The controls that act on ONE camera — supplied only by a surface that HAS
   * one. Absent on the grid page, where the picture is a wall of N.
   *
   * See {@link TimelineSingleCameraBindings} for why these travel as one
   * optional group rather than six optional props.
   */
  readonly singleCamera?: TimelineSingleCameraBindings
  /** Fill-mode drawer — parent-owned so History can live in OverlayDiscGroup. */
  readonly drawerExpanded?: boolean
  /** The drawer sits BESIDE the stream (`timeline-dock` `side`), not over it. */
  readonly drawerBeside?: boolean
}

/**
 * The screen's half of the export selection: the FLOW (`record-control.ts`)
 * plus the one fact only the machine holds.
 *
 * Discard creates nothing — see `use-exports.ts`: a cancelled export keeps its
 * history row, so "create on release, cancel on discard" would leave litter on
 * the hub for a period the operator explicitly threw away.
 */
export interface TimelineExportSelectionBinding extends ExportSelectionFlow {
  /** The FIXED end, from the playback machine. Null ⟺ nothing armed. */
  readonly anchorMs: number | null
}


/**
 * Progressive infinite back-scroll: the VERTICAL timeline (cluster cards +
 * activity bars + scroll content height) extends one extra day into the past
 * each time the user scrolls within ~one screen of the oldest end, up to
 * MAX_LOOKBACK_DAYS. The HEATMAP stays single-day (see dayWindow).
 */
const MAX_LOOKBACK_DAYS = 30

/**
 * How far the surface widens its own window when a day comes back EMPTY.
 *
 * Separate from {@link MAX_LOOKBACK_DAYS}, which bounds what the operator can
 * reach by scrolling: this one bounds what the app does on its own, unasked,
 * and the two are different promises. Fourteen days, chosen by the operator.
 *
 * Every step is one `listClips`, which on the Reolink provider is a
 * serve-and-revalidate per DAY — a cold day measured 2.0 s, and the retention
 * on this fleet is 18 days, so the ceiling is inside the range where an answer
 * can still exist. The right long-term bound is the camera's own day index
 * (the provider already reads it on every `listClips`): one call that says
 * "the nearest day with files is the 18th" replaces the whole walk.
 */
const MAX_AUTO_LOOKBACK_DAYS = 14

/** Timeline cards are drawn this much larger than the operator's width
 *  fraction says (+17%); the panel's thumbnails follow the resulting width. */
const CARD_SCALE = 1.17

/** Floor for the clustering absorption window before the card has been measured. */
const MIN_CLUSTER_HEIGHT_PX = 8

/**
 * Margin above/below the viewport used by the DIAGNOSTIC's visible-cluster
 * count — and by nothing else.
 *
 * It is NOT the mount window. That one is real now and lives in
 * `timeline-window.ts` (`MOUNT_MARGIN_PX`, a different number for a different
 * job): this one only decides what the log line calls "visible", and the log
 * line exists to tell a cap that returned nothing from geometry that dropped
 * what arrived.
 *
 * For years the comment here claimed it kept off-screen cards mounted, which
 * described windowing the code did not have — and a constant whose comment
 * claims a behaviour is how a reader concludes the list is virtualised and
 * stops looking for the render cost.
 */
const CLUSTER_WINDOW_MARGIN_PX = 80

/**
 * Shortest hole clips mode LABELS on its compressed axis.
 *
 * One constant for both readers: the axis decides which gaps are collapsed
 * time (and counts them into `collapsedMs`), and the scroller draws an
 * "⋯ 2h 14m" marker for exactly those. Two literals would eventually disagree,
 * and the visible result — a labelled gap the axis never collapsed, or a
 * collapsed one with no marker — reads as a rendering bug rather than a
 * mismatch of two numbers.
 */
const CLIP_AXIS_MIN_GAP_MS = 2_000

export const TheaterTimeline = memo(function TheaterTimeline(props: TheaterTimelineProps) {
  const { t } = useTranslation()
  const dateLocale = useDateLocale()
  const { colors } = useTheme()
  const palette = usePaletteView()
  // Live edge = real wall-clock now, ADVANCING every second — the SINGLE time
  // reference for the whole surface (live-edge tick, day window, heatmap bins +
  // cursor, indicator, go-live decision), so nothing freezes at mount and drifts
  // behind the player's real-epoch positions.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // ─── Cluster / activity settings ────────────────────────────────────
  const clusterSettings = useSettings().settings.clusters
  // Toolbar height is an operator preference; it multiplies the width-derived
  // scale rather than replacing it, so a narrow rail still shrinks the bar.
  const toolbarDensity = useSettings().settings.stream.toolbarDensity

  // ─── Zoom (the timeline's visible RANGE) ──────────────────────────
  //
  // One setting, one control: the footer's range button owns it outright. It
  // used to be a (−)/(+) pair stepping this index with the value shown nowhere.
  // Auto mode drives the same index from scrub velocity (`auto-zoom-map.ts`);
  // the chip then reads "Auto" until the operator picks a fixed span.
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX)
  const [zoomMode, setZoomMode] = useState<TimelineZoomMode>('fixed')
  const autoZoomRef = useRef<AutoZoomState>(beginAutoZoom(DEFAULT_ZOOM_INDEX, 0))
  const lastScrubEpochRef = useRef<number | null>(null)
  const handleZoomIndexChange = useCallback((index: number) => {
    setZoomIndex(clampZoomIndex(index))
  }, [])
  const handleZoomModeChange = useCallback((mode: TimelineZoomMode) => {
    setZoomMode(mode)
    if (mode === 'auto') {
      // Seed Auto from the span currently on screen — functional update so we
      // do not close over a stale index and do not need the later zoomIndexRef.
      setZoomIndex((current) => {
        autoZoomRef.current = beginAutoZoom(current, Date.now())
        return current
      })
    }
  }, [])

  // Clips MODE: same timeline chrome, axis compressed around visits. Not a panel.
  const [clipsMode, setClipsMode] = useState(false)
  const [activeClipId, setActiveClipId] = useState<string | null>(null)
  /**
   * Whether the body is the OPERATOR's choice yet.
   *
   * The default below arrives asynchronously, so it cannot be an initial
   * state. It applies once per camera and never again: a default that keeps
   * re-asserting itself is a control that fights its owner, and this timeline
   * has shipped that defect twice.
   */
  const clipsModeChosenRef = useRef(false)
  /**
   * Where the held clip has got to, in WALL CLOCK — the clip's own start plus
   * its file-relative position.
   *
   * A ref so `toggleClips` keeps a stable identity: the toggle is on the
   * toolbar and re-minting it on every position report would re-render the
   * chrome at frame rate.
   *
   * `activeEpoch` is the clip's start only while a clip is ON THE FRAME
   * (`CameraDetailScreen` folds `clipStartOnFrame` into it), so the id is the
   * gate — without it the number would be the recorded playhead and exiting
   * would "resume" where it already was.
   */
  const clipWallClockRef = useRef<number | null>(null)
  clipWallClockRef.current = clipExitResumeMs({
    heldClipId: props.clipOnFrameId ?? null,
    clipStartMs: props.activeEpoch,
    clipPositionMs: props.clipProgress?.progress.positionMs ?? null,
  })

  const onLeaveClipsMode = props.onLeaveClipsMode
  const toggleClips = useCallback(() => {
    clipsModeChosenRef.current = true
    setClipsMode((on) => {
      // Only the OFF transition resumes. Entering clips mode from the
      // recorded axis must not seek anything.
      if (on) onLeaveClipsMode?.(clipWallClockRef.current)
      else {
        // Wall-clock range is meaningless on the visit axis — Auto off.
        setZoomMode('fixed')
      }
      return !on
    })
    setActiveClipId(null)
  }, [onLeaveClipsMode])
  // Clips mode (including the async default) always forces Auto off.
  useEffect(() => {
    if (clipsMode) setZoomMode('fixed')
  }, [clipsMode])
  // ─── A camera the hub records only on EVENTS opens on its clips ─────
  // > "se una camera è in modalità eventi e non continua, la modalità
  // >  predefinita deve essere la clip mode"
  //
  // `clips-mode-default.ts` owns the rule, including the half that is easy to
  // lose: a mode that could not be READ answers `null` and decides nothing.
  const recordingMode = useRecordingMode(props.deviceId, true)
  useEffect(() => {
    // A different camera is a different question, and its answer has not been
    // given yet. Reset before the default can land, or camera B inherits the
    // choice the operator made on camera A.
    clipsModeChosenRef.current = false
  }, [props.deviceId])
  useEffect(() => {
    if (clipsModeChosenRef.current) return
    const preferred = clipsModeDefaultFor(recordingMode.data ?? null)
    if (preferred === null) return
    clipsModeChosenRef.current = true
    setClipsMode(preferred)
    setActiveClipId(null)
  }, [recordingMode.data])

  // ─── Which of the two states the box under the toolbar is in ────────
  // The cluster detail carries its cluster IN this state (see `TimelinePanel`),
  // so it cannot be open without one — the coupling the old modal expressed as
  // `visible={cluster !== null}` is now a type.
  // Every write to it lives in `useTimelinePanels` — twelve inline `setPanel`
  // calls is twelve chances for the chip and the panel to disagree.
  const panels = useTimelinePanels()
  const { panel, body, close: closePanel } = panels
  const togglePanel = panels.toggle
  const toggleFilter = useCallback(() => togglePanel('filter'), [togglePanel])
  const toggleViewOptions = useCallback(() => togglePanel('viewOptions'), [togglePanel])
  const toggleLinkedDevices = useCallback(() => togglePanel('linkedDevices'), [togglePanel])
  const togglePtz = useCallback(() => togglePanel('ptz'), [togglePanel])
  // Quality is NOT a panel any more — it is a drop-down anchored to its own
  // toolbar chip, so it owns a plain open flag. Routing it through the panel
  // system would hand the entire timeline body over to show four words, which
  // is exactly what it used to do.
  const [qualityOpen, setQualityOpen] = useState(false)
  const toggleQuality = useCallback(() => setQualityOpen((o) => !o), [])
  // The tiers the quality chip's drop-down offers. It used to be a PANEL that
  // took the whole timeline body over to show four words; it is a selector now
  // (operator, 2026-08-02), so the options live beside the chip.
  const qualityOptions = useMemo(
    () => QUALITY_ORDER.map((q) => ({ value: q, label: t(qualityLabelKey(q)) })),
    [t],
  )
  const singleCamera = props.singleCamera
  const onSelectQuality = useCallback(
    (value: string) => {
      const tier = QUALITY_ORDER.find((q) => q === value)
      if (tier) singleCamera?.streamBinding.onSelectQuality(tier)
      setQualityOpen(false)
    },
    [singleCamera],
  )
  const toggleCamera = useCallback(() => togglePanel('cameraSwitcher'), [togglePanel])
  /**
   * Whether the top bar offers the camera switch at all.
   *
   * The tablet test is the app's ONE definition (`isTabletViewport`, keyed off
   * the device screen so an open keyboard cannot turn a tablet into a phone),
   * asked here rather than threaded from the two screens: both would have to
   * compute the same thing, and two answers to one question is what this
   * component was consolidated to stop.
   *
   * It is a device question and not a layout one on purpose — `layoutMode`
   * cannot tell a tablet in portrait from a phone in portrait, and both are
   * `stack`.
   */
  const canPickCamera = !useTabletViewport() && props.deviceBinding.cameraJump !== undefined
  // NOT toggles: the two management panels are reached FROM the view-options
  // panel and replace it — toggling would hand the menu back on tap.
  const openPanel = panels.open
  const openStorage = useCallback(() => openPanel('storage'), [openPanel])
  const openEventStore = useCallback(() => openPanel('eventStore'), [openPanel])
  const openLegend = useCallback(() => openPanel('legend'), [openPanel])
  // The way BACK from those two: they were opened out of the view-options
  // menu, so their header chevron re-opens it (close would drop the operator
  // on the timeline, one level too far out).
  const backToViewOptions = useCallback(() => openPanel('viewOptions'), [openPanel])
  // The drive overlay's "…" (see `TheaterTimelineHandle`): OPEN, not toggle —
  // a press on an overlay control means "show me the panel", never "hide it".
  useImperativeHandle(props.ref, () => ({ openControls: () => openPanel('ptz') }), [openPanel])

  // ─── Scroll offset + viewport height (for cluster windowing) ────────
  // A REF, not state. It feeds one diagnostic and nothing else, and as state it
  // re-rendered the whole timeline on every scroll event — `scrollEventThrottle`
  // is 16ms, so ~60Hz during a drag, each render re-filtering every cluster and
  // emitting a log line. That storm is what made scrubbing seize.
  const scrollOffsetRef = useRef(0)
  const setScrollOffsetY = useCallback((y: number) => {
    scrollOffsetRef.current = y
  }, [])
  const [viewportHeight, setViewportHeight] = useState(0)
  const [listWrapWidth, setListWrapWidth] = useState(0)

  const handleBodyLayout = useCallback((e: LayoutChangeEvent) => {
    const { height, width } = e.nativeEvent.layout
    if (height > 0) setViewportHeight(height)
    if (width > 0) setListWrapWidth(width)
  }, [])

  // ─── The camera SET this timeline reads ─────────────────────────────
  // Seeded from the view, falling back to the camera in the picture — the
  // rule `timeline-scope.ts` was written for and, until now, nobody used.
  // Memoised on the joined key rather than the array, which is a fresh literal
  // on every render of the screen above and would remint four query keys.
  const scopeKey = scopeIdsKey(props.scopeIds ?? [])
  const scopeIds = useMemo(
    () => initTimelineScope(idsFromScopeKey(scopeKey), props.deviceId),
    [scopeKey, props.deviceId],
  )

  // ─── Activity filter + event-kind taxonomy (per camera, persisted) ──
  const activityFilter = useTimelineFilter(props.deviceId)
  const { filter, classFilter, filterAll, classToMacro } = activityFilter

  // Zone filter (v0, client-side): the rect is owned by the screen (drawn on
  // the player surface) and arrives as a prop. A surface with no single picture
  // to draw on supplies no zone at all, and `null` is exactly what every read
  // below already means by "no zone drawn".
  const zoneBinding = singleCamera?.zone
  const zoneRect = zoneBinding?.zoneRect ?? null

  // ─── Geometry: live-edge anchor (topMs) ─────────────────────────────
  // REAL now (offset 0 = this instant), NOT snapped to the row grid: snapping
  // the anchor DOWN pushed the top behind real now, so the live-edge tolerance
  // became that snap gap (minutes) and the stream latched live far too early.
  // Tick LABELS are still snapped inside TimelineScroller.
  const topMs = nowMs

  // The DRAWN anchor: the same live edge, snapped to the pixel grid.
  //
  // Every card is positioned from the live edge, so with real `now` in this
  // slot `clusterByZoom` re-ran once a second and re-minted every cluster
  // object — and a new object defeats `ClusterCard`'s memo, so the entire
  // day's cards re-rendered every second, thumbnails included, for a movement
  // of a fraction of a pixel. Snapped, the re-layout happens exactly when it
  // moves something.
  //
  // ONLY geometry uses it. The scrub keeps `topMs`: its live-edge tolerance is
  // measured in seconds and must not inherit a pixel's worth of slack. The two
  // therefore differ by less than one pixel, which is asserted as a bound in
  // `timeline-window.spec.ts`.
  const layoutTopMs = useMemo(() => layoutAnchorMs(nowMs, zoomIndex), [nowMs, zoomIndex])

  // The day the user is actually viewing — derived from the machine's active
  // epoch, so scrolling into a PREVIOUS day re-windows the heatmap + coverage +
  // events to THAT day.
  // The TIMELINE is on the live edge when there is no active epoch to be parked
  // on — not merely when the PICTURE is. The two only differ under the live
  // lock, where the machine stays in `live` while the operator browses a past
  // moment; unlocked, `activeEpoch` is null exactly when the mode is `live`, so
  // this reads the same as it always did.
  //
  // It is also what lets the list SNAP BACK: `useTimelineScrub` only issues its
  // go-live command while this is false, so scrolling home while locked clears
  // the browsed position instead of stranding the indicator on it.
  const isLive = props.mode === 'live' && props.activeEpoch === null

  // ─── Current-position indicator line (two states, held while seeking) ───
  // Px from the top of the body where the current epoch rests — and ALSO the
  // height of the top spacer prepended to the scroll content, so the current
  // epoch lands on this line while the scrub geometry stays IDENTICAL.
  //
  // The percentage is a tenth at the live edge (the band above it is the
  // future and nothing is drawn there) and a half everywhere else (the band
  // above it is what plays next, and it is where a cluster card HANGS — a
  // snapped card is entirely above the line at a tenth).
  //
  // It follows that fact IMMEDIATELY, mid-drag included. There used to be a
  // latch holding the previous value through `seeking` so the spacer could not
  // move under a dragging finger; the operator asked for the move during the
  // scrub, and the reason the latch existed does not survive measurement — the
  // epoch under the line is a function of the scroll offset alone, so nothing
  // the readout says changes. See `timeline-indicator.ts`.
  const indicatorPct = resolveIndicatorPct({ atLiveEdge: isLive })
  const indicatorPx = useMemo(
    () => indicatorOffsetPx(viewportHeight, indicatorPct),
    [viewportHeight, indicatorPct],
  )

  // ─── …and the MOTION between the two positions ──────────────────────
  // > "non riusciamo a renderlo progressivo? E' abbastanza brutto cosi"
  //
  // The layout above jumps to its final position in ONE commit — every `top`,
  // the mount band, the content height. This value is the purely VISUAL offset
  // that carries the eye from the old position to the new one: it starts at
  // the difference between them and eases to zero, and it is applied as a
  // TRANSFORM (the scroller's content wrapper and the two indicator rows), so
  // no frame changes, `contentSize` is untouched, no scroll event is emitted
  // and nothing can clamp. See `timeline-cursor-shift.ts` for the duration,
  // the curve, and why an interruption retargets rather than snapping.
  //
  // It cannot fight a gesture: `indicatorPct` is HELD through `seeking`, so it
  // can only change at the commit — never with a finger down, never during
  // momentum.
  const cursorShiftPx = useSharedValue<number>(0)
  const reducedMotion = useReducedMotion()
  const cursorShiftFromRef = useRef({ pct: indicatorPct, offsetPx: indicatorPx })
  // When the transition in flight ends (epoch ms; 0 = none). It is the
  // difference between the two paths below, and it is kept on the JS side: the
  // value itself lives on the UI thread and reading it costs a synchronous
  // round trip that the ordinary case must not pay.
  const cursorShiftEndsAtRef = useRef(0)
  useEffect(() => {
    const previous = cursorShiftFromRef.current
    cursorShiftFromRef.current = { pct: indicatorPct, offsetPx: indicatorPx }
    // Driven by the PERCENTAGE, not by the offset: the offset also moves when
    // the body is first measured and on every rotation, and neither is a
    // cursor move. The offsets are what the shift is measured in.
    if (previous.pct === indicatorPct) return
    if (
      !shouldAnimateCursorShift({
        fromOffsetPx: previous.offsetPx,
        toOffsetPx: indicatorPx,
        viewportHeightPx: viewportHeight,
      })
    ) {
      cursorShiftEndsAtRef.current = 0
      cancelAnimation(cursorShiftPx)
      cursorShiftPx.set(0)
      return
    }

    const launch = (currentShiftPx: number): void => {
      cursorShiftPx.set(
        cursorShiftStartPx({
          currentShiftPx,
          fromOffsetPx: previous.offsetPx,
          toOffsetPx: indicatorPx,
        }),
      )
      cursorShiftEndsAtRef.current = Date.now() + CURSOR_SHIFT_MS
      cursorShiftPx.set(withTiming(0, { duration: CURSOR_SHIFT_MS, easing: cursorShiftEase }))
    }

    if (reducedMotion) {
      // The layout jump stands; nothing eases it.
      cursorShiftEndsAtRef.current = 0
      cancelAnimation(cursorShiftPx)
      cursorShiftPx.set(0)
      return
    }

    if (Date.now() >= cursorShiftEndsAtRef.current) {
      // The ordinary case — a scrub commit, a tap, a go-live from rest. The
      // value is settled at 0 and we know it WITHOUT asking, so the start
      // value is written in the same frame the layout jumps. Reading the shared
      // value here would cost a synchronous round trip to the UI thread.
      launch(0)
    } else {
      // The interruption. The value ACTUALLY in force is the only correct base
      // to retarget from — see `cursorShiftStartPx`; a `set(delta)` instead
      // would teleport the content by however much had already been covered.
      // Writing the new start value below cancels the running move.
      launch(cursorShiftPx.get())
    }
  }, [indicatorPct, indicatorPx, viewportHeight, cursorShiftPx, reducedMotion])

  // ─── Zoom RANGE transition (grow / shrink) ──────────────────────────
  // Layout jumps to the new zoomIndex geometry; a scaleY transform eases from
  // oldPxPerHour/newPxPerHour → 1 so the column visibly extends or contracts.
  // Origin is the playhead (`indicatorPx`). Same transform-not-layout rule as
  // the cursor shift — see `timeline-zoom-shift.ts`.
  const zoomScaleY = useSharedValue<number>(1)
  const prevZoomForScaleRef = useRef(zoomIndex)
  useEffect(() => {
    const previous = prevZoomForScaleRef.current
    if (previous === zoomIndex) return
    prevZoomForScaleRef.current = zoomIndex
    const fromPph = pxPerHour(previous)
    const toPph = pxPerHour(zoomIndex)
    if (reducedMotion || !shouldAnimateZoomShift(fromPph, toPph)) {
      cancelAnimation(zoomScaleY)
      zoomScaleY.set(1)
      return
    }
    // Writing the start value cancels a transition still in flight.
    zoomScaleY.set(zoomShiftScaleStart(fromPph, toPph))
    zoomScaleY.set(withTiming(1, { duration: ZOOM_SHIFT_MS, easing: zoomShiftEase }))
  }, [zoomIndex, zoomScaleY, reducedMotion])
  // Unmount only, and deliberately NOT a cleanup on the cursor-shift effect
  // above: that one re-runs on every rotation and on the first measurement, and
  // stopping a transition there would freeze the shift at a non-zero value with
  // no run left to carry it home — the content would sit permanently off its
  // layout. Zoom-scale is the same contract.
  useEffect(
    () => () => {
      cancelAnimation(cursorShiftPx)
      cancelAnimation(zoomScaleY)
    },
    [cursorShiftPx, zoomScaleY],
  )

  const viewedEpoch = props.activeEpoch ?? nowMs
  // `localDayWindow` (heatmap-scrub.ts) rather than a local `setHours`: the
  // compact on-demand timeline spans the same domain, and a second derivation
  // is how the cursor and the tape would end up on two different days.
  // ALWAYS the full calendar day (local midnight → next midnight, 23/24/25 h),
  // for every day — including TODAY. The heatmap strip, coverage bands, cursor
  // and scrub fraction share that domain so today reads identically to past days.
  const dayWindow = useMemo(() => {
    const w = localDayWindow(viewedEpoch)
    return { from: w.fromMs, to: w.toMs }
  }, [viewedEpoch])
  const dayFrom = dayWindow.from

  // ─── Progressive back-scroll (VERTICAL timeline only) ────────────────
  // Only the vertical timeline's data window + content height extend backwards:
  // one extra day per near-bottom hit, capped at MAX_LOOKBACK_DAYS.
  const [lookbackDays, setLookbackDays] = useState(1)
  const timelineFromMs = shiftLocalDay(dayFrom, 1 - lookbackDays)
  const extendLookback = useCallback(
    () => setLookbackDays((d) => Math.min(MAX_LOOKBACK_DAYS, d + 1)),
    [],
  )
  // Adjust `lookbackDays` whenever the viewed day SETTLES on a different one
  // (‹/› nav, date panel, a tap/seek that lands on another day, or go-live
  // returning to today) — never mid-drag, and never by simply collapsing to
  // 1. `dayFrom` is derived from `selectActiveEpoch`, which is the drag's
  // per-frame `seekTarget` while `props.mode === 'seeking'`, so dragging the
  // list backward across a midnight boundary flips `dayFrom` for every
  // straddling frame — resetting on each of those flips collapsed the
  // scrollable content out from under the finger and false-triggered
  // GO_LIVE (`atLiveEdge` read the resulting clamped-near-zero offset as
  // "scrolled home"): the cursor visibly "returned to live" for an instant
  // mid-drag (3.4c, `isSettledDayChange`). And a blanket reset-to-1 on every
  // SETTLED change was its own bug (3.4b, `nextLookbackDaysAfterDayChange`):
  // tapping any card from a day already inside the loaded lookback window —
  // ordinary "watch a video from the history I scrolled into" — discarded
  // that window and snapped the scroll position back toward the top. This
  // ref tracks the last SETTLED day so a run of seeking-mode flicker is
  // compared against, and collapsed into, exactly one adjustment once the
  // gesture actually lands.
  const settledDayFromRef = useRef(dayFrom)
  useEffect(() => {
    if (isSettledDayChange({
      mode: props.mode,
      previousSettledDayFrom: settledDayFromRef.current,
      nextDayFrom: dayFrom,
    })) {
      setLookbackDays((prevLookbackDays) =>
        nextLookbackDaysAfterDayChange({
          previousDayFrom: settledDayFromRef.current,
          previousLookbackDays: prevLookbackDays,
          nextDayFrom: dayFrom,
          maxLookbackDays: MAX_LOOKBACK_DAYS,
        }),
      )
    }
    if (props.mode !== 'seeking') settledDayFromRef.current = dayFrom
  }, [dayFrom, props.mode])

  // Date panel: the anchored month. The hook fetches the recording-day dots only
  // while that panel owns the body.
  const [pickerAnchorMs, setPickerAnchorMs] = useState(dayFrom)
  const { fromMs: pickerMonthFrom, toMs: pickerMonthTo } = useMemo(
    () => monthBoundsForMs(pickerAnchorMs),
    [pickerAnchorMs],
  )
  const recordingDaysQuery = useDaysWithRecordings(
    scopeIds,
    pickerMonthFrom,
    pickerMonthTo,
    panel?.kind === 'date',
  )
  const recordingDays = recordingDaysQuery.data?.days

  const onSeek = props.onSeek
  const handleOpenPicker = useCallback(() => {
    setPickerAnchorMs(dayFrom)
    togglePanel('date')
  }, [dayFrom, togglePanel])
  const handlePickDay = useCallback(
    (dayEpoch: number) => {
      closePanel()
      onSeek(dayAtSameTime(viewedEpoch, dayEpoch, nowMs), 'timeline')
    },
    [closePanel, onSeek, viewedEpoch, nowMs],
  )
  // The date panel's hour cells: an exact epoch, no same-time mapping.
  const handlePickTime = useCallback(
    (epochMs: number) => {
      closePanel()
      onSeek(epochMs, 'timeline')
    },
    [closePanel, onSeek],
  )
  const handleChangeMonth = useCallback((delta: number) => {
    setPickerAnchorMs((prev) => {
      const d = new Date(prev)
      return new Date(d.getFullYear(), d.getMonth() + delta, 1, 0, 0, 0, 0).getTime()
    })
  }, [])

  const activeEpoch = props.activeEpoch

  // ─── Tracks + clustering (VERTICAL timeline — extended window) ──────────
  // TRACK-shaped items (one per tracked object, id = bestEventId) so every card
  // thumbnail resolves against media the server actually stores.
  // Held until the picture is up — or until the fallback fires. These two are
  // the heaviest fetches on the screen and they shared the socket with the
  // WebRTC negotiation, so they were competing for the seconds that decide how
  // fast the stream appears.
  // Hidden chrome reads NOTHING. The two always-on reads (`useDeviceTracks`,
  // `useTimelineActivity`) and the coverage window below all hang off this, so
  // a grid page opened with the timeline off issues exactly the wire traffic it
  // issued before the timeline existed there — the property the phone's
  // exclusion is asserted through, at the surface that can now choose.
  const chromeHidden = props.chromeHidden === true
  const timelineReady = useTimelineDeferral(props.loading) && !chromeHidden
  // Read for the fault rule only: a dropped socket must not raise the timeline's
  // own "couldn't load" notice, because the root hub-status overlay already owns that
  // cause and can actually explain it.
  const { state: connectionState } = useConnection()

  // `zoneRect` rides the REQUEST now, not only the client-side filter below.
  // It decides the projection: with no zone drawn nothing on this screen reads
  // `positions[]`, so the rows come back `slim` — 374 KB for a busy camera's
  // day against the 7.9 MB that used to blow the cap deadline and paint an
  // empty timeline. With a zone drawn the server prefilters spatially, so the
  // per-position boxes the filter needs arrive for a bounded set of rows.
  // The class chips ride the REQUEST too. They used to narrow a day of rows
  // already on the phone; the zone had been moved server-side long before and
  // the classes were left behind. `filterDetectionsByClass` below stays the
  // exact rule — the server only stops shipping what cannot match.
  const serverClasses = useMemo(
    () => expandSelectionToServerClasses(classFilter, classToMacro),
    [classFilter, classToMacro],
  )
  const tracksQuery = useDeviceTracks(
    scopeIds,
    timelineFromMs,
    dayWindow.to,
    timelineReady,
    zoneRect,
    { pollLive: props.mode === 'live', classes: serverClasses },
  )
  const deviceTracks = tracksQuery.data ?? EMPTY_TRACKS
  // An unread day and a quiet camera used to be the same picture. `listTracks`
  // now REJECTS when it cannot answer (it used to record a success with no
  // rows), so there is finally an error to report. What reports it is the ONE
  // fault notice composed further down — see `faultSignals`.
  //
  // Depends on `refetch`, not on the query object: React Query keeps `refetch`
  // stable while the result object is a new identity every render, so the
  // wider dep would remint this callback continuously.
  const refetchTracks = tracksQuery.refetch

  // Every loaded track. The global minimum-importance filter that used to sit
  // here was retired with the Settings → Events section on 2026-08-18: the
  // timeline shows what the window holds, and the class / motion / audio chips
  // below are the filters that remain.
  const objectEvents = deviceTracks

  // Distinct detection classes present in the LOADED window — feeds the filter
  // panel's data-driven class chips, collapsed to their taxonomy macro (A.1).
  const availableClasses = useMemo(() => {
    const set = new Set<string>()
    for (const e of objectEvents) {
      if (e.className.length > 0) set.add(e.className)
    }
    return [...collapseToMacro([...set], classToMacro)].sort()
  }, [objectEvents, classToMacro])

  // Compose the client-side filters BEFORE clustering (so cluster positioning
  // stays correct): the drawn zone first, then the motion/audio chips + the
  // detection-class selection. This set feeds the cards AND the heatmap.
  const zoneFilteredEvents = useMemo(
    () => filterEventsByZone(objectEvents, zoneRect),
    [objectEvents, zoneRect],
  )
  const filteredEvents = useMemo(
    () => filterDetectionsByKind(zoneFilteredEvents, filter, classFilter, classToMacro),
    [zoneFilteredEvents, filter, classFilter, classToMacro],
  )

  // ─── Activity model (recording / motion / audio) — extended window ────
  // The STATUS rides along because clips mode is derived from this read's
  // `recording` ranges: an availability read still in flight drew the exact
  // picture of a camera that recorded nothing, and a failed one was reported
  // nowhere at all (the day-window coverage query below is a different read).
  const activityQuery = useTimelineActivity(
    scopeIds,
    timelineFromMs,
    dayWindow.to,
    timelineReady,
  )
  const activity = activityQuery.activity

  // Derived cluster card width from the measured body width × the user-tunable
  // fraction (density presets / Settings → Timeline stepper).
  const cardWidth = useMemo(
    () =>
      listWrapWidth > 0
        ? Math.min(
            listWrapWidth,
            Math.round(listWrapWidth * clusterSettings.cardWidthFraction * CARD_SCALE),
          )
        : 0,
    [listWrapWidth, clusterSettings.cardWidthFraction],
  )

  // The gallery panel's height (`clusterCardHeight`). This same height is the
  // clustering absorption window: a shorter card covers less time, so it holds
  // fewer events.
  const cardHeight = useMemo(() => clusterCardHeight(cardWidth, clipsMode), [cardWidth, clipsMode])

  const { sizePx, gapPx } = useMemo(() => {
    const size = Math.max(MIN_CLUSTER_HEIGHT_PX, cardHeight)
    return { sizePx: size, gapPx: (clusterSettings.gapPercent / 100) * size }
  }, [cardHeight, clusterSettings.gapPercent])

  // ─── The ONE cluster list ───────────────────────────────────────────────
  // Both modes draw THESE cards. Clips mode used to ask the hub a second,
  // independent question (`videoclips.listClips`, clustered server-side into
  // visits with its own gap constant and its own labels), so the same camera
  // showed one set of cards on the timeline and a different set under the
  // clapperboard — which is exactly what the operator reported. There is now a
  // single clusterer, and clips mode is a FILTER plus a re-layout of its output
  // (`clips-from-clusters.ts`), not a second source.
  const eventClusters = useMemo(
    () => clusterByZoom(filteredEvents, { topMs: layoutTopMs, zoomIndex, sizePx, gapPx }),
    [filteredEvents, layoutTopMs, zoomIndex, sizePx, gapPx],
  )

  // Clips = the clusters that have RECORDED FOOTAGE under them, confirmed
  // against the availability this screen already fetched for the coverage bar
  // and the heatmap (`useTimelineActivity` — same device, same window, no new
  // query), plus the footage no cluster explains.
  //
  // …UNLESS the operator pointed this camera at a source of its own. Then the
  // cards are that source's files, read from `videoclips.listClips` for ONE
  // provider, and the derived list is not built at all. Never both: the two
  // clusterers whose disagreement cost this app a deleted panel can only
  // disagree if they are on screen together, and one camera has one source
  // (*"Mai mischiate provider diversi"*, D569).
  const clipProviderPref = useCameraClipProvider(props.deviceId)
  const clips = useCameraClips({
    deviceId: props.deviceId,
    sinceMs: timelineFromMs,
    untilMs: dayWindow.to,
    ...(clipProviderPref.chosen !== undefined ? { chosenSourceId: clipProviderPref.chosen } : {}),
    enabled: clipsMode && clipProviderPref.hydrated,
  })
  const nativeMode = clips.choice.derivation === 'cap'
  // What the CHROME is, once the body is clips (`clips-surface.ts`). A body of
  // FILES has no time axis, so the playhead, the scrub and the transport are
  // not drawn: they are meaningless there, and an empty timeline still invites
  // a drag that would land on our recorder's footage instead.
  const clipsSurface = resolveClipsSurface({
    clipsMode,
    derivation: clips.choice.derivation,
    clipHeld: props.clipHeld ?? false,
  })

  const derivedClips = useMemo(
    () =>
      !clipsMode
        ? EMPTY_DERIVED_CLIPS
        : nativeMode
          ? nativeDerivedClips(clips.clips)
          : deriveClipsFromClusters({
              clusters: eventClusters,
              recording: activity.recording,
              deviceId: props.deviceId,
            }),
    [clipsMode, nativeMode, clips.clips, eventClusters, activity.recording, props.deviceId],
  )
  // Card id → the instant a tap on that card plays from. The card's TIME LABEL
  // reads it, so the label and the tap are one derivation instead of two ends
  // of the same cluster: the label used to be `anchorEvent.timestamp` (the
  // NEWEST subject) while the tap is `clip.startMs` (the OLDEST, clamped to
  // footage) — 128 s apart on camera 1438's 10:39 card, and clamped the other
  // way on the one below it. Empty in normal mode, where the tap seeks the
  // visible page and the page's own time is already the truth.
  const clipStarts = useMemo(() => clipStartByCardId(derivedClips), [derivedClips])

  // Card id → the instant its clip's footage ends — the card's END time reads
  // this, same derivation, same list, so start and end can never describe two
  // different clips.
  const clipEnds = useMemo(() => clipEndByCardId(derivedClips), [derivedClips])

  /**
   * Card id → the state of the clip that is RUNNING, at most one entry.
   *
   * > *"quando una clip gira, si deve evidenziare, e mostrarne il progresso
   * > sulla stessa"* — the operator, 2026-09-23.
   *
   * Two provenances reach the same shape (`clip-row-playback.ts`), and they
   * are asked in the order the frame resolves them:
   *
   *  - a FILE on the camera's frame owns it outright, and its progress is the
   *    file's own axis (D575) — `clipProgress.progress`, whose `fraction` is
   *    already `null` whenever the broker has not measured a length. That
   *    `null` travels as `unknown` and is DRAWN as unknown: a fill of 0 % on a
   *    clip whose duration was never measured is the failure D393 names.
   *  - otherwise a DERIVED clip is played by seeking our own footage, so its
   *    progress is the epoch playhead inside the card's own window.
   *
   * Absence is "not playing" and is decided entirely from state held here.
   */
  const clipPlaybacks = useMemo((): ReadonlyMap<string, ClipRowPlayback> => {
    const out = new Map<string, ClipRowPlayback>()
    if (!clipsMode) return out
    const heldId = props.clipOnFrameId ?? null
    for (const entry of derivedClips) {
      if (heldId !== null) {
        if (entry.clip.clipId !== heldId) continue
        out.set(
          cardIdForClip(entry),
          props.clipProgress === undefined
            ? UNKNOWN_CLIP_ROW_PLAYBACK
            : clipRowFromHeld(props.clipProgress.progress),
        )
        continue
      }
      if (activeClipId === null || entry.clip.clipId !== activeClipId) continue
      out.set(
        cardIdForClip(entry),
        clipRowFromEpoch({
          startMs: entry.clip.startMs,
          endMs: entry.clip.endMs,
          playheadMs: props.activeEpoch,
          // Optional on the row; absent is NOT in-progress (the catalog span
          // stands), which is what `resolveClipDuration` already assumes.
          inProgress: entry.clip.inProgress === true,
        }),
      )
    }
    return out
  }, [clipsMode, derivedClips, props.clipOnFrameId, props.clipProgress, activeClipId, props.activeEpoch])

  /**
   * The KEEP control in the magnifier's corner, per card.
   *
   * `resolveClipDownload` decides entirely off the row: a clip of our own
   * recording gets nothing (the timeline's export control owns those), a row
   * the provider refused is drawn disabled with its words, a clip whose every
   * copy is over the export bound is drawn disabled with OURS, and everything
   * else is offered. The press CREATES AN EXPORT (D558) — it is no longer a
   * fetch to this device.
   *
   * The press always opens the modal; with one distinct copy it lists that one.
   */
  const clipExport = useClipExport()
  /** The clip whose picker is open, with the copies to offer. */
  const [qualityPick, setQualityPick] = useState<ClipQualityPick | null>(null)
  /** The event whose download dialog is open (normal mode's card icon). */
  const [downloadEvent, setDownloadEvent] = useState<ObjectEvent | null>(null)
  const { data: cameraList } = useCameras()

  // Where the subject's `provider` and `sourceLabel` come from — the SAME read
  // the list itself came from, never a second lookup. `sourceLabel` is frozen
  // onto the record at creation, so a history row still names the source after
  // it is unbound.
  const clipProviderAddonId = clips.choice.addonId
  const clipSourceLabels = clips.sources
  const catalogWindow = useMemo(
    // Exactly the window `useCameraClips` asked for. It is not a range control
    // and never becomes one (D558 § 5.4.3): the record's boundaries come from
    // the catalog ROW, and this only says where to confirm the row.
    () => ({ sinceMs: timelineFromMs, untilMs: dayWindow.to }),
    [timelineFromMs, dayWindow.to],
  )

  const startClipExport = useCallback(
    (clip: Clip, profile: ClipProfile): void => {
      if (clipProviderAddonId === null) {
        // The provider pin is REQUIRED by the subject and by `listClips`; a
        // bare ask fans out over every source. A branch that drops the work
        // says so (D391).
        noteClipOpenStep('refused', {
          deviceId: clip.deviceId,
          clipId: clip.clipId,
          why: 'no provider resolved for export',
        })
        return
      }
      const row = clipSourceLabels.find((r) => r.sourceId === clip.sourceId)
      clipExport.start({
        clip,
        provider: clipProviderAddonId,
        // The source's own label, or its id — never an empty string, which the
        // subject's schema refuses.
        sourceLabel: row?.label ?? clip.sourceId,
        catalogWindow,
        profile,
      })
    },
    [clipExport, clipProviderAddonId, clipSourceLabels, catalogWindow],
  )

  const clipSaves = useMemo((): ReadonlyMap<string, ClipSaveBinding> => {
    const out = new Map<string, ClipSaveBinding>()
    if (!clipsMode) return out
    for (const entry of derivedClips) {
      const offer = resolveClipDownload(entry.clip)
      if (offer.kind === 'none') continue
      if (offer.kind === 'refused') {
        out.set(cardIdForClip(entry), { onSave: null, reason: offer.reason })
        continue
      }
      if (offer.kind === 'tooLarge') {
        // Our limit, so our words. The control stays drawn: a keep that cannot
        // happen must not look like a build without the feature (D62).
        out.set(cardIdForClip(entry), { onSave: null, reason: t('v2.clips.export.tooLarge') })
        continue
      }
      const quality = offer.quality
      out.set(cardIdForClip(entry), {
        // Always the modal, even with one copy: the press opens the same
        // dialog an event's download does, so a keep never starts silently.
        onSave: () => {
          setQualityPick({
            clip: entry.clip,
            options: quality.kind === 'choice' ? quality.options : [quality.option],
          })
        },
        reason: null,
        // Per CLIP, not per surface: two cards must not both spin because one
        // of them is being rendered.
        saving:
          clipExport.clipId === offer.clipId &&
          (clipExport.phase.kind === 'asked' || clipExport.phase.kind === 'working'),
      })
    }
    return out
  }, [clipsMode, derivedClips, clipExport, t])

  // The `Clip` view of the same list — what the compressed axis lays out and
  // what the advance sequencer walks.
  const cameraClips = useMemo(
    () => derivedClips.map((d) => d.clip),
    [derivedClips],
  )

  /**
   * WALK BACKWARDS BY ITSELF until a day has something in it.
   *
   * The window starts at one calendar day, and `lookback-walk.ts` says of
   * itself, in as many words: *"WHAT THIS WALK IS NOT: it is not data-driven.
   * Nothing here consults whether the day being walked into HAS any footage."*
   * It is armed by `onScrollBeginDrag` — a finger. So a camera whose current
   * day happens to be empty rendered "Nessuna clip per questa telecamera" and
   * stayed there, and the operator had to drag the list by hand to uncover 21
   * clips one day back (measured live 2026-09-22: `rows:0` at 04:52:37Z, then
   * 21 / 47 / 26 after three scrolls).
   *
   * One step per ANSWER, and `clips.answered` is what makes that safe: it goes
   * false the moment the window changes and true again only when the new
   * window has really come back, so this cannot run ahead of its own reads.
   * It walks only where the cards are FILES (`nativeMode`) and only while the
   * source says `ok` — a silent or missing source has already explained
   * itself, and widening the window would just ask it again.
   */
  const autoWalking =
    clipsMode && nativeMode && cameraClips.length === 0 && lookbackDays < MAX_AUTO_LOOKBACK_DAYS
  useEffect(() => {
    if (!autoWalking) return
    if (!clips.answered || clips.failed) return
    if (clips.choice.state !== 'ok') return
    setLookbackDays((d) => Math.min(MAX_AUTO_LOOKBACK_DAYS, d + 1))
  }, [autoWalking, clips.answered, clips.failed, clips.choice.state])

  // Publish the list the body is showing, so the frame can STEP through it.
  // The screen never re-derives it — one derivation, one answer.
  const onClipsChange = props.onClipsChange
  useEffect(() => {
    onClipsChange?.(cameraClips)
  }, [onClipsChange, cameraClips])

  const clipAxis = useMemo(
    () =>
      clipsMode
        ? buildClipAxis(cameraClips, {
            topMs: layoutTopMs,
            sizePx,
            gapPx,
            minGapMs: CLIP_AXIS_MIN_GAP_MS,
          })
        : null,
    [clipsMode, cameraClips, layoutTopMs, sizePx, gapPx],
  )

  const clusters = useMemo(() => {
    if (clipAxis !== null) return positionDerivedClips(clipAxis, derivedClips)
    return eventClusters
  }, [clipAxis, derivedClips, eventClusters])

  const epochMap = useMemo((): TimelineEpochMap | null => {
    if (clipAxis === null) return null
    return {
      epochToOffset: (epochMs) => clipAxisEpochToOffset(clipAxis, epochMs),
      offsetToEpoch: (offsetY) => clipAxisOffsetToEpoch(clipAxis, topMs, offsetY),
      contentSpanPx: clipAxis.contentSpanPx,
    }
  }, [clipAxis, topMs])

  const gapMarkers = useMemo(() => {
    if (clipAxis === null) return undefined
    return clipAxis.slots
      .filter(
        (s): s is Extract<typeof s, { kind: 'gap' }> =>
          s.kind === 'gap' && s.durationMs >= CLIP_AXIS_MIN_GAP_MS,
      )
      .map((s) => ({ topPx: s.topPx, heightPx: s.heightPx, durationMs: s.durationMs }))
  }, [clipAxis])

  // Clips-mode ruler: "discontinuous is fine as long as it is continuous
  // within one clip's interval" (operator). Regular hour ticks would lie on
  // this compressed axis — `clipAxisTicks` derives ticks PER CLIP from that
  // clip's own linear scale instead, and never inside a gap. Same target
  // spacing as the linear axis's own row grid, for a comparable ruler density.
  const clipTicks = useMemo(() => {
    if (clipAxis === null) return undefined
    return clipAxisTicks(clipAxis, { targetSpacingPx: TIMELINE_ROW_HEIGHT })
  }, [clipAxis])

  // ─── Cursor proximity (playhead → cluster) ──────────────────────────────
  // This is a subtle selection cue only; cluster geometry never scales. LIVE is excluded to avoid permanent
  // activation under the advancing edge.
  //
  // The map's identity is PINNED across renders (a ref cache, same rationale as
  // `scrollOffsetRef` above): the playhead reports many times a second during
  // playback, and the factors are quantised, so most reports change nothing —
  // re-minting the map each render would defeat the scroller's memo exactly the
  // way the 60Hz scroll-offset state once did.
  const expansionEpoch =
    props.mode === 'live' || props.activeEpoch === null
      ? null
      : props.activeEpoch
  const nextExpansion = useMemo(
    () => buildExpansionMap(clusters, expansionEpoch, zoomIndex),
    [clusters, expansionEpoch, zoomIndex],
  )
  const expansionRef = useRef<ClusterExpansionMap>(nextExpansion)
  if (!expansionMapsEqual(expansionRef.current, nextExpansion)) {
    expansionRef.current = nextExpansion
  }
  const expansionByCluster = expansionRef.current

  // DIAGNOSTIC: trace the cluster/activity pipeline so an "empty timeline" can be
  // localised to data (cap returned nothing) vs geometry (data arrived but the
  // window/measure dropped it).
  const lastClusterStateSigRef = useRef<string | null>(null)
  useEffect(() => {
    // The visible count is computed HERE, not on every render: it is only ever
    // read by this line, and sampling it when the DATA or the geometry changes
    // answers the question it exists for — "did the cap return nothing, or did
    // the window drop what arrived?" — without paying for it 60 times a second.
    const scrollOffsetY = scrollOffsetRef.current
    const visibleClusterCount = clusters.filter(
      (c) =>
        c.topPx >= scrollOffsetY - CLUSTER_WINDOW_MARGIN_PX - c.heightPx &&
        c.topPx <= scrollOffsetY + viewportHeight + CLUSTER_WINDOW_MARGIN_PX,
    ).length
    const clock = (ms: number): string => new Date(ms).toLocaleTimeString()
    const evTs = objectEvents.map((e) => e.timestamp)
    // The drawn zone DROPS items, so it must never be able to do so silently:
    // "the timeline went empty" and "the zone filter is hiding everything" look
    // identical on screen, and the frame it resolved is what tells them apart —
    // a frame that disagrees with the camera's real detection size means the
    // rect and the tracks are being compared in different spaces.
    const objectEventRange =
      evTs.length > 0 ? { first: clock(Math.min(...evTs)), last: clock(Math.max(...evTs)) } : null
    const zone =
      zoneRect === null
        ? null
        : {
            // `kind` matters here: a polygon and its bounding rect drop
            // different sets, and "the filter is too aggressive" reads the
            // same either way without it.
            kind: zoneRect.kind,
            points: zoneRect.kind === 'polygon' ? zoneRect.points.length : 4,
            kept: zoneFilteredEvents.length,
            dropped: objectEvents.length - zoneFilteredEvents.length,
            frame: resolveFrameSize(objectEvents),
          }
    const activityCounts = {
      recording: activity.recording.length,
      motion: activity.motion.length,
      audio: activity.audio.length,
    }
    // One line per change of the DATA (`cluster-render-state-signature`), not
    // per layout recompute: this is `info` and always shipped (D437).
    const sig = clusterRenderStateSignature({
      deviceId: props.deviceId,
      objectEvents: objectEvents.length,
      objectEventRange,
      zone,
      clusters: clusters.length,
      activity: activityCounts,
      dayWindow,
    })
    if (lastClusterStateSigRef.current === sig) return
    lastClusterStateSigRef.current = sig
    log.info('theater:clusters', 'render state', {
      deviceId: props.deviceId,
      objectEvents: objectEvents.length,
      objectEventRange,
      zone,
      clusters: clusters.length,
      visibleClusters: visibleClusterCount,
      activity: activityCounts,
      geometry: { cardWidth, viewportHeight, listWrapWidth, scrollOffsetY, sizePx, gapPx, zoomIndex },
      dayWindow,
    })
  }, [
    props.deviceId, objectEvents, clusters, zoneRect, zoneFilteredEvents,
    activity.recording.length, activity.motion.length, activity.audio.length,
    cardWidth, viewportHeight, listWrapWidth, sizePx, gapPx, zoomIndex, dayWindow,
  ])

  // Real recorded coverage for the day window (drives the heatmap backdrop +
  // bounds VOD seeks). Empty when no footage / not connected.
  const coverageQuery = useRecordingAvailability(
    scopeIds,
    dayWindow.from,
    dayWindow.to,
    !chromeHidden,
  )
  const coverage = coverageQuery.data?.ranges ?? EMPTY_COVERAGE
  // What the whole surface could not read: the union of the two always-on
  // reads. The date panel's month is deliberately NOT folded in — it has its
  // own `partial` state, inside the calendar, where the operator is looking
  // when it matters (the same rule that keeps its failure out of the fault
  // band).
  const scopeGaps = useMemo(
    (): ScopeNoticeInput => ({
      unknownIds: unionUnknownIds(
        coverageQuery.data?.unknownIds ?? EMPTY_IDS,
        activityQuery.activity.unknownIds,
      ),
      overflowIds: unionUnknownIds(
        coverageQuery.data?.overflowIds ?? EMPTY_IDS,
        activityQuery.activity.overflowIds,
      ),
    }),
    [
      coverageQuery.data?.unknownIds,
      coverageQuery.data?.overflowIds,
      activityQuery.activity.unknownIds,
      activityQuery.activity.overflowIds,
    ],
  )
  const refetchCoverage = coverageQuery.refetch
  const refetchActivity = activityQuery.refetch

  // ─── The ONE fault slot ─────────────────────────────────────────────────
  // Three things on this screen can fail to load, and until now they were
  // reported in two different grammars and one silence: the stream shouted from
  // inside the playback band, the events query floated a red-bordered card over
  // the scroller, and a failed coverage read drew the exact picture of a camera
  // with no footage. They are reduced HERE, by one pure rule, into one ordered
  // list that one component renders.
  const {
    failed: streamFailed,
    fetching: streamFetching,
    reason: streamReason,
    onRetry: onRetryStream,
  } = props.streamFault
  const faultSignals: TimelineFaultSignals = useMemo(
    () => ({
      stream: { failed: streamFailed, fetching: streamFetching, reason: streamReason },
      // BOTH availability reads. `timeline-faults.ts` says in its own words
      // that a clips-mode failure is already reported "as `recordings`" — it
      // was not: this signal only ever carried the day-window coverage query,
      // while the cards (and the clip list) come from the activity bundle's
      // `getAvailability` over the extended window. One of the two failing left
      // the other's silence to speak for it.
      recordings: {
        failed: coverageQuery.isError || activityQuery.failed,
        fetching: coverageQuery.isFetching || activityQuery.fetching,
        reason: null,
      },
      events: {
        failed: tracksQuery.isError,
        fetching: tracksQuery.isFetching,
        reason: null,
      },
    }),
    [
      streamFailed, streamFetching, streamReason,
      coverageQuery.isError, coverageQuery.isFetching,
      activityQuery.failed, activityQuery.fetching,
      tracksQuery.isError, tracksQuery.isFetching,
    ],
  )

  // A dismissal is "I have read this one", not "never tell me again": it is
  // dropped the moment its source recovers, so the NEXT failure speaks up.
  const [dismissedFaults, setDismissedFaults] = useState<readonly FaultSource[]>([])
  const failedSources = useMemo(() => activeFaultSources(faultSignals), [faultSignals])
  useEffect(() => {
    // `pruneDismissals` returns the SAME array when nothing changed, so this
    // settles in one pass instead of looping.
    setDismissedFaults((prev) => pruneDismissals(prev, failedSources))
  }, [failedSources])

  const faults = useMemo(
    () =>
      resolveTimelineFaults({
        connected: connectionState === 'connected',
        sources: faultSignals,
        dismissed: dismissedFaults,
      }),
    [connectionState, faultSignals, dismissedFaults],
  )

  // The date picker's own fault, kept OUT of the notice above on purpose: that
  // notice is docked under the playback bar, and while the date panel owns the
  // body the operator is looking at the calendar. A report about the calendar
  // belongs in the calendar. Same rule, one screen further in.
  const recordingDaysStatus = resolveRecordingDaysStatus({
    connected: connectionState === 'connected',
    failed: recordingDaysQuery.isError,
    fetching: recordingDaysQuery.isFetching,
    // The multi-camera month: the call worked, some cameras did not answer, and
    // the dots below are the union of the ones that did.
    unknownCameras: recordingDaysQuery.data?.unknownIds.length ?? 0,
  })
  const retryFault = useCallback(
    (source: FaultSource): void => {
      if (source === 'stream') {
        onRetryStream()
        return
      }
      // Real refetches, not a state reset that changes nothing. BOTH
      // availability reads, because either of them can be the one that failed.
      if (source === 'recordings') {
        void refetchCoverage()
        refetchActivity()
        return
      }
      void refetchTracks()
    },
    [onRetryStream, refetchCoverage, refetchActivity, refetchTracks],
  )
  const dismissFault = useCallback((source: FaultSource): void => {
    setDismissedFaults((prev) => (prev.includes(source) ? prev : [...prev, source]))
  }, [])

  // The heatmap + scrub geometry span the FULL day window, NOT the recorded
  // span — so midnight is always the left edge. Coverage draws as bands within.
  const cursorFraction = useMemo(() => {
    const epoch = props.activeEpoch
    if (epoch === null) return heatmapCursorFraction(nowMs)
    // SAME mapping the tap-seek inverts (see `fractionToEpoch`) so a tap at f and
    // the cursor for the resulting epoch land on the exact same pixel.
    return epochToDayFraction(epoch, dayWindow.from, dayWindow.to)
  }, [props.activeEpoch, dayWindow, nowMs])

  // ─── Scroll ⇄ playback plumbing ─────────────────────────────────────────
  // Press feedback for the vertical timeline's scrub is wired HERE rather than
  // inside `use-timeline-scrub`, and that placement is load-bearing: that module
  // is deliberately react-native-free so its gesture reducer unit-tests under
  // the node vitest environment (`scrub-release.spec.ts`), and the haptics
  // policy reaches both the settings store and `Platform` — importing it there
  // drags react-native into a graph that must not have it, which is exactly how
  // that suite broke the first time this was attempted.
  //
  // Only the two DISCRETE moments of a gesture answer: it grabbed, and it
  // landed. Never `onScrubMove`, which fires every scroll frame.
  const rawScrubBegin = props.onScrubBegin
  const rawScrubCommit = props.onScrubCommit
  const rawGoLive = props.onGoLive
  // The DETENT: one tick per cluster the cursor crosses while scrubbing, like
  // an iOS picker notch. Everything that makes this safe on a per-frame handler
  // lives in `scrub-detent.ts` — it is edge-triggered on the cluster identity
  // and rate-limited, so a slow drag over one fat cluster ticks once and a fast
  // flick cannot machine-gun.
  //
  // Clusters and zoom are read through REFS, not closed over: they change with
  // the data and the zoom, and re-minting `onScrubMove` on every such change
  // would churn the identity that `useTimelineScrub` (and the scroller's memo)
  // deliberately keeps stable.
  const detentRef = useRef<DetentState>(DETENT_INITIAL)
  // The detent is SILENT while a selection is armed, and the ref is how the
  // per-frame handler learns that without being re-minted.
  //
  // The pulse means "the cursor just crossed an event", which is what an
  // operator hunting for something needs. Drawing an export range is the other
  // task: the ends are two INSTANTS, and the events between them are exactly
  // what the operator is including rather than looking for. The floor between
  // pulses is 80 ms (`DETENT_MIN_INTERVAL_MS`), so over a dense hour a drag can
  // fire one every 80 ms — 12.5 a second, ~25 across a two-second drag — and
  // that is the "vibration at every micro-step" the operator reported. The
  // right number here is not a higher floor but zero: none of those pulses
  // answers a question that is being asked. It also takes the per-frame
  // `nearestClusterId` scan off the drag, which walks every cluster of the day.
  //
  // The two DISCRETE taps (grab, release) stay: one per gesture each, and they
  // are the feedback that the surface heard the finger at all.
  const selectionArmed = props.exportSelection?.anchorMs != null
  const selectingRef = useRef(selectionArmed)
  const clustersRef = useRef<readonly PositionedCluster[]>(clusters)
  const zoomIndexRef = useRef<number>(zoomIndex)
  const zoomModeRef = useRef<TimelineZoomMode>(zoomMode)
  // Synced in an EFFECT, never during render (`react-hooks/refs`). A frame of
  // staleness is harmless: neither clusters nor zoom change while a finger is
  // down on the timeline.
  useEffect(() => { selectingRef.current = selectionArmed }, [selectionArmed])
  useEffect(() => { clustersRef.current = clusters }, [clusters])
  useEffect(() => { zoomIndexRef.current = zoomIndex }, [zoomIndex])
  useEffect(() => { zoomModeRef.current = zoomMode }, [zoomMode])
  const rawScrubMove = props.onScrubMove
  const scrubMoveFelt = useCallback(
    (
      epochMs: number,
      source: ScrubSource,
      hint?: { readonly mode: 'fine' | 'coarse'; readonly velocityPxPerS: number },
    ): void => {
      lastScrubEpochRef.current = epochMs
      // Auto zoom reads the same velocity stream as fine/coarse (touch AND web
      // wheel/trackpad — use-timeline-scrub emits the hint on every sample).
      if (zoomModeRef.current === 'auto' && hint && source === 'timeline') {
        const next = mapAutoZoomSample(
          autoZoomRef.current,
          hint.velocityPxPerS,
          Date.now(),
        )
        autoZoomRef.current = next
        if (next.zoomIndex !== zoomIndexRef.current) {
          setZoomIndex(clampZoomIndex(next.zoomIndex))
        }
      }
      const decision = resolveDetent(
        detentRef.current,
        detentKeyWhileScrubbing(selectingRef.current, () =>
          nearestClusterId(clustersRef.current, epochMs, zoomIndexRef.current),
        ),
        Date.now(),
      )
      detentRef.current = decision.state
      if (decision.tick) hapticDetent()
      rawScrubMove(epochMs, source, hint)
    },
    [rawScrubMove],
  )
  const scrubBeginFelt = useCallback(
    (source: ScrubSource): void => {
      hapticTap()
      // Start the gesture with a clean slate, but SEED the rate-limit window
      // with this moment: the grab already buzzed, and the first frame usually
      // lands on whatever was under the finger — without the seed that would
      // fire a detent immediately on top of the grab tap.
      detentRef.current = { key: null, lastTickMs: Date.now() }
      if (zoomModeRef.current === 'auto') {
        autoZoomRef.current = beginAutoZoom(zoomIndexRef.current, Date.now())
      }
      rawScrubBegin(source)
    },
    [rawScrubBegin],
  )
  const scrubCommitFelt = useCallback(
    (epochMs: number, source: ScrubSource): void => { hapticTap(); rawScrubCommit(epochMs, source) },
    [rawScrubCommit],
  )
  // The live-edge SNAP: the same release, different outcome. Fired once per
  // gesture end by the hook's `goLive` command — not by the toolbar's Go-live
  // button, which owns its own feedback and reaches `props.onGoLive` directly.
  const goLiveFelt = useCallback(
    (): void => { hapticTap(); rawGoLive() },
    [rawGoLive],
  )
  // The three no-ops, memoised: `useTimelineScrub` keeps their identity and a
  // fresh arrow per render would churn it. Each counts, because a gesture that
  // is deliberately dropped and one that is lost look identical otherwise.
  const refuseScrub = useCallback((): void => {
    noteTimelineInputIgnored('scrubBegin')
  }, [])
  const refuseScrubMove = useCallback((): void => {
    noteTimelineInputIgnored('scrubMove')
  }, [])
  const refuseScrubCommit = useCallback((): void => {
    noteTimelineInputIgnored('scrubCommit')
  }, [])
  /**
   * The FOURTH refusal: the live-edge snap, while a file holds the frame.
   *
   * > *"l'hook dello scroll, anche verso il live, non deve fare alcuna
   * > azione"* — the operator, 2026-09-23.
   *
   * The snap is the one command the gesture could still issue on this surface
   * after `scrub` was refused at the source — and it is the most destructive
   * of the four, because go-live is what LEAVES a clip (D570). The clips list
   * is short, its top is one flick away, and a release there took the picture
   * off the file the operator was watching. Counted like the others: a gesture
   * deliberately dropped and one silently lost look identical otherwise.
   */
  const refuseGoLive = useCallback((): void => {
    noteTimelineInputIgnored('goLiveOnClip')
  }, [])

  const scrub = useTimelineScrub({
    deviceId: props.deviceId,
    topMs,
    zoomIndex,
    isLive,
    selectionArmed,
    indicatorPx,
    viewportHeight,
    timelineFromMs,
    lookbackDays,
    maxLookbackDays: MAX_LOOKBACK_DAYS,
    // The surface's own verdict, obeyed at the SOURCE: when it says there is
    // no scrub here, the drag still scrolls the list — that is how the clips
    // are browsed — and simply never reaches the player. It used to be
    // computed and then read for one field out of five, so a body of FILES
    // drew no time axis and went on seeking anyway (2026-09-21).
    onScrubBegin: clipsSurface.scrub ? scrubBeginFelt : refuseScrub,
    onScrubMove: clipsSurface.scrub ? scrubMoveFelt : refuseScrubMove,
    onScrubCommit: clipsSurface.scrub ? scrubCommitFelt : refuseScrubCommit,
    // Refused outright while a FILE is on the frame — see `refuseGoLive`.
    onGoLive: clipsSurface.axis === 'clip' ? refuseGoLive : goLiveFelt,
    onScrollOffset: setScrollOffsetY,
    onExtendLookback: extendLookback,
    epochMap,
  })

  const scrollListTo = scrub.scrollListTo
  const onGoLive = props.onGoLive

  // Keep the scrub/playhead epoch under the indicator when the range ladder
  // moves (Auto or a manual pick). Without this the new pxPerHour leaves the
  // same scroll offset pointing at a different moment.
  const prevZoomForScrollRef = useRef(zoomIndex)
  useEffect(() => {
    if (prevZoomForScrollRef.current === zoomIndex) return
    prevZoomForScrollRef.current = zoomIndex
    const epoch = lastScrubEpochRef.current ?? props.activeEpoch ?? topMs
    scrollListTo(mappedEpochToOffset(epoch, topMs, zoomIndex, epochMap), false)
  }, [zoomIndex, topMs, epochMap, scrollListTo, props.activeEpoch])

  // ─── "si centri per mostrarla in mezzo" ─────────────────────────────────
  //
  // > *"vorrei che al click su una clip la timeline si centri per mostrarla in
  // > mezzo"* — the operator, 2026-09-23.
  //
  // ONE deliberate move, at the tap, and nothing afterwards. The rule and the
  // geometry it is derived from are `timeline-card-centering.ts`; this is the
  // dispatch, and it goes through `scrollListTo` for a reason that is the
  // whole point of the file arm: it moves the LIST without touching the
  // playback pointer. A file clip leaves `activeClipId` null and detaches the
  // machine (D570), so an `onSeek` here would seek the recorded session behind
  // the picture — the defect `clip-tap.ts` exists to prevent.
  //
  // `tapPlacementRef` is what makes the move survive on the SEEK arm: see the
  // follower below.
  const tapPlacementRef = useRef<TapPlacement | null>(null)
  const cursorDrawn = clipsSurface.playhead
  const centreTappedCard = useCallback(
    (cluster: PositionedCluster): void => {
      const offset = cardCenterScrollOffsetPx({
        cardTopPx: cluster.topPx,
        cardHeightPx: cluster.heightPx,
        indicatorOffsetPx: indicatorPx,
        viewportHeightPx: viewportHeight,
        // The ONE authority on whether there is a mark on the glass (D606) —
        // a body of files draws none, so "in mezzo" is the viewport's middle.
        cursorDrawn,
      })
      // `null` = an unmeasured body. Do nothing rather than scroll to a
      // position derived from a measurement that does not exist (D393).
      if (offset === null) return
      scrollListTo(offset, true)
    },
    [indicatorPx, viewportHeight, cursorDrawn, scrollListTo],
  )

  const handleGoToLive = useCallback(() => {
    tapPlacementRef.current = null
    scrollListTo(0, true)
    onGoLive() // remount the player back to the live edge (not just scroll)
  }, [onGoLive, scrollListTo])

  // ─── Auto-follow: the machine moved the position (playback advancing / a seek
  // landed) → scroll to it. Only during 'playback' — while 'seeking' the USER
  // drives the list, and while 'live' offset 0 already tracks the advancing edge.
  const mode = props.mode
  useEffect(() => {
    if (mode !== 'playback') return
    if (activeEpoch === null) return
    // …unless a tap has just PLACED the list and the playhead is still inside
    // the clip that tap asked for. The follower's target is the epoch's
    // offset, which for a clip's start IS the card's bottom edge — so without
    // this the centring above would be undone on the first position report
    // and read as a bounce, not a move. The hold is bounded by the clip's own
    // window (`holdsTapPlacement`): the moment playback runs past it the
    // sequencer, not the operator, chose what is on screen, and the follower
    // takes the list back — which is what brings the next card into view.
    if (holdsTapPlacement(tapPlacementRef.current, activeEpoch)) return
    tapPlacementRef.current = null
    scrollListTo(mappedEpochToOffset(activeEpoch, topMs, zoomIndex, epochMap), false)
  }, [mode, activeEpoch, topMs, zoomIndex, scrollListTo, epochMap])

  // ─── A held CLIP gets no follow, and its scroll commands nothing ────────
  //
  // > *"Rimuoviamo decisamente il cursore per la modalità clip e l'hook dello
  // > scroll, anche verso il live, non deve fare alcuna azione"* — the
  // > operator, 2026-09-23, after a day of it on his phone.
  //
  // There WAS a second follower here (`clip-follow.ts`, deleted with this
  // note): while a native file held the frame the list scrolled itself so the
  // running clip's instant sat on the cursor, a finger broke the hook, and the
  // cursor pill offered it back. It worked as designed and the design was
  // wrong — a follow that moves the list while the operator is reading it
  // fights the one gesture the surface is for, which is finding the NEXT clip.
  //
  // So on this surface the list is inert in both directions: nothing scrolls
  // it but the finger, and the finger commands nothing. The scrub was already
  // refused at the source (`clipsSurface.scrub`); the live-edge SNAP is
  // refused with it just below — scrolling to the top of a clip list must not
  // remount the player onto the live stream, which is the "anche verso il
  // live" half of the verdict.
  //
  // The effect ABOVE is untouched: a DERIVED clip is played by seeking our own
  // footage, so it is the machine's `playback` follower on the epoch axis, and
  // there a drag really is a seek.

  // ─── Changing AXIS re-anchors the list on the current position ───────────
  //
  // The linear day and the compressed clips axis share no geometry: an offset
  // that reads 14:07 on one is the oldest clip on the other, and the compressed
  // axis is a few hundred px where the linear one is thousands. The surviving
  // scroll offset is therefore CLAMPED by the ScrollView the instant the axis
  // changes, which emits a scroll event that `use-timeline-scrub` cannot tell
  // from a finger — so it began a scrub and committed a seek. Tapping the
  // clapperboard while watching 14:07 threw the player onto last night's oldest
  // clip; leaving clips mode threw it somewhere else again.
  //
  // `scrollListTo` marks the scroll as OURS, and that is the point: the clamp
  // that follows is then not read as a scrub. Triggered on the AXIS, not on the
  // mode flag — the axis is null until the first clip is derived, so a list
  // that arrives after the toggle changes the geometry a second time.
  const compressedAxis = epochMap !== null
  const compressedAxisRef = useRef(compressedAxis)
  useEffect(() => {
    if (compressedAxisRef.current === compressedAxis) return
    compressedAxisRef.current = compressedAxis
    // The axis a tap placed the list on no longer exists; its offsets mean
    // nothing here.
    tapPlacementRef.current = null
    scrollListTo(mappedEpochToOffset(activeEpoch ?? topMs, topMs, zoomIndex, epochMap), false)
  }, [compressedAxis, activeEpoch, topMs, zoomIndex, epochMap, scrollListTo])

  // Tap a cluster card → seek to it. The machine arms the seek anchor, so the
  // feeder's snap-to-nearest-footage report only moves the playhead if it lands
  // within tolerance. The auto-follow effect scrolls the list to the tapped epoch.
  // A card, carousel page, or fan item always hands us the visible event AND
  // the card it came from.
  //
  // In CLIPS MODE the card is a clip, and a tap means "play this visit from the
  // start": the sequencer that chains one clip into the next keys off the CLIP
  // id and a playhead INSIDE that clip's window, and it was being handed an
  // EVENT id — `resolveClipAdvance` looked it up in the clip list, found
  // nothing, and returned `hold` for the rest of the session. So clips mode
  // played exactly one clip and then ran on into the dead air it exists to
  // skip. The seek target is the clip's own start for the same reason: a
  // footage-only card's anchor is the mid-visit instant a still can be decoded
  // from, which is no place to begin watching.
  //
  // The derived list is read through a REF: it is re-derived on the live-edge
  // tick, and closing over it would re-mint this callback (and defeat the
  // scroller's memo) every second. Same rationale as `clustersRef` below.
  const onOpenClipInFrame = props.onOpenClipInFrame
  const derivedClipsRef = useRef<readonly DerivedClip[]>(derivedClips)
  useEffect(() => { derivedClipsRef.current = derivedClips }, [derivedClips])
  /**
   * Hand a FILE to the camera's frame — the one dispatch, used by the card tap
   * and by the day strip's press.
   *
   * Extracted rather than duplicated because the two silent hops it guards
   * are the ones that already cost a session: an absent `onOpenClipInFrame`
   * and an unresolved provider both drop the whole chain, and both are logged
   * here once instead of at each caller.
   */
  const openFileInFrame = useCallback(
    (clip: Clip): void => {
      // The addon that listed this row. Null only while the sources are
      // unknown, and a clip cannot have been pressed before then.
      const owner = clips.choice.addonId
      if (owner === null) {
        noteClipOpenStep('refused', { deviceId: clip.deviceId, clipId: clip.clipId, why: 'no provider resolved' })
        return
      }
      if (onOpenClipInFrame === undefined) {
        noteClipOpenStep('refused', { deviceId: clip.deviceId, clipId: clip.clipId, why: 'no frame handler' })
        return
      }
      onOpenClipInFrame(clip, owner)
    },
    [clips.choice.addonId, onOpenClipInFrame],
  )

  const onClusterTrackSeek = useCallback(
    (event: ObjectEvent, cluster: PositionedCluster): void => {
      const clip = clipsMode ? clipForCardId(derivedClipsRef.current, cluster.id) : null
      if (clip !== null) {
        // What a clip tap DOES depends on where its bytes live, and that is one
        // decision in one place (`clip-tap.ts`): our own footage is a SEEK, a
        // file the camera wrote is a fetch and the app's file player. Seeking a
        // native clip's epoch would play whatever our recorder happened to hold
        // at that instant — a picture of the right moment from the wrong source.
        const tap = resolveClipTap(clip)
        // Before the branch, so neither arm can forget it: BOTH kinds of clip
        // bring their card to the middle, and the two arms differ only in what
        // they do with the PICTURE.
        centreTappedCard(cluster)
        noteClipOpenStep('tap', {
          deviceId: clip.deviceId,
          clipId: clip.clipId,
          // What the CARD was showing when it was pressed, beside what the
          // press resolved. The operator reported a card labelled ~16:00
          // opening something else; the label and the tap read one derivation
          // (`clipStarts`), so either they agree and the chrome around the
          // frame is what disagreed, or they do not and this line says so.
          cardStartMs: clipStarts.get(cluster.id) ?? null,
          clipStartMs: clip.startMs,
          tap: tap.kind,
          playback: clip.playback.kind,
          // The prop is OPTIONAL, and an absent one drops the whole chain
          // without a word — one of the two silent hops in it.
          hasHandler: onOpenClipInFrame !== undefined,
        })
        if (tap.kind === 'seek') {
          // The seek arm hands the axis to the playhead follower. This is what
          // tells it to leave the placement above alone until playback has run
          // past the clip the operator actually tapped.
          tapPlacementRef.current = { fromMs: clip.startMs, toMs: clip.endMs }
          setActiveClipId(clip.clipId)
          onSeek(tap.epochMs, 'cluster')
          return
        }
        // The sequencer advances by SEEKING, so it must not own a clip that is
        // a file; `activeClipId` stays null and the advance effect is off in
        // this mode. The file goes to the SCREEN, which owns the frame — the
        // clip plays in the camera's own player, and the playback machine is
        // detached for as long as it does (D570).
        // No follower to hold off: nothing seeks on this arm, so the scroll
        // above IS the placement and stays until the next gesture.
        tapPlacementRef.current = null
        setActiveClipId(null)
        openFileInFrame(clip)
        return
      }
      // The continuous timeline's own card. Unchanged, deliberately: there the
      // cursor IS the playhead, the follower owns the list, and a placement it
      // overrides on the next position report would be a bounce, not a move.
      // Land on the detection itself — the operator wants the moment.
      tapPlacementRef.current = null
      setActiveClipId(null)
      onSeek(memberSeekMs(event), 'cluster')
    },
    [clipsMode, onSeek, onOpenClipInFrame, openFileInFrame, clipStarts, centreTappedCard],
  )

  // Lens icon on a cluster card → hand the body to the detail panel (no seek).
  const openClusterDetail = panels.openCluster

  // "Go to this moment" inside the detail → seek, then give the body back.
  const onDetailSeek = useCallback((epochMs: number): void => {
    onSeek(eventMomentSeekMs(epochMs), 'cluster')
    closePanel()
  }, [onSeek, closePanel])

  // Clips MODE: keep the timeline chrome; compress the axis around visits.
  const openClips = toggleClips

  const clipAdvanceLayout = useMemo(
    () => (clipsMode ? { ...EMPTY_RIBBON, clips: normalizeClips(cameraClips) } : EMPTY_RIBBON),
    [clipsMode, cameraClips],
  )
  const onSeekForAdvance = props.onSeek
  useEffect(() => {
    if (!clipsMode) return
    // Two players, one sequencer: `resolveClipAdvance` advances by SEEKING, and
    // a native clip is a file played in a modal with nothing to seek into. An
    // advance across the two would throw the hero onto an unrelated moment
    // behind an open player. Auto-advance belongs to the recorded path alone
    // until a sequencer that can drive both exists.
    if (nativeMode) return
    // A seek that has not landed means the playhead below still belongs to
    // whatever was playing BEFORE it — a live epoch, when the tap came from
    // live. `resolveClipAdvance` is bounded now and would hold on that anyway,
    // but running the sequencer on a position no one has claimed yet is the
    // wrong question to ask twice: wait for the feeder's answer.
    if (props.seekAnchor !== null) return
    const decision = resolveClipAdvance({
      layout: clipAdvanceLayout,
      currentClipId: activeClipId,
      playheadMs: props.activeEpoch,
      endGuardMs: DEFAULT_END_GUARD_MS,
    })
    if (decision.kind === 'advance') {
      setActiveClipId(decision.clip.clipId)
      onSeekForAdvance(decision.clip.startMs, 'cluster')
    } else if (decision.kind === 'finished') {
      setActiveClipId(null)
    }
  }, [clipsMode, nativeMode, clipAdvanceLayout, activeClipId, props.activeEpoch, props.seekAnchor, onSeekForAdvance])

  // What the body says when clips mode has no cards to show. The read it waits
  // on is the TRACKS read — clips are derived from its clusters now, so "still
  // loading" and "could not be read" are that query's answers, and a failure is
  // reported once, as the `events` fault, instead of twice under two names.
  // `isLoading` and not `isFetching`: the hook refetches a live window every
  // 60s, and a quiet camera must not flicker between "no clips" and "loading"
  // once a minute.
  //
  // BOTH reads, not just the tracks one: a clip is a cluster WITH FOOTAGE under
  // it, so an availability bundle that has not landed yet produces an empty
  // list from a perfectly good track list — and the body said "no clips for
  // this camera" for as long as that took, then filled with cards.
  const clipsStatus = useMemo(
    () =>
      resolveClipsStatus({
        active: clipsMode,
        connected: connectionState === 'connected',
        // Which read answers depends on where the cards come from. A native
        // source's cards have nothing to do with our tracks or our footage, so
        // reporting the tracks query's state over them would be a load the
        // operator is not waiting for and a failure he cannot act on.
        loading: nativeMode
          ? clips.loading
          : tracksQuery.isLoading || activityQuery.loading,
        failed: nativeMode
          ? clips.failed
          : tracksQuery.isError || activityQuery.failed,
        clipCount: cameraClips.length,
        sourceState: clips.choice.state,
        chosenMissing: clips.choice.chosenMissing,
        // "Still looking" is not "nothing here". `empty` is a CLAIM about the
        // camera and only an exhausted walk licenses it — at which point the
        // sentence names the span it searched instead of "the loaded range".
        searching: autoWalking,
        searchedDays: lookbackDays,
        maxDays: MAX_AUTO_LOOKBACK_DAYS,
      }),
    [
      clipsMode, connectionState, nativeMode, clips.loading, clips.failed,
      clips.choice.state, clips.choice.chosenMissing,
      tracksQuery.isLoading, tracksQuery.isError,
      activityQuery.loading, activityQuery.failed,
      cameraClips.length, autoWalking, lookbackDays,
    ],
  )

  /**
   * The words the status sentence needs.
   *
   * `sourceSilent` and `sourceMissing` both carry `{{source}}`, and the note
   * rendered `t(key)` with no values — so the operator read the placeholder
   * itself on screen. The source's OWN reason travels verbatim beside it,
   * because a client that paraphrases a server's prose drifts the first time a
   * word changes (D563).
   */
  const clipsStatusValues = useMemo(
    () => ({
      days: lookbackDays,
      max: MAX_AUTO_LOOKBACK_DAYS,
      source: clips.choice.sourceId ?? '',
      fallback: clips.choice.addonId ?? '',
      reason: clips.choice.reason ?? '',
    }),
    [lookbackDays, clips.choice.sourceId, clips.choice.addonId, clips.choice.reason],
  )

  // The switcher's two exits both LEAVE this surface, so the panel closes with
  // them. Switching cameras re-routes and remounts the screen, but the ad-hoc
  // grid is a `push` — the detail screen stays mounted underneath, and without
  // this the switcher would still own the body on the way back.
  // Charge for the toolbar. Gated on the feature so a wired camera never asks,
  // and the battery cap's own events already invalidate this key — the reconcile
  // interval is the backstop, not the mechanism.

  // The scroller is `memo`ised, and a fresh object literal for this prop defeats
  // that on EVERY render of the parent — which, before the scroll-offset fix,
  // was sixty times a second. Memoised on its two numbers so the identity only
  // changes when the window actually does.
  const scrollerWindow = useMemo(
    () => ({ from: timelineFromMs, to: dayWindow.to }),
    [timelineFromMs, dayWindow.to],
  )

  // The camera panel's three callbacks, wrapped so confirming closes the body
  // first. Absent as a GROUP when the surface has nowhere to jump to — see
  // `TimelineCameraJumpBinding`; there is deliberately no partial form.
  const cameraJump = props.deviceBinding.cameraJump
  const switchCamera = cameraJump?.onSwitchCamera
  const openAdhocGrid = cameraJump?.onOpenAdhocGrid
  const cameraSelection = cameraJump?.cameraSelection
  const onSwitchCamera = useCallback(
    (id: number): void => {
      closePanel()
      switchCamera?.(id)
    },
    [closePanel, switchCamera],
  )
  const onOpenAdhocGrid = useCallback(
    (ids: readonly number[]): void => {
      closePanel()
      openAdhocGrid?.(ids)
    },
    [closePanel, openAdhocGrid],
  )
  const cameraJumpBinding = useMemo(
    () =>
      cameraSelection === undefined
        ? undefined
        : { onSwitchCamera, onOpenAdhocGrid, cameraSelection },
    [onSwitchCamera, onOpenAdhocGrid, cameraSelection],
  )

  // ZERO-COST availability: reuse the day-window coverage this surface already
  // fetched. Hide the seek action ONLY on an explicit 'absent'; a moment outside
  // the queried window (an older day) stays 'unknown' → visible. Never a
  // per-item availability call.
  const clusterSeekAvailable = useCallback(
    (cluster: PositionedCluster): boolean =>
      recordingKnownAt(
        coverage,
        dayWindow.from,
        dayWindow.to,
        cluster.representative.timestamp,
      ) !== 'absent',
    [coverage, dayWindow.from, dayWindow.to],
  )

  // The export selection, derived — never stored. Its two ends are the machine's
  // anchor and the SAME `activeEpoch` the indicator is drawn at, so the band on
  // the strip and the range that gets exported cannot disagree.
  const exportSelection = props.exportSelection
  const selectionView = useMemo(
    () =>
      describeExportSelection(
        exportSelection?.anchorMs ?? null,
        props.activeEpoch,
        coverage,
        dayWindow.from,
        dayWindow.to,
        // The live edge, from the SAME advancing wall-clock every other part of
        // this surface reads. A free end dragged (or tapped) past the now-line
        // is clamped here rather than carried into `createExport`.
        nowMs,
      ),
    [exportSelection?.anchorMs, props.activeEpoch, coverage, dayWindow.from, dayWindow.to, nowMs],
  )
  // The span for the lanes — the same range the heatmap band and the confirm
  // button read, so the three can never name different periods.
  const selectionKind = exportSelection?.kind ?? 'export'
  const laneSelection = useMemo<LaneSelection | null>(
    () =>
      selectionView.armed && selectionView.range !== null
        ? { startMs: selectionView.range.fromMs, endMs: selectionView.range.toMs, kind: selectionKind }
        : null,
    [selectionView.armed, selectionView.range, selectionKind],
  )
  /**
   * The ONE record binding the bar draws, resolved from the MODE by
   * `resolveRecordControl` — a rule that can be asserted, rather than a branch
   * inside a component nothing can mount. There is no separate arm chip beside
   * it: a second way to arm is a second thing that can disagree with this one.
   */
  const liveCapture = props.liveCapture
  // Delete is an admin act; the hub's CONFIRMED answer, unknown being false.
  const isAdmin = useIsAdmin()
  const recordBinding = useMemo(
    () =>
      resolveRecordControl(props.mode, liveCapture, exportSelection, selectionView, {
        isAdmin,
        ...(props.onSnapshot === undefined ? {} : { onSnapshot: props.onSnapshot }),
      }),
    [props.mode, liveCapture, exportSelection, selectionView, isAdmin, props.onSnapshot],
  )

  // Tap/scrub the heatmap → the EXACT pointed time over the day window. Natural
  // navigation: never snapped to the nearest recorded segment.
  const fractionToEpoch = useCallback(
    (fraction: number): number => dayFractionToEpoch(fraction, dayWindow.from, dayWindow.to),
    [dayWindow.from, dayWindow.to],
  )
  const onScrubBegin = props.onScrubBegin
  const onScrubMove = props.onScrubMove
  const onScrubCommit = props.onScrubCommit
  const handleSeekFraction = useCallback(
    (fraction: number): void => onSeek(fractionToEpoch(fraction), 'heatmap'),
    [fractionToEpoch, onSeek],
  )
  const handleScrubStart = useCallback((): void => onScrubBegin('heatmap'), [onScrubBegin])
  const handleScrubFraction = useCallback(
    (fraction: number): void => onScrubMove(fractionToEpoch(fraction), 'heatmap'),
    [fractionToEpoch, onScrubMove],
  )
  const handleScrubEndFraction = useCallback(
    (fraction: number): void => onScrubCommit(fractionToEpoch(fraction), 'heatmap'),
    [fractionToEpoch, onScrubCommit],
  )

  // ─── The day strip over a body of FILES ─────────────────────────────────
  //
  // Same strip, different target (`clip-pick.ts`). A press names an instant;
  // over a list of files the thing at that instant is a FILE, and seeking our
  // recorder to it would play the right moment from the wrong source — the
  // one decision `clip-tap.ts` exists to make once.
  const pickClips = clipsSurface.heatmap === 'pickClip'
  const stripClips = useMemo(
    () => (pickClips ? derivedClips.map((entry) => entry.clip) : EMPTY_STRIP_CLIPS),
    [pickClips, derivedClips],
  )
  // The strip's BANDS and its press resolve against the same list — see
  // `clip-pick.ts` for why they are one derivation and not two.
  const clipBands = useMemo(() => clipDayCoverage(stripClips), [stripClips])
  const handlePickFraction = useCallback(
    (fraction: number): void => {
      const clip = clipAtEpoch(stripClips, fractionToEpoch(fraction))
      if (clip === null) {
        // A strip with no playable file under it at all. Counted rather than
        // silent: "nothing happened" and "we dropped it" must not look alike.
        noteTimelineInputIgnored('heatmapPickNoClip')
        return
      }
      openFileInFrame(clip)
    },
    [stripClips, fractionToEpoch, openFileInFrame],
  )

  // Heatmap detections share the SAME filtered events as the vertical-timeline
  // clusters, projected onto the VIEWED day — so density, markers and clusters
  // always agree. The motion/audio chips gate them.
  const showDetections = filterAll || filter.has('motion')
  const showAudioActivity = filterAll || filter.has('audio')
  const dayDetections = useMemo(
    () => (showDetections ? filteredEvents : []),
    [showDetections, filteredEvents],
  )
  // The SAME composition the on-demand overlay's tape uses: a chip that is off
  // supplies no buckets, which `composeHeatmapBins` treats exactly as an empty
  // lane. The three lanes are not assembled twice in this app.
  const bins = useMemo(
    () =>
      composeHeatmapBins({
        dayStartMs: dayFrom,
        detections: dayDetections,
        motion: showDetections ? activity.motion : [],
        audio: showAudioActivity ? activity.audio : [],
        classToMacro,
      }),
    [dayDetections, dayFrom, showDetections, showAudioActivity, activity.audio, activity.motion, classToMacro, palette],
  )

  // The lanes the cursor actually meets at its time: only those get a dot.
  const laneHits = useMemo(
    () => lanesActiveAt(activity, props.activeEpoch ?? nowMs),
    [activity, props.activeEpoch, nowMs],
  )
  /**
   * WHAT the position cursor is reading.
   *
   * Two arms, both on the EPOCH axis (`timeline-cursor.ts`). A held FILE has
   * no arm here at all — the cursor is not drawn on that surface
   * (`clipsSurface.playhead`), so no clip position is fed in. A DERIVED clip
   * is the epoch arm as it always was: it is played by seeking our own
   * footage, so the cursor is already over it and saying something true.
   */
  const timelineCursor = useMemo(() => resolveTimelineCursor({ isLive }), [isLive])

  // ── The three pieces, built once and PLACED per layout ────────────────────
  // The toolbar and the body move between the column, the drawer and the rail.
  // The STREAM SLOT does not: it is always the child at index 1 of this
  // component's root, so the player's parent chain is identical in every
  // layout. See the `stream` prop for why that is the whole point.
  const shape: DetailLayoutMode = props.layoutMode ?? 'stack'
  // The narrow rail is the floor the screen itself uses; never a second literal.
  const railWidth = props.railWidth ?? TIMELINE_RAIL_WIDTH_NARROW
  // In `stack` the toolbar spans the window: there is no rail and no drawer to
  // measure against. `fill` and `wide` each have their own box and pass it.
  const { width: windowWidth } = useViewportSize()
  // The device's status for the toolbar — gated on the caps, so a wired camera never asks.
  const { data: battery = null } = useBattery(props.deviceId, props.deviceBinding.hasBattery)
  const { data: networkLink = null } = useNetworkLink(props.deviceId, props.deviceBinding.hasNetworkLink)

  const toolbarEl = (
      <TimelineToolbarInline
        onBack={props.onBack}
        hideBack={props.hideBack}
        deviceId={props.deviceId}
        battery={battery}
        networkLink={networkLink}
        dateLabel={(format) => dateLabel(dayFrom, nowMs, t, dateLocale, format)}
        onOpenDatePicker={handleOpenPicker}
        onPickCamera={canPickCamera ? toggleCamera : undefined}
        cameraPickerOpen={panel?.kind === 'cameraSwitcher'}
        // Every active chip is DERIVED from the one panel state. It cannot
        // light up for a panel that is not mounted, which is precisely what a
        // second `activePanel` union on the screen made possible.
        menuOpen={panel?.kind === 'viewOptions'}
        onToggleMenu={singleCamera ? toggleViewOptions : undefined}
        // Same gate, same reason: a bar over a wall has no single camera whose
        // devices these would be, so it supplies nothing and draws nothing.
        // Exactly the menu's shape: this body owns the panel, so the chip's
        // active state is DERIVED from the one panel union like every other
        // chip. Routing it to the wall's host is what left it unable to light.
        onOpenLinkedDevices={singleCamera ? toggleLinkedDevices : undefined}
        linkedDevicesOpen={panel?.kind === 'linkedDevices'}
        // PTZ went with the same 2026-09-02 removal and came back the same
        // way. Drawn only where the camera HAS the feature.
        onOpenPtz={
          singleCamera && (props.deviceBinding.hasPtz || props.deviceBinding.hasNavigation)
            ? togglePtz
            : undefined
        }
        ptzOpen={panel?.kind === 'ptz'}
        qualityOpen={qualityOpen}
        onToggleQuality={singleCamera ? toggleQuality : undefined}
        qualityLabel={
          singleCamera ? t(qualityLabelKey(singleCamera.streamBinding.quality)) : undefined
        }
        qualityOptions={qualityOptions}
        qualityValue={singleCamera?.streamBinding.quality}
        onSelectQuality={onSelectQuality}
      />
  )

  // A panel COVERS the timeline — it never replaces it. The timeline layer is
  // ALWAYS mounted, so the scroller's offset, the zoom, the measured viewport
  // and every decoded thumb survive opening (and closing) any panel — the old
  // panel-OR-timeline ternary threw all of that away on every cluster detail.
  // While covered the timeline is FROZEN (no reconciliation for a surface
  // nobody can see — the 1 s live-edge tick would otherwise keep re-laying-out
  // a hidden scroller) and takes no touches; the panel is an absolute overlay
  // whose host paints an opaque background, so nothing shows through.
  const panelOpen = body.kind === 'panel'
  const bodyEl = (
    <View
      // One marker per state: `react-native-web` compiles `display: none` into
      // an opaque class, so a mount test cannot read the chrome's visibility
      // off its style. See `mount-test-observability`.
      testID={TIMELINE_CHROME_TEST_ID[chromeHidden ? 'hidden' : 'shown']}
      style={[styles.bodyStack, chromeHidden ? styles.chromeHidden : null]}
    >
      <View style={styles.bodyLayer} pointerEvents={panelOpen ? 'none' : 'auto'}>
        <FreezeWhileCovered frozen={panelOpen || chromeHidden}>
        <TimelineView
          onBodyLayout={handleBodyLayout}
          scrollerRef={scrub.scrollerRef}
          playback={{
            // Over the video (the fill drawer) the bar is glass, not opaque.
            overlay: props.transparent === true || shape === 'fill',
            mode: props.mode,
            rate: props.playbackRate,
            paused: props.paused,
            servedTier: props.servedTier ?? null,
            loading: props.loading,
            // A BOOLEAN: the ring is a status on this control. The reason and
            // the retry belong to the fault notice under the band.
            faulted: streamFailed,
            scrubDirection: props.scrubDirection,
            onTogglePause: props.onTogglePlayPause,
            onJogBack: props.onJogBack,
            // From the SURFACE, not from the prop the surface was built from:
            // `axis === 'clip'` is the one statement that a FILE is on screen,
            // and the bar's jog pair reads it to mean prev/next clip. Two
            // places deriving "is a clip held" is how the bar and the timeline
            // came to disagree about it in the first place.
            clipHeld: clipsSurface.axis === 'clip',
            // Offered only where the surface says stepping is the verb. The
            // bar makes a control that does nothing unrepresentable, and
            // handing it a step callback on a surface that does not step is
            // exactly such a control.
            onClipPrev: clipsSurface.stepsClips ? (props.onClipPrev ?? null) : null,
            onClipNext: clipsSurface.stepsClips ? (props.onClipNext ?? null) : null,
            // The file's own track: the position the playhead claims on this
            // surface is measured on the CLIP axis, and this is the control
            // that draws it. Gated on the same statement as `clipHeld`.
            clipProgress: clipsSurface.axis === 'clip' ? props.clipProgress : undefined,
            // The loop switch, on the SAME statement: the bar draws it beside
            // that track and both mean "a file is on screen".
            clipLoop: clipsSurface.axis === 'clip' ? props.clipLoop : undefined,
            onJogForward: props.onJogForward,
            onStepFrame: props.onStepFrame,
            onSelectRate: props.onSelectRate,
            // NOT gated on `axis === 'clip'`: the speed menu is on screen
            // whether or not a file is, and a ladder that only narrowed once
            // a clip opened would offer 4× right up to the moment it stopped
            // working. See `TimelinePlaybackBarProps.clipControls`.
            ...(props.clipControls === undefined ? {} : { clipControls: props.clipControls }),
            onGoLive: handleGoToLive,
            // Every shape this timeline takes has a body under the bar that
            // can give up a row (portrait stack, wide rail, landscape drawer),
            // so a bar that cannot fit one row wraps rather than overlapping
            // or hiding the speed control (`playback-bar-fit.ts`).
            canWrap: true,
            liveLocked: props.liveLocked,
            onToggleLiveLock: props.onToggleLiveLock,
            record: recordBinding,
            // Hidden while a selection is armed: the bar then carries Save /
            // Delete and the jog, and a training collect beside them is a
            // second act on a frame the operator is no longer looking at.
            trainingCollect:
              trainingCollectVisible({
                isLive,
                paused: props.paused,
                selectionArmed: selectionView.armed,
              }) ? (
                <SendFrameToTrainingControl
                  appearance="bar"
                  deviceId={props.deviceId}
                  epochMs={props.activeEpoch ?? null}
                />
              ) : null,
          }}
          heatmap={{
            bins,
            cursorFraction,
            // Over a body of FILES the bands are the FILES — the recorder's
            // tape says nothing about them, and on 592 (records to the hub AND
            // holds 357 files on its card) it would draw our own footage under
            // a list of the camera's. One derivation with the press's target
            // (`clip-pick.ts`).
            coverage: pickClips ? clipBands : coverage,
            // Drawn only while a selection is armed: `selectionRange` is
            // non-null the moment an anchor exists, and a zero-width band is
            // dropped by the placer.
            selection:
              selectionView.armed && selectionView.range !== null
                ? { startMs: selectionView.range.fromMs, endMs: selectionView.range.toMs }
                : null,
            selectionKind,
            // The dashed rail: this union is drawn from fewer cameras than the
            // view holds, so its gaps are not necessarily gaps.
            unknownCameras: scopeGaps.unknownIds.length,
            dayStartMs: dayWindow.from,
            dayEndMs: dayWindow.to,
            // TAP and RELEASE both commit; over a list of files there is no
            // drag, because there is no continuum to preview along. The
            // release picks the file under the finger exactly as a tap does,
            // so a gesture that started never ends in nothing.
            onSeekFraction: pickClips ? handlePickFraction : handleSeekFraction,
            ...(pickClips
              ? { onScrubEnd: handlePickFraction }
              : {
                  onScrubStart: handleScrubStart,
                  onScrubFraction: handleScrubFraction,
                  onScrubEnd: handleScrubEndFraction,
                }),
          }}
          scroller={{
            // The DRAWN anchor — see `layoutTopMs`. Ticks and cards share it,
            // so they cannot disagree with each other; the scrub keeps real now.
            topMs: layoutTopMs,
            zoomIndex,
            contentTopInset: floatingToolsTopInset(),
            contentBottomInset: floatingToolsBottomInset(),
            // Extended (back-scroll) window so contentHeight + tick generation
            // reach further into the past; the heatmap stays single-day.
            dayWindow: scrollerWindow,
            clusters,
            activity,
            showMotionLane: showDetections,
            showAudioLane: showAudioActivity,
            // The selected span, tinted over the lanes (accent for an export,
            // danger for a delete). A fresh object per range change by design:
            // the lanes repaint as the free end moves, and at no other time.
            laneSelection: laneSelection,
            cardWidth,
            viewportHeight,
            indicatorOffsetPx: indicatorPx,
            cursorShiftPx,
            zoomScaleY,
            isLive,
            onScroll: scrub.onScroll,
            onScrollBeginDrag: scrub.onScrollBeginDrag,
            onScrollEndDrag: scrub.onScrollEndDrag,
            onMomentumScrollBegin: scrub.onMomentumScrollBegin,
            onMomentumScrollEnd: scrub.onMomentumScrollEnd,
            onClusterPress: onClusterTrackSeek,
            onClusterOpenDetail: clipsMode ? undefined : openClusterDetail,
            onClusterDownloadEvent: clipsMode ? undefined : setDownloadEvent,
            expansion: expansionByCluster,
            epochMap,
            gapMarkers,
            // Clips mode does not hide ticks: it draws its own, confined to
            // real clip intervals (`clipTicks`). `TimelineScroller` already
            // ignores the linear generator whenever `epochMap` is set, so
            // `hideHourTicks` here would only suppress the compressed ruler.
            axisTicks: clipTicks,
            hideActivity: clipsMode,
            enableClusterActions: !clipsMode,
            clipStartByCardId: clipStarts,
            clipEndByCardId: clipEnds,
            clipSaveByCardId: clipSaves,
            clipPlaybackByCardId: clipPlaybacks,
          }}
          faults={{ faults, onRetry: retryFault, onDismiss: dismissFault }}
          // `TRACKS_MAX_ROWS` no longer truncates in silence: this is where
          // that fact reaches the operator, and `loadMoreHistory` is the
          // on-demand continuation that replaced the raised-cap non-fix.
          history={{
            visible: tracksQuery.hasMoreHistory,
            loading: tracksQuery.isLoadingMoreHistory,
            onLoadMore: tracksQuery.loadMoreHistory,
          }}
          // The camera cut the held clip short. Its own row in the chrome
          // stack: not a fault (nothing failed to LOAD) and not retryable.
          clipIncomplete={props.clipIncomplete}
          scope={scopeGaps}
          clipsStatus={clipsStatus}
          clipsStatusValues={clipsStatusValues}
          // Three separate claims from the ONE verdict, because they are three
          // questions (`clips-surface.ts`, D606). The BAND addresses the frame's
          // occupant and is therefore always drawn; the POSITION LINE follows the
          // body's axis and is not; the DAY STRIP is withheld only where a press
          // would seek the session behind a held clip.
          dayStrip={clipsSurface.heatmap !== 'none'}
          transport={clipsSurface.transport}
          playhead={clipsSurface.playhead}
          indicator={{
            offsetPx: indicatorPx,
            shiftPx: cursorShiftPx,
            measured: viewportHeight > 0,
            cursor: timelineCursor,
            laneHits,
          }}
          tools={{
            zoomIndex,
            zoomMode,
            onZoomIndexChange: handleZoomIndexChange,
            onZoomModeChange: handleZoomModeChange,
            // Clips mode compresses the axis around visits — a wall-clock
            // range has no meaning there, so the control is inert, not hidden.
            // Auto is forced off with clipsMode (see effect above).
            zoomEnabled: !clipsMode,
            onFilter: toggleFilter,
            // The zone pill is a TOGGLE: idle → draw mode on the player; lit
            // (drawing OR a zone applied) → tap turns the whole flow off.
            onZoneFilter: zoneBinding
              ? zonePillAction(zoneBinding.drawing, zoneRect) === 'off'
                ? zoneBinding.onClearZone
                : zoneBinding.onRequestZoneDraw
              : undefined,
            onOpenClips: openClips,
            filterActive: activityFilter.filterActive,
            zoneActive: zoneRect !== null || zoneBinding?.drawing === true,
            clipsActive: clipsMode,
          }}
        />
        </FreezeWhileCovered>
      </View>
      {body.kind === 'panel' ? (
        <View style={styles.panelLayer}>
        <TimelineBodyPanel
          panel={body.panel}
          deviceId={props.deviceId}
          onClose={panels.close}
          filterBinding={{
            filter,
            onToggleKind: activityFilter.onToggleKind,
            classes: availableClasses,
            classFilter,
            onToggleClass: activityFilter.onToggleClass,
            onSetClasses: activityFilter.onSetClasses,
            onReset: activityFilter.onReset,
            eventKinds: activityFilter.eventKinds,
          }}
          dateBinding={{
            monthAnchorMs: pickerAnchorMs,
            selectedDayMs: dayFrom,
            daysSet: recordingDays ?? EMPTY_DAYS,
            daysStatus: recordingDaysStatus,
            nowMs,
            onChangeMonth: handleChangeMonth,
            onPick: handlePickDay,
            onPickTime: handlePickTime,
          }}
          clusterBinding={{
            onSeek: onDetailSeek,
            seekAvailable: clusterSeekAvailable,
          }}
          deviceBinding={{
            cameraName: props.name,
            hasPtz: props.deviceBinding.hasPtz,
            hasBattery: props.deviceBinding.hasBattery,
            hasNetworkLink: props.deviceBinding.hasNetworkLink,
            hasNavigation: props.deviceBinding.hasNavigation,
            cameraJump: cameraJumpBinding,
          }}
          singleCamera={singleCamera}
          // Supplied HERE, not by the screen: these are panel-to-panel
          // navigation inside this body, like the capture menu's export.
          managementBinding={{
            onOpenStorage: openStorage,
            onOpenEventStore: openEventStore,
            onOpenLegend: openLegend,
            onBackToViewOptions: backToViewOptions,
          }}
        />
        </View>
      ) : null}
    </View>
  )

  // `fill` must let the video through: the drawer supplies its own scrim, and
  // an opaque container here would paint over the picture it floats on.
  const transparent = props.transparent === true || shape === 'fill'

  return (
    <View
      testID={detailShapeTestId(shape)}
      style={[
        styles.container,
        shape === 'wide' ? styles.wideRow : null,
        { backgroundColor: transparent ? 'transparent' : colors.background },
      ]}
    >
      {/* index 0 — the toolbar, ONLY when it belongs above the picture. `null`
          still occupies the index, which is what keeps the slot below at a
          fixed position across a layout change.

          Wrapped so that HIDING it is a style change on a box that is always
          there: the toolbar keeps its instance and, more to the point, index 1
          below keeps its position, so the picture is never re-parented by a
          toggle. */}
      <View style={chromeHidden ? styles.chromeHidden : null}>
        {/* The provider is what makes the toolbar-density setting DO anything:
            the tokens every control sizes itself from come from it. `fill` and
            `wide` both wrapped their toolbar; `stack` — the ordinary portrait
            player, the one an operator actually looks at — did not, so the
            setting moved a number nothing read. */}
        {shape === 'stack' ? (
          <MeasuredTimelineScale availableWidth={windowWidth} density={toolbarDensity}>
            {toolbarEl}
          </MeasuredTimelineScale>
        ) : null}
      </View>

      {/* index 1 — THE STREAM SLOT. Always here, in every layout. The player is
          a child of this View and of nothing else; the layout is expressed by
          the slot's own style and by where the chrome goes, never by handing
          the player to a different parent. Re-parenting is a remount, and a
          remount renegotiates the WebRTC session — the defect this structure
          makes unrepresentable.

          The style is per-shape and never `null`: a styleless View has no
          height, and in `fill` its only child is absolutely positioned, so
          the slot measured 900x0 while the picture was sized by an animation
          instead of by the layout. See `stream-slot.ts`. */}
      <View style={streamSlotStyle(shape, chromeHidden)}>
        {props.stream ?? null}
        {props.belowStream ?? null}
      </View>

      {/* index 2 — the chrome. Free to change shape: the drawer CLIPS and
          SLIDES its children, which is exactly why the picture is not one. */}
      {shape === 'fill' ? (
        <LandscapeTimelineOverlay open={props.drawerExpanded === true} beside={props.drawerBeside === true}>
          {toolbarEl}
          {bodyEl}
        </LandscapeTimelineOverlay>
      ) : shape === 'wide' ? (
        /* The rail is 340–380pt — NARROWER than the 390pt phone the tokens are
           written against — so it is a compact container by the same rule the
           landscape drawer is one, and it needs the same provider. Without it
           every control in the rail rendered at full phone size and
           `resolveClusterBand` never saw `compact`, so the cards kept their
           60% fraction of an already-narrow body and left a strip of
           background down each side: the "wasted column" the drawer's own
           rule exists to remove, at a second site nobody wired. */
        <View
          style={[
            styles.wideRail,
            { width: railWidth },
            chromeHidden ? styles.chromeHidden : null,
          ]}
        >
          <MeasuredTimelineScale availableWidth={railWidth} density={toolbarDensity} fill>
            {toolbarEl}
            {bodyEl}
          </MeasuredTimelineScale>
        </View>
      ) : (
        bodyEl
      )}

      {/* No clip player here. A clip plays in the camera's OWN frame, which is
          the SCREEN's (`ClipStageView` inside `streamBox`) — a sheet on top of
          the picture left a WebRTC session running behind something nobody
          could see through (D570). */}

      {/* The KEEP picker. It is a modal and not a sheet on the picture for the
          same reason as above — it covers the whole surface for one decision
          and then goes. Mounted only while a clip has been picked, so the list
          behind it carries no cost when nothing is being kept.

          Closing it abandons the WATCH and never the job: an export outlives
          this screen and is collected from the Library. */}
      {/* The event's download dialog — the card's icon opens it for the
          selected thumbnail's event. Mounted only while open, so the media and
          export hooks it holds cost nothing on a closed timeline. */}
      {downloadEvent !== null ? (
        <EventDownloadModal
          event={downloadEvent}
          cameraName={
            downloadEvent.deviceId === props.deviceId
              ? props.name
              : (cameraList?.find((c) => c.id === downloadEvent.deviceId)?.name ?? props.name)
          }
          coverage={coverage}
          windowFromMs={dayWindow.from}
          windowToMs={dayWindow.to}
          onClose={() => setDownloadEvent(null)}
        />
      ) : null}

      {qualityPick !== null ? (
        <ClipExportModal
          visible
          options={qualityPick.options}
          phase={clipExport.clipId === qualityPick.clip.clipId ? clipExport.phase : IDLE_CLIP_EXPORT}
          onPick={(profile) => startClipExport(qualityPick.clip, profile)}
          onClose={() => {
            setQualityPick(null)
            clipExport.reset()
          }}
        />
      ) : null}
    </View>
  )
})

/**
 * The timeline's chrome, and whether it is drawn — one id per state.
 *
 * A marker rather than a style read: `react-native-web` compiles
 * `display: none` into a class name jsdom cannot interpret, and the chrome is
 * MOUNTED in both states, so counting nodes cannot tell them apart either.
 */
export const TIMELINE_CHROME_TEST_ID: Readonly<Record<'shown' | 'hidden', string>> = {
  shown: 'timeline-chrome',
  hidden: 'timeline-chrome-hidden',
}

/** Stable empty list, so a query with no data yet does not remint one every
 *  render and re-run every memo that reads the tracks. */
const EMPTY_TRACKS: ObjectEvent[] = []
const EMPTY_DERIVED_CLIPS: readonly DerivedClip[] = []
/** Stable identity for the day strip's list when the strip is not picking
 *  files — a fresh `[]` per render would churn every memo below it. */
const EMPTY_STRIP_CLIPS: readonly Clip[] = []

/** Stable empty coverage, for the same reason — it feeds the heatmap's memos. */
const EMPTY_COVERAGE: readonly TimeRange[] = []

/** Stable empty list — a fresh literal would remint `scopeGaps` every render. */
const EMPTY_IDS: readonly number[] = []

/** Stable empty set, so the date binding does not remint one every render. */
const EMPTY_DAYS: ReadonlySet<number> = new Set<number>()

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  /** The body is a STACK: the always-mounted timeline underneath, a panel
   *  overlay (opaque host) on top when one is open. */
  bodyStack: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  bodyLayer: {
    flex: 1,
    minHeight: 0,
  },
  panelLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  /** `wide` lays the picture and the rail side by side. */
  wideRow: {
    flexDirection: 'row',
    minHeight: 0,
  },
  wideRail: {
    minHeight: 0,
  },
  /** The chrome, OFF. `display: 'none'` and not a zero height: the subtree must
   *  take no space AND no touches, while its instance — scroll offset, zoom,
   *  measured viewport — stays exactly where it was. */
  chromeHidden: {
    display: 'none',
  },
})
