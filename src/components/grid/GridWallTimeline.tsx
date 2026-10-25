/**
 * GridWallTimeline — the grid page's wall, inside THE timeline.
 *
 * ## What this replaced, and why it is a host and not a component
 *
 * The grid page used to render a timeline of its own — `GridTimeline`, a band
 * of per-camera lanes over a sliding window, with its own playhead store, its
 * own zoom ladder and its own placement gate. It answered a different question
 * from the theater's ("which cameras are lit right now" rather than "what
 * happened, and when"), and nothing was going to make the two converge: they
 * shared no window, no clustering, no coverage read and no scrub.
 *
 * It is deleted. The grid page mounts `TheaterTimeline`, scoped to the grid's
 * cameras — the same component, the same batched reads, the same distinction
 * between a camera that was QUIET and a camera nobody could READ.
 *
 * This file is only the wiring, and it exists so that `GridViewScreen` — a
 * screen that already carries the wall, the control bar, the cell panels and
 * two grid-store dispatch paths — does not also grow a playback machine.
 *
 * ## The wall is the timeline's CHILD, not its sibling
 *
 * `TheaterTimeline` hosts the picture (`props.stream`) rather than sitting
 * under one. That is not a preference: the slot is the player's ONE parent in
 * every layout, which is what keeps a rotation from re-parenting — and
 * therefore remounting, and therefore renegotiating — the session. On this page
 * the "picture" is the whole wall, so the wall goes in the slot. It is passed
 * through untouched: this file does not know whether it is the iOS/web embed,
 * the Android native tiles, or how many cells it has.
 *
 * The consequence for the control bar's clock button, and how it came back:
 * the chrome may never be UNMOUNTED here. As a sibling band, toggling only
 * reflowed the wall's box; as the wall's parent, mounting and unmounting it
 * tears down and re-dials every peer on the wall. So "off" is a STATE of the
 * always-mounted host (`chromeHidden`) rather than the absence of it — the
 * chrome keeps its instance and its scroll offset, stops reading and stops
 * drawing, and the slot below takes the whole surface. Nothing above the slot
 * moves, so nothing under it is re-parented.
 *
 * ## There is no "primary" here, so the machine drives the bus directly
 *
 * `camera-detail` has a picture the machine owns and a wall it must also reach,
 * which is what `fanOutPlaybackToWall` wraps. This page has no picture: every
 * camera is a cell behind the same bus. So the machine's SINK is the broadcast,
 * and the two cannot disagree because there is only one of them.
 */
import React, { useCallback, useMemo } from 'react'

import { TheaterTimeline } from '../camera/theater/TheaterTimeline.js'
import { gridPlaybackBus } from '../../live/playback-bus.js'
import {
  usePlaybackMachine,
  selectActiveEpoch,
  selectScrubDirection,
  type PlaybackControlSink,
} from '../../recording/playback-machine.js'
import { jogTarget, resolveJogBase } from '../../recording/playback-status.js'
import type { DetailLayoutMode } from '../../screens/camera-detail/detail-layout.js'
import { GRID_WALL_SLOT_TEST_ID, gridWallSlotStyle } from '../../grid/grid-timeline-surface.js'
import { View } from 'react-native'
import { log } from '../../lib/logger.js'

export interface GridWallTimelineProps {
  /**
   * The grid's cameras, in the grid's own order — the timeline's SCOPE.
   *
   * It comes from the one place the page already resolves them (the visible
   * wall cameras), never from a second source: the grid definition is what
   * selects them, and a timeline reading a different list would be a second
   * answer to "which cameras is this page about".
   *
   * The head is also the `deviceId` the timeline's singular things use — the
   * persisted activity filter, the cluster detail's media authorization, the
   * per-camera log tag. `planScopeAsk` truncates a scope from the END, so the
   * head is additionally the one camera an over-large grid can never cost.
   */
  readonly deviceIds: readonly number[]
  /** The wall, whatever renders it. Placed in the timeline's stream slot. */
  readonly wall: React.ReactNode
  /** Grid name — titles the timeline's toolbar and its management panels. */
  readonly title: string
  readonly onBack: () => void
  readonly layoutMode: DetailLayoutMode
  readonly railWidth?: number
  /** The wall's height in `stack` (ignored by the other shapes, and by
   *  `chromeHidden` — off, the wall takes everything). */
  readonly wallStackHeight: number
  /** The operator's clock button, OFF: the chrome is hidden, not unmounted.
   *  See `TheaterTimelineProps.chromeHidden`. */
  readonly chromeHidden: boolean
  /** Hide the toolbar's back arrow — the app sidebar is already on screen. */
  readonly hideBack?: boolean
}

/** Never mounted without cameras (`GridViewScreen` renders the empty states),
 *  but the scope's head has to exist for the singular props. */
const NO_CAMERA = 0

