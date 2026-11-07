/**
 * Timed run (`timed-run` cap) — the pure half of the one-tap "quick run".
 *
 * Shapes mirror `TimedRunStatusSchema` / `TimedRunResultSchema` in
 * `camstack-server/packages/types/src/capabilities/timed-run.cap.ts` (UI subset).
 * Kept free of React so the visibility rule, the refusal wording and the
 * countdown are specced without a mount.
 */

/** Kebab cap name a device advertises in `DeviceInfo.features`. */
export const TIMED_RUN_FEATURE = 'timed-run'

export type TimedRunUnit = 's' | 'min'

export interface TimedRunQuickRun {
  readonly duration: number
  readonly unit: TimedRunUnit
}

export interface TimedRunStatus {
  /** Epoch ms the pending off is due; null while nothing is armed. */
  readonly activeUntil: number | null
  /** The one-tap run of this device; null = no button. */
  readonly quickRun: TimedRunQuickRun | null
}

export type TimedRunRefusal = 'unsupported-device' | 'over-max' | 'command-failed'

export type TimedRunOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: TimedRunRefusal }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function toQuickRun(v: unknown): TimedRunQuickRun | null {
  if (!isRecord(v)) return null
  const { duration, unit } = v
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return null
  if (unit !== 's' && unit !== 'min') return null
  return { duration, unit }
}

/** Narrow a `timedRun.getStatus` payload; null when it is not a usable status. */
export function toTimedRunStatus(raw: unknown): TimedRunStatus | null {
  if (!isRecord(raw)) return null
  const until = raw.activeUntil
  return {
    activeUntil: typeof until === 'number' && Number.isFinite(until) ? until : null,
    quickRun: toQuickRun(raw.quickRun),
  }
}

/** True when the device advertises the timed-run cap (never inferred from its type). */
export function hasTimedRun(features: readonly string[]): boolean {
  return features.includes(TIMED_RUN_FEATURE)
}

/**
 * The button shows only for a device that has the cap AND whose status ANSWERED
 * with a quick run.
 * `quickRun: null` (device gone, type without a timed run) and an unanswered
 * status both render nothing.
 */
export function quickRunToShow(status: TimedRunStatus | null | undefined): TimedRunQuickRun | null {
  return status?.quickRun ?? null
}

/** Whole seconds left until `activeUntil`, never negative; null when nothing is armed. */
export function remainingSeconds(activeUntil: number | null, now: number): number | null {
  if (activeUntil === null) return null
  return Math.max(0, Math.ceil((activeUntil - now) / 1000))
}

/** `m:ss` under an hour, `h:mm:ss` from one hour. */
export function formatRemaining(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** Narrow a `runFor` result; an unreadable one is a refusal, never a silent success. */
export function toTimedRunOutcome(raw: unknown): TimedRunOutcome {
  if (isRecord(raw) && raw.ok === true) return { ok: true }
  if (isRecord(raw) && raw.ok === false) {
    const r = raw.reason
    if (r === 'unsupported-device' || r === 'over-max' || r === 'command-failed') {
      return { ok: false, reason: r }
    }
  }
  return { ok: false, reason: 'command-failed' }
}

/** i18n key of the sentence that says why a run was refused. */
export function refusalMessageKey(reason: TimedRunRefusal): string {
  switch (reason) {
    case 'over-max':
      return 'v2.accessories.timedRun.overMax'
    case 'unsupported-device':
      return 'v2.accessories.timedRun.unsupported'
    case 'command-failed':
      return 'v2.accessories.timedRun.commandFailed'
  }
}
