/**
 * clip-stage — WHO holds the camera's one frame.
 *
 * ## The problem this type exists to make unrepresentable
 *
 * The rectangle on camera-detail has always had exactly one occupant and never
 * a name for it. Live and recorded are not two occupants: they are one embed
 * session reached two ways, and `playback-machine.ts` is their single owner. A
 * clip is a THIRD thing — a finished MP4 behind a Range route, with its own
 * duration, seekable inside itself, reachable by no epoch the hub holds — and
 * until 1.0.511 it avoided the question by opening in a modal ON TOP of the
 * frame, which is how two authorities end up each believing they decide what is
 * on screen: the session went on streaming behind a picture nobody could see.
 *
 * The operator asked for the clip to be in the SAME frame
 * (*"L'importante è che sta sullo stesso player"*), and that is the moment the
 * question has to be answered rather than side-stepped.
 *
 * So the frame's occupant is ONE value with one `clip` arm, and the detachment
 * is enforced where it cannot be forgotten:
 *
 *  - HERE, by the type: `session` and `clip` are arms of one union, so nothing
 *    can be in both.
 *  - In `clips-surface.ts` (`resolveClipsSurface`), which is the ONE thing
 *    that decides what the chrome is and what it may command. `clipHeld` takes
 *    the scrub away, and `TheaterTimeline` obeys it at the source: the drag
 *    still scrolls the list, and never reaches the player.
 *
 *    Two earlier attempts are worth naming, because both read as verification
 *    and neither was. This paragraph used to claim the enforcement lived in
 *    `playback-machine.ts`, "by a `clip` MODE whose reducer answers NOTHING" —
 *    that file does not contain the word `clip`. Then a second gate was added
 *    in the screen, deciding the same question separately, while
 *    `resolveClipsSurface` was computed and read for ONE of its five fields.
 *    The operator found both the same way: a clip open, and the timeline still
 *    seeking underneath it.
 *  - In `battery-stream-gate.ts`, by `shouldMountLiveView` returning TRUE when
 *    there is a clip to open.
 *
 *    A third stale claim lived here too: that the gate returns false for a
 *    `clip` mode "so the live peer is TORN DOWN". That file has never
 *    contained the word `clip`, and the real effect was the reverse of the
 *    intent — on 3628 (battery, asleep) the player was simply not mounted, so
 *    `liveRef.current?.playClip` dropped every command. The trace stopped at
 *    `open: port`, `hasPlayer: false`, in silence.
 *
 *    A clip needs a SURFACE, and giving it one wakes nothing: the bytes are a
 *    file the hub serves, and the page opens on it through `initialClip`
 *    without ever dialling the live edge — the guarantee `initialSeekMs`
 *    already carried for a deep-link seek.
 *
 * ## What a `refused` stage is, and why it is not a clip arm
 *
 * A row with `playable: false` must never become a stage that plays nothing.
 * It does not take the frame at all: the session keeps the picture and the
 * refusal is carried to the surface as words (D569 § 10's discipline, one
 * surface over).
 *
 * Pure: no React, no i18n, no network.
 */

import { cheapestClipProfile, type ClipProfile } from './clip-quality.js'
import { isPlayable, type Clip } from './clip-model.js'

/**
 * Whether a clip may be looped, and the claim that decision rests on.
 *
 * Looping is an assertion about the clip's END. `Clip.inProgress` says in as
 * many words that `endMs` is not one: the camera's index entry holds whatever
 * it held when the file was opened — measured on 592 (2026-09-20) a growing
 * file reported the same `endTime` for eight minutes. A player told to repeat
 * such a file restarts it at a boundary nobody knows, forever, and every pass
 * is a different length. So it plays ONCE, to whatever end the bytes actually
 * have, and the surface says why it did not loop.
 */
export type ClipLoopReason = 'closed' | 'in-progress'

export interface ClipLoopDecision {
  readonly loop: boolean
  readonly reason: ClipLoopReason
}

export function resolveClipLoop(clip: Clip): ClipLoopDecision {
  return clip.inProgress === true
    ? { loop: false, reason: 'in-progress' }
    : { loop: true, reason: 'closed' }
}

