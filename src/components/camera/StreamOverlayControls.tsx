/**
 * StreamOverlayControls — composer for the single-camera ON-VIDEO discs.
 *
 * It does not paint buttons itself. It builds an `items` list from stream
 * state and hands it to `OverlayDiscGroup`, which owns hide/show, auto-hide,
 * press re-arm and the disc chrome. History is just another left-cluster
 * item when `timelineToggle` is provided (fill / landscape). A sibling
 * History disc that ignored `visible` is how tap-to-hide left the timeline
 * trigger on screen (operator, 2026-08-23).
 *
 * ## The division of labour with the timeline's playback bar
 *
 * This overlay carries what belongs to the STREAM: volume, talk, PiP,
 * fullscreen, and play/pause ONLY while the playback bar is off-screen. The
 * bar carries what belongs to TIME — go-to-live, ±10s, frame-step, speed —
 * plus play/pause whenever it is visible.
 *
 * `showPlayPause` is parent-owned (`shouldShowOverlayPlayPause`). The pause
 * STATE is still resolved once (`effectivePaused` / `onToggleEffectivePause`)
 * and fed to both surfaces — neither component owns playback state, and
 * `docked-timeline-chrome.spec` asserts the single binding.
 *
 * Visibility is PARENT-OWNED (`visible`): the stage's single-tap gesture
 * toggles it. The group asks the parent to hide via `onRequestHide` —
 * suspended while paused (keep play reachable).
 *
 * Presentational: all stream state + handlers are owned by `CameraDetailScreen`.
 * Buttons are omitted when the capability is absent (talk / PiP / timeline).
 *
 * Volume, talk and PiP are not spelled here either: they are the STREAM's
 * controls, the on-demand overlay paints the same three, and their icon /
 * label / active triple lives in `stream-control-items.ts`. This file only
 * chooses the cluster each lands in.
 */
import React, { useMemo } from 'react'
import { Platform } from 'react-native'
import { Play, Pause, Maximize2, Minimize2 } from '../../lib/icons.js'
import { useTranslation } from 'react-i18next'
import {
  OverlayDiscGroup,
  type OverlayDisc,
  type OverlayEdgePad,
} from './OverlayDiscGroup.js'
import {
  muteDisc,
  talkDisc,
  systemPipDisc,
  systemPipSupported,
  timelineDockDisc,
  ptzDisc,
} from './stream-control-items.js'
import type { TimelineDock } from './theater/timeline-dock.js'
import type { ClipAudioNotice } from '../../clips/clip-audio-notice.js'

export interface StreamTimelineToggle {
  /** Where the timeline is now: off, over the stream, or beside it. */
  readonly dock: TimelineDock
  /** Choose the next state (the button cycles off → overlay → side). */
  readonly onSet: (next: TimelineDock) => void
}

export interface StreamPtzToggle {
  /** Whether the PTZ pad is open over the picture (`PtzOverlay`). */
  readonly open: boolean
  readonly onToggle: () => void
}

