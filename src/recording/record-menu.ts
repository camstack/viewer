/**
 * record-menu — what the REC button's menu offers.
 *
 * The button used to START one thing; now it opens a short list, and WHICH list
 * is a rule of the mode and the role:
 *
 *   • live      — a snapshot of the picture on screen, plus the live clip
 *                 recording this button has always started (kept: removing a
 *                 working feature was not part of the redesign).
 *   • playback  — select a period to export, a snapshot, and — admins only —
 *                 delete a recorded period.
 *
 * Pure, so "a non-admin never sees Delete" is asserted, not read off JSX.
 */
import type { PlaybackMode } from './playback-machine.js'

export type RecordMenuAction = 'snapshot' | 'selectExport' | 'deleteRecording' | 'recordLive'

export interface RecordMenuInput {
  readonly mode: PlaybackMode
  /** The hub has CONFIRMED an admin (`useIsAdmin`): unknown is false. */
  readonly isAdmin: boolean
  /** The player can hand over its current frame. */
  readonly canSnapshot: boolean
  /** A selection can be armed here (recorded mode with a known epoch). */
  readonly canSelect: boolean
  /** The live clip recorder is wired (live mode, a picture to record). */
  readonly canRecordLive: boolean
}

export function resolveRecordMenu(input: RecordMenuInput): readonly RecordMenuAction[] {
  if (input.mode === 'live') {
    return [
      ...(input.canSnapshot ? (['snapshot'] as const) : []),
      ...(input.canRecordLive ? (['recordLive'] as const) : []),
    ]
  }
  return [
    ...(input.canSelect ? (['selectExport'] as const) : []),
    ...(input.canSnapshot ? (['snapshot'] as const) : []),
    ...(input.canSelect && input.isAdmin ? (['deleteRecording'] as const) : []),
  ]
}

/**
 * Whether the bar offers "send this frame to training".
 *
 * Only on a paused recorded frame — and never while a selection is armed: the
 * bar then carries Save / Delete and the jog, and a training collect beside
 * them is a second act on a frame the operator is no longer looking at.
 */
export function trainingCollectVisible(input: {
  readonly isLive: boolean
  readonly paused: boolean
  readonly selectionArmed: boolean
}): boolean {
  return !input.isLive && input.paused && !input.selectionArmed
}
