/**
 * use-clip-stage — the ONE place a clip takes the camera's frame, and the one
 * place it gives it back.
 *
 * Two facts are kept in step here and nowhere else:
 *
 *  - `ClipStage` — who the frame belongs to (`clip-stage.ts`);
 *  - the playback machine's `clip` MODE — which makes the scrub controller and
 *    the recorded playback state unable to act while it does.
 *
 * They are updated together, in one function each way, because the whole point
 * of D570 is that they can never disagree. A caller that could set one without
 * the other would be the second authority this design exists to remove — so
 * `attach`/`detach` are the only exports that write either, and the machine's
 * `attachClip`/`detachClip` arrive as callbacks rather than being reached for.
 *
 * ## The clip's own position and length live here too (2026-09-22)
 *
 * While a clip holds the frame the player's position reports are
 * FILE-RELATIVE (`clip-progress.ts`), and the broker measures the file's real
 * length once the clip is open. Both are facts about the clip ON THE STAGE, so
 * they are kept next to the stage and reset with it: a position carried across
 * a prev/next would draw the last file's progress over the next one until its
 * first report. `reportPosition` is the one router — every report the player
 * makes goes through it, and it answers whether the clip took it.
 */
import { useCallback, useRef, useState } from 'react'

import {
  clipStageAttach,
  clipStageClose,
  clipStageStep,
  initialClipStage,
  stageHoldsClip,
  type ClipStage,
} from './clip-stage.js'
import {
  EMPTY_CLIP_PROGRESS,
  resolveClipDuration,
  resolveClipProgress,
  routePlayerPosition,
  type ClipProgress,
  type ClipSeekBinding,
} from './clip-progress.js'
import { noteClipOpenStep, noteTimelineInputIgnored } from './clip-telemetry.js'
import { reduceClipLoading, type ClipLoading } from './clip-transport.js'
import { reduceClipLoop, type ClipLoopMemo } from './clip-loop.js'
import type { PlaybackMode as EmbedPlaybackMode } from '../recording/playback-status.js'
import { useClipPlayback, type ClipPlaybackState } from './use-clip-playback.js'
import { generateDragId } from '../recording/scrub-drag-id.js'
import { clipSeekAllowed, type ClipControlsView } from './clip-controls.js'
import { useClipPlaybackOptions } from './use-clip-playback-options.js'
import { PLAYER_SCRUB_EMIT_MS, shouldEmitScrubSample } from '../lib/scrub-throttle.js'
import type {
  ClipAudioReport,
  ClipDurationReport,
  ClipIncompleteReport,
} from '../recording/recording-messages.js'
import { resolveClipAudioNotice, type ClipAudioNotice } from './clip-audio-notice.js'
import {
  resolveClipIncompleteNotice,
  type ClipIncompleteNotice,
} from './clip-incomplete-notice.js'
import type { Clip } from './clip-model.js'

