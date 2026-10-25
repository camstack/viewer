/**
 * useSystemPip — the ONE place a surface asks for system Picture-in-Picture.
 *
 * The order is `screens/camera-detail/pip-handoff.ts` and the gates are
 * `pip-live.ts`; neither is duplicated here. What this hook owns is the part
 * that cannot live in a pure module: the go-live leg is answered by the
 * playback machine plus the player, never by a timer, so the resolver has to
 * be parked in a ref and released from an effect.
 *
 * It exists as a hook because there are now two surfaces with a
 * `LiveViewHandle` and a playback machine — the single-camera screen and the
 * on-demand overlay. The overlay grew a PiP button on 2026-09-13 and the
 * choice was between a second copy of this waiter or this file; a second copy
 * of a sequence whose whole point is ordering is how the two would drift.
 *
 * Note what a caller still owns: `goLive` here is the caller's own go-live,
 * because the two surfaces remount differently (the screen also flips its
 * player status to `connecting`, the overlay bumps its reload key). The hook
 * decides WHEN to call it, not what it is.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { PipStartResult } from './pip-request.js'
import type { PlayerConnectionState } from './live-view-types.js'
import type { PlaybackMode } from '../recording/playback-machine.js'
import {
  requestSystemPip,
  type GoLiveOutcome,
  type PipRequestPorts,
} from '../screens/camera-detail/pip-handoff.js'
import { pipReadyAfterGoLive, goLiveFailedBeforePip } from '../screens/camera-detail/pip-live.js'

export interface SystemPipSource {
  /** The playback machine's mode — PiP must picture LIVE, never the playhead. */
  readonly mode: PlaybackMode
  /** The player's connection state; the go-live leg is answered from it. */
  readonly playerState: PlayerConnectionState
  /** Leave recorded playback. Remounts the embed — the caller's own remount. */
  readonly goLive: () => void
  /** Ask the player for system PiP (`LiveViewHandle.startPip`). */
  readonly startPip: () => Promise<PipStartResult>
}

export interface SystemPipControl {
  /** The press handler for a PiP control. Safe to call while already live (the
   *  go-live leg is skipped) and while a request is already out. */
  readonly request: () => void
  /**
   * Answer a pending go-live leg as `failed` because the session it was
   * waiting for is gone — the surface swapped camera.
   *
   * `CameraDetailScreen` swaps the camera IN PLACE (D483) rather than
   * remounting, so nothing collects the resolver any more: left parked, it
   * hangs forever and PiP silently stops working for the rest of the session.
   */
  readonly abandon: () => void
}

export function useSystemPip(source: SystemPipSource): SystemPipControl {
  const waiterRef = useRef<((outcome: GoLiveOutcome) => void) | null>(null)

  // The go-live leg, answered by the machine + the player — never by a timer.
  useEffect(() => {
    const waiter = waiterRef.current
    if (waiter === null) return
    if (goLiveFailedBeforePip(source.playerState)) {
      waiterRef.current = null
      waiter('failed')
      return
    }
    if (
      !pipReadyAfterGoLive({ pending: true, mode: source.mode, playerState: source.playerState })
    ) {
      return
    }
    waiterRef.current = null
    waiter('live')
  }, [source.mode, source.playerState])

  // Rebuilt whenever the inputs change rather than closed over once behind a
  // ref: a press that used a mode captured one render ago would go live when
  // it should not, or fail to when it should — and a ref read during render is
  // the `react-hooks/refs` bailout this file has no reason to spend.
  const { mode, goLive, startPip } = source
  const request = useCallback((): void => {
    const ports: PipRequestPorts = {
      mode,
      goLive,
      awaitLive: () =>
        new Promise<GoLiveOutcome>((resolve) => {
          waiterRef.current = resolve
        }),
      startPip,
    }
    void requestSystemPip(ports)
  }, [mode, goLive, startPip])

  const abandon = useCallback((): void => {
    const waiter = waiterRef.current
    if (waiter === null) return
    waiterRef.current = null
    waiter('failed')
  }, [])

  return useMemo(() => ({ request, abandon }), [request, abandon])
}
