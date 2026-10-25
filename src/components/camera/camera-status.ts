/**
 * camera-status — the pure status-dot resolver shared by the cameras list card.
 *
 * The footer status dot communicates a camera's current operational state with a
 * single colour, resolved by a fixed priority (highest first):
 *   1. `disabled`  → BLACK   — operator soft-disabled the device (admin off).
 *   2. `offline`   → GREY    — not disabled but not currently reachable.
 *   3. recording   → RED     — online AND recording mode `continuous` (always-on).
 *                 → BLUE    — online AND recording mode `events` (on-motion).
 *   4. `online`    → GREEN   — online, recording off.
 *
 * A fifth state sits beside those four and is NOT one of them: the recording
 * mode could not be read at all. It gets its own kind and a muted colour,
 * because a failed measurement rendered as a value is how a recording camera
 * came to be drawn green for a non-admin user (D315, D393, D590).
 *
 * Recording mode only matters while online, so it is evaluated after the
 * disabled/offline gates. Pure + colour-token-free at the `kind` level so it is
 * trivially unit-testable; `cameraStatusColor` maps the kind onto theme tokens.
 */
import type { RecordingMode } from '../../data/use-recording.js'
import type { ColorTokens } from '../../theme/tokens.js'

export type CameraStatusKind =
  | 'disabled'
  | 'offline'
  | 'recording-continuous'
  | 'recording-events'
  | 'online'
  /** The recording mode could not be read. Not `off`, not a fault. */
  | 'recording-unknown'

export interface CameraStatusInput {
  readonly disabled: boolean
  readonly online: boolean
  /** `null` = not known: the read failed, or has not answered yet. */
  readonly recordingMode: RecordingMode | null
}

/** Resolve the status kind by fixed priority (disabled > offline > recording > online). */
export function cameraStatusKind(input: CameraStatusInput): CameraStatusKind {
  if (input.disabled) return 'disabled'
  if (!input.online) return 'offline'
  if (input.recordingMode === 'continuous') return 'recording-continuous'
  if (input.recordingMode === 'events') return 'recording-events'
  // Deliberately AFTER the two positive modes and BEFORE `online`: an unread
  // mode may not borrow the colour of a camera we know is not recording.
  if (input.recordingMode === null) return 'recording-unknown'
  return 'online'
}

/** Black for the disabled dot — kept theme-independent (paired with a hairline
 *  ring in the card so it stays visible on a dark surface). */
export const DISABLED_DOT_COLOR = '#000000'

/** Map a status kind onto its dot colour for the active theme. */
export function cameraStatusColor(kind: CameraStatusKind, colors: ColorTokens): string {
  switch (kind) {
    case 'disabled':
      return DISABLED_DOT_COLOR
    case 'offline':
      return colors.foregroundDisabled
    case 'recording-continuous':
      return colors.danger
    case 'recording-events':
      return colors.info
    case 'online':
      return colors.success
    case 'recording-unknown':
      // Muted, not alarming: nothing is broken, we simply do not know. The
      // colour has to differ from `online`'s green or the state is invisible.
      return colors.foregroundMuted
  }
}

/**
 * The states that breathe. Offline, disabled and UNKNOWN are inert.
 *
 * Lives here rather than in the dot component because it is the same decision
 * as the kind and belongs to the same test. A pulsing dot claims liveness, and
 * a state that means "we could not read this" has none to claim.
 */
export function isAlive(kind: CameraStatusKind): boolean {
  return kind === 'online' || kind === 'recording-continuous' || kind === 'recording-events'
}