export function GridWallTimeline(props: GridWallTimelineProps): React.JSX.Element {
  const {
    deviceIds,
    wall,
    title,
    onBack,
    layoutMode,
    railWidth,
    wallStackHeight,
    chromeHidden,
    hideBack,
  } = props

  // The bus is the ONLY player surface this page has. `broadcast` returns how
  // many sinks it reached, and zero is worth a line: a scrub that reaches no
  // player is the difference between "the grid seeked" and "the cursor moved",
  // and silence reads as the former while the wall shows the latter.
  const sink = useMemo<PlaybackControlSink>(
    () => ({
      scrubStart: () => reach('scrubStart', (s) => s.scrubStart()),
      scrubTo: (epochMs) => reach('scrubTo', (s) => s.scrubTo(epochMs)),
      scrubCommit: (epochMs) => reach('scrubCommit', (s) => s.scrubCommit(epochMs)),
      seek: (epochMs) => reach('seek', (s) => s.seek(epochMs)),
      goLive: () => reach('goLive', (s) => s.goLive()),
    }),
    [],
  )
  const playback = usePlaybackMachine(sink)

  // Transport state the machine does not own: the wall has no rate of its own,
  // so the bar's rate and its pause are held here and pushed onto the bus.
  // `setRate(0)` IS the pause, which is why resuming has to know the rate to
  // return to — read from state, in a callback that depends on it, rather than
  // from a ref written during render.
  const [rate, setRate] = React.useState(1)
  const [paused, setPaused] = React.useState(false)

  const onSelectRate = useCallback((next: number) => {
    setRate(next)
    setPaused(false)
    reach('setRate', (s) => s.setRate(next))
  }, [])
  const onTogglePlayPause = useCallback(() => {
    const next = !paused
    setPaused(next)
    reach('setRate', (s) => s.setRate(next ? 0 : rate))
  }, [paused, rate])

  // ±10 s. A jog IS a seek, and it goes through the machine's own `seek` so
  // the wall and the timeline's cursor move together — the grid's old band had
  // no jog at all.
  const machineSeek = playback.seek
  const playhead = playback.state.playhead
  const activeEpoch = selectActiveEpoch(playback.state)
  const jog = useCallback(
    (dir: 1 | -1): void => {
      const target = jogTarget(resolveJogBase(playhead, activeEpoch), dir)
      if (target != null) machineSeek(target, 'timeline')
    },
    [playhead, activeEpoch, machineSeek],
  )
  const onJogBack = useCallback(() => jog(-1), [jog])
  const onJogForward = useCallback(() => jog(1), [jog])

  const primaryId = deviceIds[0] ?? NO_CAMERA
  const wallSlot = useMemo(
    () => gridWallSlotStyle(layoutMode, wallStackHeight, chromeHidden),
    [layoutMode, wallStackHeight, chromeHidden],
  )

  return (
    <TheaterTimeline
      layoutMode={layoutMode}
      railWidth={railWidth}
      chromeHidden={chromeHidden}
      hideBack={hideBack}
      // The wall, in the slot the player would occupy on camera-detail. Wrapped
      // in a box because the slot's own style was written for a fixed-size
      // picture (`stream-slot.ts`): in `wide` it centres its child and in
      // `stack` it has no height, and a wall dropped into either measures zero
      // on one axis and draws nothing.
      // The testID rides this box across a toggle rather than switching
      // elements: same View, same position, so the wall under it is reflowed
      // and never re-parented — and a spec can read which box it got.
      stream={
        <View
          testID={GRID_WALL_SLOT_TEST_ID[chromeHidden ? 'full' : 'shared']}
          style={wallSlot}
        >
          {wall}
        </View>
      }
      deviceId={primaryId}
      scopeIds={deviceIds}
      name={title}
      onBack={onBack}
      deviceBinding={{
        cameraName: title,
        // Both false, and neither is a placeholder: the PTZ button left this
        // bar on 2026-09-02, and a battery charge is one camera's — on a wall
        // of N there is no charge to show, so nothing asks the cap.
        hasPtz: false,
        hasBattery: false,
        hasNetworkLink: false,
        hasNavigation: false,
        // No `cameraJump` either, and it is not an omission. The footer's
        // camera button exists only BELOW the tablet threshold (the operator,
        // 2026-09-02: a tablet builds its view on the surface itself) and this
        // timeline exists only ABOVE it (`shouldMountGridTimeline`), so nothing
        // on this page can ever open the camera panel. The three callbacks that
        // fed it are deleted rather than left wired: an unreachable binding
        // reads as a live feature, which is the leftover this repo keeps
        // paying for.
      }}
      // No `singleCamera`: the quality chip, the view-options menu and the zone
      // button are per-camera by construction and this page has N. The grid's
      // own control bar already owns the per-grid tier, layers and highlight.
      mode={playback.state.mode}
      activeEpoch={activeEpoch}
      seekAnchor={playback.state.seekAnchor}
      onSeek={playback.seek}
      onScrubBegin={playback.beginScrub}
      onScrubMove={playback.moveScrub}
      onScrubCommit={playback.commitScrub}
      onGoLive={playback.goLive}
      liveLocked={playback.state.liveLocked}
      onToggleLiveLock={playback.toggleLiveLock}
      playbackRate={rate}
      paused={paused}
      loading={false}
      // The wall reports no aggregate health, so this makes NO claim about the
      // picture: `failed: false` here means "nothing reported a fault", not
      // "every cell is fine". The two loads the timeline owns itself — the
      // coverage read and the activity bundle — still surface their own
      // failures through the same slot, and an unreadable camera still reaches
      // the scope notice.
      streamFault={{ failed: false, fetching: false, reason: null, onRetry: onRetryNothing }}
      scrubDirection={selectScrubDirection(playback.state)}
      onTogglePlayPause={onTogglePlayPause}
      onJogBack={onJogBack}
      onJogForward={onJogForward}
      onSelectRate={onSelectRate}
    />
  )
}

/** The retry a fault notice offers. Nothing here reported a fault, so nothing
 *  has to be retried — see the `streamFault` binding above. */
function onRetryNothing(): void {}

/** Broadcast onto the bus and report a command that landed nowhere. */
function reach(command: string, fn: Parameters<typeof gridPlaybackBus.broadcast>[0]): void {
  const reached = gridPlaybackBus.broadcast(fn)
  if (reached === 0) {
    log.warn('grid:timeline', 'broadcast reached no player surface', { command })
  }
}