export interface StreamOverlayControlsProps {
  /** Parent-owned visibility (the stage's single-tap gesture toggles it). */
  readonly visible: boolean
  /** Inactivity auto-hide callback — the parent owns `visible`. */
  readonly onRequestHide: () => void
  /** EFFECTIVE pause — the SAME binding the playback bar receives. */
  readonly paused: boolean
  readonly onTogglePause: () => void
  /** False while the playback bar is on screen — hide the overlay disc. */
  readonly showPlayPause: boolean
  readonly muted: boolean
  readonly onToggleMute: () => void
  /**
   * Why the clip on the frame is silent, when the SPEED is why (D621). `null`
   * or omitted means there is nothing to say — which is also what the six
   * other reasons resolve to (`clip-audio-notice.ts`).
   */
  readonly audio?: ClipAudioNotice
  /** Two-way audio — the talk button is omitted unless the camera has it. */
  readonly hasTwoWayAudio: boolean
  readonly talking: boolean
  readonly onToggleTalk: () => void
  /** System Picture-in-Picture (leaves the app). Hidden off iOS. */
  readonly onStartSystemPip: () => void
  readonly fullscreen: boolean
  /** Absent = no fullscreen disc (a touch browser that cannot force landscape
   *  — see `decideWebFullscreenMode`). */
  readonly onToggleFullscreen?: () => void
  /**
   * Extra left/right/bottom inset for the two overlay clusters. Fill /
   * landscape MUST pass the window safe-area so the discs clear the notch.
   * Portrait omits this: the video box is already below the status bar.
   */
  readonly edgePad?: OverlayEdgePad
  /**
   * Fill / landscape only. History joins the left cluster and hides with
   * mute and talk. Portrait / wide omit this: the timeline is already on
   * the page.
   */
  readonly timelineToggle?: StreamTimelineToggle
  /**
   * Fill / landscape only, and only for a camera the session may steer. The
   * PTZ disc joins the left cluster after History and opens the pad over the
   * picture. Absent = no disc (never a disabled one).
   */
  readonly ptzToggle?: StreamPtzToggle
  /**
   * Bumped by a surface that belongs to this chrome but is not a disc (the
   * PTZ pad): each change restarts the auto-hide countdown, so the chrome
   * does not vanish under a finger that is still steering.
   */
  readonly activity?: number
}

export function StreamOverlayControls({
  visible,
  onRequestHide,
  paused,
  onTogglePause,
  showPlayPause,
  muted,
  onToggleMute,
  audio,
  hasTwoWayAudio,
  talking,
  onToggleTalk,
  onStartSystemPip,
  fullscreen,
  onToggleFullscreen,
  edgePad,
  timelineToggle,
  ptzToggle,
  activity,
}: StreamOverlayControlsProps) {
  const { t } = useTranslation()
  const showSystemPip = systemPipSupported(Platform.OS)

  const items = useMemo((): readonly OverlayDisc[] => {
    // Volume, talk and PiP are the STREAM's controls and are defined once, in
    // `stream-control-items.ts`, because the on-demand overlay paints the same
    // three. All this file decides is the cluster each lands in.
    const next: OverlayDisc[] = [muteDisc({ muted, onToggleMute, cluster: 'left', t, audio })]
    const talk = talkDisc({ hasTwoWayAudio, talking, onToggleTalk, cluster: 'left', t })
    if (talk) next.push(talk)
    if (timelineToggle) {
      next.push(
        timelineDockDisc({ dock: timelineToggle.dock, onSet: timelineToggle.onSet, cluster: 'left', t }),
      )
    }
    if (ptzToggle) {
      next.push(ptzDisc({ open: ptzToggle.open, onToggle: ptzToggle.onToggle, cluster: 'left', t }))
    }
    showPlayPause && next.push({
      id: 'play',
      icon: paused ? Play : Pause,
      label: paused ? t('v2.streamBar.play') : t('v2.streamBar.pause'),
      onPress: onTogglePause,
      cluster: 'right',
    })
    const pip = systemPipDisc({
      supported: showSystemPip, onStartSystemPip, cluster: 'right', t,
    })
    if (pip) next.push(pip)
    if (onToggleFullscreen !== undefined) {
      next.push({
        id: 'fullscreen',
        icon: fullscreen ? Minimize2 : Maximize2,
        label: fullscreen ? t('v2.streamBar.exitFullscreen') : t('v2.streamBar.fullscreen'),
        active: fullscreen,
        onPress: onToggleFullscreen,
        cluster: 'right',
      })
    }
    return next
  }, [
    muted,
    onToggleMute,
    audio,
    hasTwoWayAudio,
    talking,
    onToggleTalk,
    timelineToggle,
    ptzToggle,
    showPlayPause,
    paused,
    onTogglePause,
    showSystemPip,
    onStartSystemPip,
    fullscreen,
    onToggleFullscreen,
    t,
  ])

  return (
    <OverlayDiscGroup
      visible={visible}
      onRequestHide={onRequestHide}
      holdOpen={paused}
      items={items}
      edgePad={edgePad}
      activity={activity}
    />
  )
}
