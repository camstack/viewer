/**
 * battery-stream-gate — a battery camera is never dialled without being asked.
 *
 * ## The cost this exists to stop paying
 *
 * Opening a camera MOUNTS `LiveView`, and mounting is starting: there is no
 * `autoStart` prop and no `start()` on `LiveViewHandle`, by design. On a wired
 * camera that is exactly right. On a battery camera it is an act with a price
 * the operator did not agree to — the hub wakes the firmware out of low-power
 * mode to serve the stream, and every accidental open (a mis-tap in the camera
 * list, a deep link, a back-navigation that remounts the screen) spends real
 * battery. The operator's words: "deve partire in pausa per non svegliarla
 * involontariamente, l'utente deve premere play per far partire lo stream e di
 * conseguenza svegliarla".
 *
 * So the pause is DERIVED, never latched, and the play button is the wake.
 *
 * ## Why `cameraKnown` is a separate input, and why it holds
 *
 * "Is this camera battery-powered" is read from `CameraInfo.features`, which
 * comes from the camera list — and that list is `[]` for the first render of a
 * cold start. A gate that latched `useState(hasBattery)` on that frame would
 * latch FALSE and dial the camera anyway, which is the whole defect, silently.
 * A stream that has already started cannot be un-started.
 *
 * So an unanswered list HOLDS. The cost is a poster for the fraction of a
 * second the list takes to arrive on a cold start (it is cache-hydrated, so
 * warm launches never see it); the cost of the other choice is waking a camera
 * that was asleep. It is not a close call, and the hold is deliberately NOT
 * explained on screen ({@link isBatteryHold} stays false) — "we have not looked
 * yet" is not something to tell an operator.
 *
 * ## Why the operator's choice wins in BOTH directions
 *
 * Once they have touched the transport, the gate is out of the way entirely: a
 * battery camera the operator started stays started across re-renders, and one
 * they paused stays paused. A rule that kept re-asserting the initial pause
 * would fight the play button — the exact shape of a control that "does
 * nothing".
 */

export interface LiveStreamGateInput {
  /**
   * The operator's own transport decision, or `null` while they have not made
   * one on this screen/tile yet. `false` = they pressed play.
   */
  readonly operatorChoice: boolean | null
  /** The camera list has ANSWERED for this device (not merely "is empty"). */
  readonly cameraKnown: boolean
  /** That answer carried `battery-operated`. */
  readonly batteryPowered: boolean
}

/** Whether the live stream must stay unmounted (poster shown) right now. */
export function resolveLivePaused(input: LiveStreamGateInput): boolean {
  if (input.operatorChoice !== null) return input.operatorChoice
  if (!input.cameraKnown) return true
  return input.batteryPowered
}

/**
 * True when the picture is held BECAUSE of the battery rule and the operator
 * has not yet pressed play — the one state that earns the play disc and the
 * "this camera runs on battery" hint.
 *
 * Deliberately narrower than {@link resolveLivePaused}: a camera the operator
 * paused themselves needs no explanation (they did it), and a camera we have
 * not identified yet must not be described as battery-powered when it may be
 * mains-wired.
 */
export function isBatteryHold(input: LiveStreamGateInput): boolean {
  return input.operatorChoice === null && input.cameraKnown && input.batteryPowered
}

/**
 * Whether `LiveView` may mount. Mounting IS starting the WebRTC peer, and
 * recorded playback rides that same peer — so a held battery camera that
 * mounts "just to scrub" is already awake.
 *
 * Play is the only live wake. A first scrub (seeking, no playhead) stays on
 * the poster; a gap / failed recording unmounts rather than falling through
 * to live; a committed recording may mount so the NVR feeder can play.
 */
export type LiveViewMountMode = 'live' | 'seeking' | 'playback' | 'gap' | 'error'

export interface LiveViewMountInput {
  /** `resolveLivePaused` — live must not be dialled. */
  readonly liveHeld: boolean
  readonly mode: LiveViewMountMode
  /** The machine's recorded playhead. Null on the live edge. */
  readonly playhead: number | null
  /** Deep-link / first-commit seek the embed should enter on, if any. */
  readonly recordedSeekMs: number | null
  /**
   * The player is already showing a recorded session. A further scrub must
   * keep it (unmounting mid-drag kills the feeder). After a gap we unmount,
   * so this is false and a leftover playhead must not remount live-first.
   */
  readonly keepRecordedSession: boolean
  /**
   * A CLIP the embed should open on, if any.
   *
   * It mounts a held camera for the same reason `recordedSeekMs` does, and
   * with the same guarantee: the page enters the file on its first channel,
   * never live. A clip is bytes the hub already holds — nothing is asked of
   * the camera, so nothing wakes.
   *
   * Without it the clip could not play at all on a sleeping camera, and it
   * failed in the quietest possible way: `clipStage` attached, the command
   * went to `liveRef.current?.playClip`, the player was not mounted, and `?.`
   * dropped it. Measured on 3628 (battery, asleep) on 2026-09-21 — the chain
   * reached `open: port` with `hasPlayer: false` and stopped there.
   *
   * `clip-stage.ts` claimed the opposite: that the gate returns false for clip
   * mode so the live peer is torn down. This file has never contained the word
   * `clip`.
   */
  readonly initialClipId: string | null
}