export interface UseClipStage {
  readonly stage: ClipStage
  /** The file behind {@link stage}, while it is being resolved or has been. */
  readonly playback: ClipPlaybackState
  /** Give the frame to this clip. Also used to hand it from one clip to the
   *  next — the transition is the same one and there is no second path. */
  readonly open: (clip: Clip, provider: string) => void
  /** Re-send the held clip to the player, with the arguments the first
   *  dispatch used. See the implementation for why this is not derivable from
   *  {@link stage}. */
  readonly replay: () => void
  /** Step to the next/previous playable clip in `clips` and open it. No-op at
   *  the ends of the list and when no clip holds the frame. */
  readonly step: (clips: readonly Clip[], direction: 1 | -1) => void
  readonly close: () => void
  /**
   * Where inside the held file the picture is, against the file's length.
   * `EMPTY`-shaped while no clip holds the frame.
   */
  readonly progress: ClipProgress
  /** The seek gesture on the clip's own track — the scrub family, file-relative. */
  readonly seek: ClipSeekBinding
  /**
   * What the HUB says this camera's clips can be driven to do (D612), with the
   * standing of the answer beside it. Exposed so the CONTROL can refuse the
   * gesture visibly instead of the hook refusing it after the fact — see
   * `ClipProgressBinding.controls` — and so a control is drawn DISABLED only
   * on an answer that arrived (D315).
   */
  readonly controls: ClipControlsView
  /**
   * Route ONE player position report. Returns `true` when a clip holds the
   * frame and took it (or dropped a straggling epoch); `false` means the number
   * is the session's epoch and belongs to the playback machine.
   */
  readonly reportPosition: (reportedMs: number) => boolean
  /** The broker's measured length for a clip, named by clip. */
  readonly reportDuration: (report: ClipDurationReport) => void
  /** The broker's audio answer for a clip, named by clip. Re-issued whenever
   *  the rate crosses 1×, so this is a stream of answers, not a settle. */
  readonly reportAudio: (report: ClipAudioReport) => void
  /**
   * What to TELL the operator about the held clip's silence — resolved here,
   * because the identity guard needs the clip on the stage and nothing else in
   * the app has it. `null` when there is nothing to say (see
   * `clip-audio-notice.ts` for the six reasons that deliberately say nothing).
   */
  readonly audioNotice: ClipAudioNotice
  /**
   * The hub's verdict on the clip's REPLAY, named by clip (D623). Sent once,
   * when the stream ends — so unlike every other report here it describes
   * something that is already over.
   */
  readonly reportIncomplete: (report: ClipIncompleteReport) => void
  /**
   * What to TELL the operator about a replay that was cut short — resolved
   * here for the same reason the audio notice is: the identity guard needs the
   * clip on the stage, and nothing else in the app has it. `null` when there
   * is nothing to say.
   */
  readonly incompleteNotice: ClipIncompleteNotice
  /**
   * The clip on the stage is still being fetched: armed by the tap, cleared by
   * the player's first non-`loading` report (`clip-transport.ts`). The bar's
   * ring reads THIS while a clip holds the frame, never the session's state.
   */
  readonly loading: boolean
  /** Route ONE player state report to the clip's loading state. */
  readonly reportPlayerState: (state: EmbedPlaybackMode) => void
}

/**
 * The one thing this hook reaches OUT to: the camera's player.
 *
 * A port rather than a ref, so the decision stays testable and the hook never
 * knows which platform's handle it is holding.
 */
export interface ClipStagePorts {
  /**
   * Move the camera's playback pointer into this clip (D575).
   *
   * Answers whether the command reached a player that could HEAR it. `false`
   * means it was carried into the mount instead — there was no player, or one
   * that had not finished connecting — and the clip still has to be asserted
   * when the player arrives.
   */
  readonly playClip: (clipId: string, provider: string, offsetMs: number, profile?: string) => boolean
  /**
   * The STAGE clip now asserted to the live player.
   *
   * Called ONLY after a send that landed, and only with the id the caller's
   * re-assertion record is keyed on — `clipStage.stage.clipId`, never the file
   * id the port was given, which differs for a twin.
   *
   * This exists because the record had one writer and two senders: the effect
   * in `clip-assert-on-player.ts` wrote it, the TAP did not, so the second
   * sender always found it empty and always fired. One tap, two injections,
   * and a Hikvision's single replay slot contending with itself
   * (`use-clip-stage-asserted-once.spec.ts`). Only this hook knows which stage
   * clip a file id belongs to; only the port knows whether the send landed.
   */
  readonly noteAsserted: (stageClipId: string) => void
  /**
   * The scrub family, which the broker routes to the CLIP feeder on the
   * file's own axis while a clip holds the pointer (`timeline-session.ts`).
   * `positionMs` is file-relative on every one of them; the wire field is
   * still spelled `epoch`, and the name lies. `dragId` is minted by `begin`
   * and carried to the commit, as the timeline's drag does.
   */
  readonly scrubStart: (dragId: string) => void
  readonly scrubTo: (positionMs: number) => void
  readonly scrubCommit: (positionMs: number, dragId: string | undefined) => void
}