/**
 * The frame's occupant.
 *
 * `session` — the embed session, live or recorded. The playback machine owns
 * what it is showing and this module says nothing about it.
 * `clip` — a file holds the frame. The session is detached and torn down.
 * `refused` — the operator pressed a row the provider will not serve. The
 * session keeps the frame; this arm exists so the reason has somewhere to be.
 */
export type ClipStage =
  | { readonly kind: 'session' }
  | {
      readonly kind: 'clip'
      readonly clipId: string
      readonly deviceId: number
      /** The cheapest copy the ROW resolved — never `auto`, never `high`
       *  unless `high` is the only twin (D559, `clip-quality.ts`). */
      readonly profile: ClipProfile | null
      readonly loop: boolean
      readonly loopReason: ClipLoopReason
      /** Carried so the frame can title itself without re-finding the row. */
      readonly startMs: number
      readonly endMs: number
      /** `endMs` is not this clip's end. The surface must not draw a duration
       *  from it, and the loop is off. */
      readonly inProgress: boolean
    }
  | { readonly kind: 'refused'; readonly clipId: string; readonly reason: string | null }

export const initialClipStage: ClipStage = { kind: 'session' }

/** True only in the one arm where a file is on screen. Every consumer that
 *  detaches something asks THIS, so "detached" has one definition. */
export function stageHoldsClip(stage: ClipStage): boolean {
  return stage.kind === 'clip'
}

/**
 * Hand the frame to `clip` — or refuse it, from the row alone.
 *
 * The previous stage is not read: attaching is total. Handing the frame from
 * one clip straight to the next (the sequencer, the prev/next buttons) is the
 * same transition as handing it over from the session, and a second code path
 * for "already holding one" is where a resume target goes stale.
 */
export function clipStageAttach(_previous: ClipStage, clip: Clip): ClipStage {
  if (!isPlayable(clip)) {
    return { kind: 'refused', clipId: clip.clipId, reason: clip.unplayableReason ?? null }
  }
  const loop = resolveClipLoop(clip)
  return {
    kind: 'clip',
    clipId: clip.clipId,
    deviceId: clip.deviceId,
    profile: cheapestClipProfile(clip),
    loop: loop.loop,
    loopReason: loop.reason,
    startMs: clip.startMs,
    endMs: clip.endMs,
    inProgress: clip.inProgress === true,
  }
}

/** Give the frame back. Always the same value, so a close is idempotent. */
export function clipStageClose(_stage: ClipStage): ClipStage {
  return initialClipStage
}

/**
 * The next (or previous) clip the frame can actually play, in the LIST's own
 * order.
 *
 * ## Why this skips, and why it does not wrap
 *
 * A camera with no continuous recording has no coverage, so it has no time
 * axis to step along — "navigate the clips" is a step through a LIST, and the
 * list's order (newest first, as `buildClipAxis` lays it out) is the only order
 * there is. A step that lands on a row the provider refused would make the
 * button produce a refusal, so refused rows are stepped OVER; they stay in the
 * list, with their reason, because hiding them is how a camera full of clips
 * gets told it has none.
 *
 * It does not wrap: an operator holding `next` at the oldest clip must be able
 * to tell that they have reached the end, and a silent jump back to the newest
 * is a lie about where they are.
 */
export function clipStageStep(
  clips: readonly Clip[],
  currentClipId: string,
  step: 1 | -1,
): Clip | null {
  const at = clips.findIndex((c) => c.clipId === currentClipId)
  if (at < 0) return null
  for (let i = at + step; i >= 0 && i < clips.length; i += step) {
    const candidate = clips[i]
    if (candidate !== undefined && isPlayable(candidate)) return candidate
  }
  return null
}

/**
 * Does the separate sheet have anything to show?
 *
 * Only a REFUSAL, now that every playable clip goes to the camera's own frame
 * (D586 deleted the `url` kind, which was unreachable by construction). The
 * sheet stopped being a second player and became the one place a provider's
 * "I will not serve this, and here is why" has to be said — the frame cannot
 * say it, because there is nothing to put in the frame.
 */
export function clipSheetShows(stage: ClipStage): boolean {
  return stage.kind === 'refused'
}