export function shouldMountLiveView(input: LiveViewMountInput): boolean {
  // A clip to open beats every hold: the page needs a surface to play a FILE
  // in, and playing it dials nothing at the camera.
  if (input.initialClipId !== null) return true
  if (!input.liveHeld) return true
  if (input.mode === 'gap' || input.mode === 'error') return false
  if (input.mode === 'live') return input.recordedSeekMs != null
  if (input.mode === 'seeking') return input.keepRecordedSession
  return input.playhead != null || input.recordedSeekMs != null
}

/**
 * Returning to the live edge remounts the player on a camera that is allowed
 * to stream. On a held battery camera it is a wake: the timeline snaps home,
 * the poster stays, nothing is negotiated.
 */
export function shouldDialLiveOnGoLive(liveHeld: boolean): boolean {
  return !liveHeld
}

/**
 * The grid's transport, as the two SETS the wall screen already thinks in.
 *
 * The embedded wall (iOS + web) is not a tree of components with their own
 * state — it is one WebView whose paused tiles are a host-owned list of ids,
 * seeded into the injected config and pushed as a `setPaused` command
 * afterwards. Seeding it is what keeps a sleeping camera asleep: a tile that
 * boots paused never negotiates, so nothing wakes.
 *
 * Two sets rather than one, because a single "paused" set cannot express the
 * difference the gate is built on. `pausedIds` is "the operator stopped this";
 * `startedIds` is "the operator started this", which a battery camera needs
 * because its DEFAULT is stopped — and dropping it from `pausedIds` would only
 * return it to that default, so the play button would appear to do nothing.
 */
export interface GridTransport {
  /** Tiles the operator explicitly paused. */
  readonly pausedIds: ReadonlySet<number>
  /** Battery tiles the operator explicitly started (their wake was asked for). */
  readonly startedIds: ReadonlySet<number>
}

/** How the two sets read as one `operatorChoice`. Pause wins: it is the later,
 *  more specific instruction on a tile that was already running. */
export function tileOperatorChoice(transport: GridTransport, deviceId: number): boolean | null {
  if (transport.pausedIds.has(deviceId)) return true
  if (transport.startedIds.has(deviceId)) return false
  return null
}

/**
 * Ids whose tile must NOT be streaming — what the wall hands the embed.
 *
 * `cameraKnown` is true by construction: a tile only exists because the camera
 * list produced it.
 */
export function heldTileIds(
  cameras: readonly { readonly id: number; readonly batteryPowered: boolean }[],
  transport: GridTransport,
): readonly number[] {
  return cameras
    .filter((camera) =>
      resolveLivePaused({
        operatorChoice: tileOperatorChoice(transport, camera.id),
        cameraKnown: true,
        batteryPowered: camera.batteryPowered,
      }),
    )
    .map((camera) => camera.id)
}

/**
 * The in-tile transport button, as a new transport (never a mutation).
 *
 * One button, two meanings, and the gate is what tells them apart: on a battery
 * tile that has never been started the press means START, so it records a
 * start rather than removing a pause that was never there. Every other press is
 * the ordinary toggle — and un-pausing a battery tile records a start too,
 * otherwise it would fall straight back to its held default.
 */
export function toggleTileTransport(
  transport: GridTransport,
  deviceId: number,
  batteryPowered: boolean,
): GridTransport {
  const pausedIds = new Set(transport.pausedIds)
  const startedIds = new Set(transport.startedIds)
  if (pausedIds.has(deviceId)) {
    pausedIds.delete(deviceId)
    if (batteryPowered) startedIds.add(deviceId)
    return { pausedIds, startedIds }
  }
  const held = isBatteryHold({
    operatorChoice: tileOperatorChoice(transport, deviceId),
    cameraKnown: true,
    batteryPowered,
  })
  if (held) {
    startedIds.add(deviceId)
    return { pausedIds, startedIds }
  }
  pausedIds.add(deviceId)
  return { pausedIds, startedIds }
}

/**
 * The wall's MASS transport button — the bar's Pause all / Play all — as a new
 * transport (never a mutation).
 *
 * Any tile the operator paused ⇒ the button reads Play and resumes EVERY tile;
 * none paused ⇒ it reads Pause and pauses every tile on the wall. "Resume all"
 * is an explicit, wall-wide instruction to start every tile, battery ones
 * included: without recording that consent they would fall straight back to
 * held and the button would half-work.
 *
 * One function for every wall that carries the bar — the saved grid page and
 * the camera-detail view — so "pause all" cannot mean two things.
 */
export function toggleWallTransport(
  transport: GridTransport,
  wallIds: readonly number[],
  batteryIds: ReadonlySet<number>,
): GridTransport {
  if (transport.pausedIds.size > 0) {
    return { pausedIds: new Set(), startedIds: new Set(batteryIds) }
  }
  return { pausedIds: new Set(wallIds), startedIds: transport.startedIds }
}