export function useClipStage(
  ports: ClipStagePorts,
  /**
   * Loop the held clip: when the player says the file ENDED, send it again
   * from its first sample (`clip-loop.ts`).
   *
   * Defaults to `false` so a caller that has not been taught about the switch
   * keeps exactly the behaviour it had — absent must never start a dial
   * nobody wired. The operator's default (ON) lives where the operator's
   * other answers live, in `settings.stream.clipLoop`, and reaches this hook
   * as an argument.
   */
  loop = false,
): UseClipStage {
  const [stage, setStage] = useState<ClipStage>(initialClipStage)
  /**
   * The exact arguments the last dispatch used — the FILE id (which is not the
   * row's `clipId` for a twin), the provider and the profile.
   *
   * Kept so the clip can be RE-ASSERTED to a player that arrives late or comes
   * back after a reconnect. The stage itself cannot answer this: it carries
   * what the operator picked, not what was sent, and the provider is required
   * on every clip call (D554).
   */
  const lastDispatchRef = useRef<{
    readonly fileClipId: string
    readonly provider: string
    readonly profile?: string
  } | null>(null)
  /**
   * The end this stage has ALREADY answered (`clip-loop.ts`).
   *
   * A ref, not state: nothing on screen reads it, and a re-render between the
   * two `ended` reports a player can send within one frame would be exactly
   * the window a second dial slips through — on a camera whose single replay
   * slot the first dial is still holding.
   */
  const loopMemoRef = useRef<ClipLoopMemo>(null)
  const clipPlayback = useClipPlayback()
  /** File-relative, for the clip on the stage; `null` before its first report. */
  const [positionMs, setPositionMs] = useState<number | null>(null)
  /** The broker's measure, kept by clip id so a late one lands on the right file. */
  const [measured, setMeasured] = useState<ClipDurationReport | null>(null)
  /** The broker's audio answer, kept whole — the clip id inside it is what
   *  keeps a late report off the next file (`clip-audio-notice.ts`). */
  const [audio, setAudio] = useState<ClipAudioReport | null>(null)
  /**
   * The hub's last truncated-serve verdict, kept whole (D623).
   *
   * Prev/next and go-live are answered by the clip-id guard alone
   * (`clip-incomplete-notice.ts`). This state is ALSO cleared on the two asks
   * the guard cannot see: re-opening the SAME file, and a seek that landed —
   * both dial a new replay session, whose own verdict supersedes this one.
   *
   * A LOOP iteration deliberately does not clear it. `replay()` re-dials the
   * same file off the player's `ended` report, which is the very edge the hub
   * sends `clipIncomplete` on — so clearing there would erase the sentence in
   * the frame it arrived in, and with `clipLoop` defaulting ON that is every
   * time. The verdict stands until the operator asks for something else.
   */
  const [incomplete, setIncomplete] = useState<ClipIncompleteReport | null>(null)
  /**
   * WHICH camera and WHICH provider the chrome's controls are a statement
   * about — the pair `getPlaybackOptions` is keyed on.
   *
   * State rather than the provider REF below, because it drives a query: a ref
   * read during render is the pattern the compiler refuses, and a ref that
   * changes without a render would leave the bar describing the previous
   * source. Set when a clip takes the frame, and deliberately LEFT in place on
   * close — the answer is about the camera, not about the file, so keeping it
   * means the next clip from the same source opens with its controls already
   * known instead of spending a beat in `pending`.
   */
  const [askedSource, setAskedSource] = useState<{
    readonly deviceId: number
    readonly provider: string
  } | null>(null)
  /** The clip whose fetch the operator is waiting on, or null. */
  const [loadingClipId, setLoadingClipId] = useState<ClipLoading>(null)

  const open = useCallback(
    (clip: Clip, provider: string): void => {
      providerRef.current = provider
      // Asked for the PAIR the operator is now looking at, even when the row
      // turns out to be unplayable: the refusal sentence is drawn by the same
      // chrome, and a control beside it must still say what this camera can do.
      setAskedSource((prev) =>
        prev !== null && prev.deviceId === clip.deviceId && prev.provider === provider
          ? prev
          : { deviceId: clip.deviceId, provider },
      )
      // A file taking the stage has an end AHEAD of it; nothing has been
      // answered for it yet — including when it is the same file again.
      loopMemoRef.current = reduceClipLoop(loopMemoRef.current, { kind: 'opened' }).memo
      const next = clipStageAttach(stage, clip)
      noteClipOpenStep('stage', {
        deviceId: clip.deviceId,
        clipId: clip.clipId,
        attached: next.kind,
        holds: stageHoldsClip(next),
        playback: clip.playback.kind,
        ...(clip.playable === false ? { refusedBy: 'provider' } : {}),
      })
      setStage(next)
      if (!stageHoldsClip(next)) {
        // A refusal does NOT take the frame: the session keeps the picture and
        // the operator is told why. Detaching for it would tear down a live
        // session to show a sentence.
        clipPlayback.refuse(clip.clipId, clip.unplayableReason ?? null)
        return
      }
      if (next.kind !== 'clip') return
      // A NEW file on the stage: its position is unknown until it reports, and
      // the last file's progress must not be drawn over it meanwhile.
      setPositionMs(null)
      // A NEW replay session is about to be dialled — for another file, or for
      // this one again. Whatever the last one failed to deliver is spent: its
      // sentence must not stand over footage it is not about (D623).
      setIncomplete(null)
      switch (clip.playback.kind) {
        case 'native':
          // In the camera's OWN frame. A clip is another position of the
          // recorded source pointer, so this is one message and no second
          // player: the playback bar already on screen is its transport, and
          // `goLive` leaves it. `use-clip-playback` is deliberately NOT called
          // — resolving a URL here would mint an entry in the provider's
          // 10-file scratch for a file the broker fetches by id anyway.
          //
          // Offset zero: a tap opens a clip at its start. The operator asked
          // for the clip in the frame, not for a position inside it.
          noteClipOpenStep('dispatch', {
            deviceId: clip.deviceId,
            clipId: clip.playback.clipId,
            provider,
            profile: next.profile ?? null,
          })
          // Waiting starts at the TAP, not at the player's first report.
          setLoadingClipId((prev) => reduceClipLoading(prev, { kind: 'opened', clipId: next.clipId }))
          lastDispatchRef.current = {
            fileClipId: clip.playback.clipId,
            provider,
            ...(next.profile === null ? {} : { profile: next.profile }),
          }
          // Recorded only when it LANDED: a command carried into the mount
          // must still be asserted when the player comes up, which is the
          // 2026-09-22 failure this must not undo.
          if (ports.playClip(clip.playback.clipId, provider, 0, next.profile ?? undefined)) {
            ports.noteAsserted(next.clipId)
          }
          return
        case 'recorded':
          // A clip of our own footage is a RANGE, not a file: the recorded
          // transport plays it in place and it never reaches this stage.
          // `resolveClipTap` routes it. Reaching here means a caller opened
          // the wrong kind, so the stage is closed rather than left with
          // nothing to play.
          setStage(initialClipStage)
          return
      }
    },
    [stage, clipPlayback, ports],
  )

  const close = useCallback((): void => {
    loopMemoRef.current = reduceClipLoop(loopMemoRef.current, { kind: 'closed' }).memo
    setStage((s) => clipStageClose(s))
    setPositionMs(null)
    // Go-live drops the verdict without a line of its own: the stage no longer
    // holds a clip, so `resolveClipIncompleteNotice` answers null, and a later
    // re-open of the same file clears the state in `open`. A `setIncomplete`
    // here would be a third writer that no test can fail on (measured:
    // removing it left the suite green), which is a leftover describing the
    // right design rather than enforcing it.
    setLoadingClipId((prev) => reduceClipLoading(prev, { kind: 'closed' }))
    clipPlayback.close()
  }, [clipPlayback])

  /**
   * Send the held clip to the player again, exactly as it was sent the first
   * time. Idempotent by construction — same arguments, same file, offset 0 —
   * and a no-op when the session owns the frame.
   *
   * The caller decides WHEN (`clip-assert-on-player.ts`); this knows WHAT.
   * Splitting it that way keeps the provider inside the hook that already
   * holds it instead of leaking it onto the stage type, where it would be a
   * second place that can disagree about which provider a clip came from.
   */
  const replay = useCallback((): void => {
    const last = lastDispatchRef.current
    if (last === null) return
    ports.playClip(last.fileClipId, last.provider, 0, last.profile)
  }, [ports])

  const reportPlayerState = useCallback(
    (state: EmbedPlaybackMode): void => {
      setLoadingClipId((prev) => reduceClipLoading(prev, { kind: 'player', state }))
      // The END OF THE FILE, decided here because this is where it is known.
      // A clip that no longer holds the frame answers nothing: the operator
      // left, and a straggling report must not dial a camera for a picture
      // that is gone.
      if (stage.kind !== 'clip') return
      const decision = reduceClipLoop(loopMemoRef.current, {
        kind: 'player',
        state,
        clipId: stage.clipId,
        loop,
      })
      loopMemoRef.current = decision.memo
      if (decision.replay) replay()
    },
    [stage, loop, replay],
  )

  // The provider of whatever is on the stage, so prev/next stays inside the
  // SAME source. Stepping into another provider's file with this one's name is
  // how a read ends up at the wrong addon — the failure this whole parameter
  // exists to prevent.
  const providerRef = useRef<string | null>(null)
  const step = useCallback(
    (clips: readonly Clip[], direction: 1 | -1): void => {
      if (stage.kind !== 'clip') return
      const provider = providerRef.current
      if (provider === null) return
      const next = clipStageStep(clips, stage.clipId, direction)
      if (next === null) return
      open(next, provider)
    },
    [stage, open],
  )

  // Re-minted on a stage change and on nothing else — the router must see
  // the stage the report arrived under, and a ref read during render is the
  // pattern the compiler refuses.
  const reportPosition = useCallback(
    (reportedMs: number): boolean => {
      const route = routePlayerPosition(stage, reportedMs)
      switch (route.kind) {
        case 'session':
          return false
        case 'clip':
          setPositionMs(route.positionMs)
          return true
        case 'dropped':
          // A straggling epoch from the feeder the clip replaced. Counted, not
          // logged per report — the same discipline as the drag's refusals.
          noteTimelineInputIgnored('positionEpochOnClip')
          return true
      }
    },
    [stage],
  )

  const reportDuration = useCallback((report: ClipDurationReport): void => {
    setMeasured(report)
  }, [])

  const reportAudio = useCallback((report: ClipAudioReport): void => {
    setAudio(report)
  }, [])

  const reportIncomplete = useCallback((report: ClipIncompleteReport): void => {
    setIncomplete(report)
  }, [])

  /**
   * The controls for the camera+provider the frame's clip came from.
   *
   * Per CAMERA and per PROVIDER, never per clip: the transport a provider's
   * clips arrive over reads nothing that varies from one file to the next, so
   * a per-clip channel had no information this one lacks — and two channels
   * that can disagree are worse than one (D612, and the `clipTransport`
   * message this replaced).
   */
  const controls = useClipPlaybackOptions(askedSource?.deviceId ?? null, askedSource?.provider ?? null)

  // ── The seek on the clip's own track ─────────────────────────────────────
  const dragRef = useRef<{ id: string; lastEmitMs: number } | null>(null)
  const holdsClip = stage.kind === 'clip'
  const seekBegin = useCallback((): void => {
    if (!holdsClip) {
      noteTimelineInputIgnored('clipSeekNoClip')
      return
    }
    const id = generateDragId()
    dragRef.current = { id, lastEmitMs: 0 }
    ports.scrubStart(id)
  }, [ports, holdsClip])
  const seekMove = useCallback(
    (ms: number): void => {
      const drag = dragRef.current
      if (drag === null) return
      const now = Date.now()
      if (!shouldEmitScrubSample(drag.lastEmitMs, now, PLAYER_SCRUB_EMIT_MS)) return
      dragRef.current = { id: drag.id, lastEmitMs: now }
      ports.scrubTo(ms)
    },
    [ports],
  )
  const seekCommit = useCallback(
    (ms: number): void => {
      if (!holdsClip) {
        dragRef.current = null
        noteTimelineInputIgnored('clipSeekNoClip')
        return
      }
      // A backward commit on a forward-only clip is refused HERE. The broker
      // refuses it too and re-sends the position, so without this gate the bar
      // snaps forward under the operator's finger and nothing says why — a
      // control that undoes the gesture reads as broken, where a disabled one
      // reads as unavailable (D62). Counted, like every other ignored input.
      if (!clipSeekAllowed(controls.controls, ms, positionMs ?? 0)) {
        dragRef.current = null
        noteTimelineInputIgnored('clipSeekBackwardOnForwardOnly')
        // Snap the indicator back to the truth ourselves rather than waiting
        // for the server to correct it.
        setPositionMs(positionMs)
        return
      }
      const dragId = dragRef.current?.id
      dragRef.current = null
      // Cleared only on a commit that LANDED. The refused branch above returns
      // before this, on purpose: nothing was re-dialled there, so erasing the
      // verdict would remove the sentence without anything having replaced it
      // — a branch that accepts the gesture and produces nothing (D391).
      setIncomplete(null)
      ports.scrubCommit(ms, dragId)
      // Optimistic: the track shows the release point until the feeder's next
      // report, instead of snapping back to the pre-drag position for a beat.
      setPositionMs(ms)
    },
    [ports, holdsClip, controls, positionMs],
  )

  const progress: ClipProgress =
    stage.kind === 'clip'
      ? resolveClipProgress(
          positionMs,
          resolveClipDuration({
            measuredMs: measured !== null && measured.clipId === stage.clipId ? measured.durationMs : null,
            startMs: stage.startMs,
            endMs: stage.endMs,
            inProgress: stage.inProgress,
          }),
        )
      : EMPTY_CLIP_PROGRESS

  return {
    stage,
    playback: clipPlayback.state,
    open,
    replay,
    step,
    close,
    progress,
    seek: { onSeekBegin: seekBegin, onSeekMove: seekMove, onSeekCommit: seekCommit },
    controls,
    reportPosition,
    reportDuration,
    reportAudio,
    reportIncomplete,
    // Named by clip AND dropped on every fresh dispatch — see the state's
    // declaration for why the identity guard alone is not enough here.
    incompleteNotice: resolveClipIncompleteNotice(
      stage.kind === 'clip' ? stage.clipId : null,
      incomplete,
    ),
    // Resolved against the clip the stage is holding RIGHT NOW: a report that
    // arrived for the previous file stays in state and simply stops matching,
    // which is how prev/next clears the badge without a second reset path.
    audioNotice: resolveClipAudioNotice(stage.kind === 'clip' ? stage.clipId : null, audio),
    // Named by clip, so a report that lands after prev/next moved the stage
    // on cannot clear the wait for the file that replaced it.
    loading: stage.kind === 'clip' && loadingClipId === stage.clipId,
    reportPlayerState,
  }
}
