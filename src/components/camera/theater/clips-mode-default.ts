/**
 * clips-mode-default — which body a camera OPENS on.
 *
 * > *"se una camera è in modalità eventi e non continua, la modalità
 * > predefinita deve essere la clip mode"* — the operator, 2026-09-23.
 *
 * The continuous timeline is drawn from OUR recorder's footage. On a camera
 * the hub records only on events there is no continuum to scrub: the axis is
 * mostly gaps, and every gesture along it lands in one. The clips body is what
 * that camera actually has, so it is what it should open on.
 *
 * ## Unknown is not `continuous`
 *
 * `useRecordingMode` answers `null` for a camera it could not READ — a cap
 * that is absent, a non-admin session, a hub that did not reply — and that is
 * deliberately distinct from `'off'` (D590). Folding `null` into "not events"
 * would make an unreadable camera open on an axis that may have nothing on it,
 * from a query that never answered (D315). So this function answers `null`
 * too, and the caller does nothing at all until a real answer arrives.
 *
 * ## It is a DEFAULT, not a rule
 *
 * The answer applies once per camera and never again. The operator's own
 * toggle outranks it from the moment he touches it: a default that keeps
 * re-asserting itself is a control that fights its owner, and this timeline
 * has shipped that defect twice.
 *
 * Pure: no React, no i18n, no network.
 */
import type { RecordingMode } from '../../../data/use-recording.js'

/**
 * Should this camera open on the clips body?
 *
 * `null` means "no answer yet" — the caller must leave the current body alone.
 */
export function clipsModeDefaultFor(mode: RecordingMode | null): boolean | null {
  if (mode === null) return null
  // `off` is the same situation as `events`, more so: the hub holds no
  // continuous footage for this camera at all, and the clips-surface rule
  // already says a camera without recording is navigated by its clips.
  return mode === 'events' || mode === 'off'
}
