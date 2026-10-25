/**
 * snooze-options — the pure half of the viewer's snooze panel: the durations it
 * offers, the classes it can narrow to, the payload it sends, and how a live
 * window is described back to the person who opened it.
 *
 * RN-free on purpose (same as `nc-tabs`), so the wording, the arithmetic and
 * the WIRE SHAPE are unit-tested in the node environment rather than through a
 * component. The panel authoring its own payload inline is how a field ends up
 * only ever exercised by tapping the screen.
 *
 * A snooze is the one control in this app whose FAILURE MODE IS SILENCE. So the
 * panel never shows a window without saying when it ends, never offers a
 * duration the hub would refuse, and never sends a narrowing it did not mean:
 * every optional field is ABSENT unless it was chosen, because absence carries
 * meaning on this contract (no classes = all classes).
 */
import { pickerForCondition } from '../../components/notifications/condition-taxonomy.js'
import type {
  NcSnooze,
  NcSnoozeInput,
  NcSnoozeScope,
  NcTaxonomy,
} from '../../data/notification-center.js'
import {
  NC_DEFAULT_SNOOZE_MINUTES,
  NC_SNOOZE_MAX_MINUTES,
  NC_SNOOZE_OPTIONS_MAX,
} from '../../data/notification-center.js'

/** One preset button. */
export interface SnoozeDuration {
  readonly minutes: number
  /** i18n key under `v2.nc.snooze.durations`. */
  readonly labelKey: string
}

/**
 * The offered windows — the SAME three the hub falls back to for a rule that
 * names no `snoozeOptions`, so the panel and a notification's snooze buttons
 * never offer two different vocabularies for the same act.
 *
 * Deliberately short: the common case is "for a few minutes, while I take the
 * bins out". The 24h ceiling exists in the schema as a bound, not as something
 * to suggest — a long window is authored by repeating a short one, which is a
 * decision taken again rather than one made once and forgotten.
 */
export const SNOOZE_DURATIONS: readonly SnoozeDuration[] = [
  { minutes: 10, labelKey: 'm10' },
  { minutes: 30, labelKey: 'm30' },
  { minutes: 60, labelKey: 'h1' },
]

/** A duration the hub will accept. Guards the panel against offering one it
 *  would reject — the schema's ceiling and this list must not drift apart. */
export function isOfferableDuration(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= NC_SNOOZE_MAX_MINUTES
}

/** Whether a window is silencing anything at `nowMs`. Expiry is a comparison. */
export function isActive(snooze: NcSnooze, nowMs: number): boolean {
  return nowMs >= snooze.startedAt && nowMs < snooze.expiresAt
}

/** Active windows first, then the most recently opened. */
export function sortSnoozes(snoozes: readonly NcSnooze[], nowMs: number): readonly NcSnooze[] {
  // Copy-then-`.sort`, not `.toSorted`: Hermes has never shipped the ES2023
  // copying methods, so `.toSorted` is a TypeError on the device. The spread
  // keeps the caller's array untouched, which is what `.toSorted` was for.
  return [...snoozes].sort((a, b) => {
    const activeDiff = Number(isActive(b, nowMs)) - Number(isActive(a, nowMs))
    return activeDiff !== 0 ? activeDiff : b.startedAt - a.startedAt
  })
}

/** Whole minutes left, floored at 0 — never a negative countdown. */
export function minutesRemaining(snooze: NcSnooze, nowMs: number): number {
  return Math.max(0, Math.ceil((snooze.expiresAt - nowMs) / 60_000))
}

/** i18n key + params for a window's "ends in …" line. */
export interface SnoozeRemainingLabel {
  readonly key: string
  readonly params: Readonly<Record<string, number>>
}

/**
 * How long is left, in the coarsest unit that is still honest: a window with
 * 95 minutes left reads "1h 35m", one with 4 reads "4m", and one that has
 * closed says so rather than counting down to a negative.
 */
export function remainingLabel(snooze: NcSnooze, nowMs: number): SnoozeRemainingLabel {
  const total = minutesRemaining(snooze, nowMs)
  if (total === 0) return { key: 'ended', params: {} }
  if (total < 60) return { key: 'minutes', params: { minutes: total } }
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (minutes === 0) return { key: 'hours', params: { hours } }
  return { key: 'hoursMinutes', params: { hours, minutes } }
}

/** i18n key for what a window covers — the scope, in the words it was set with. */
export function scopeLabelKey(scope: NcSnoozeScope): string {
  return `v2.nc.snooze.scope.${scope}`
}

/**
 * May this caller ask for a GLOBAL window?
 *
 * Mirrors the hub's `canSetGlobal` so the panel does not OFFER what the server
 * will refuse. It is deliberately a mirror of the decision and not the decision
 * itself: the hub re-checks, and a client that got this wrong can only ever
 * produce a rejected request, never an unauthorised silence.
 */
export function canOfferGlobal(input: {
  readonly scope: NcSnoozeScope
  readonly ruleAllowsGlobal?: boolean
  readonly isAdmin: boolean
}): boolean {
  if (input.isAdmin) return true
  if (input.scope !== 'rule') return false
  return input.ruleAllowsGlobal === true
}

// ── The class narrowing ────────────────────────────────────────────────────

/** One class chip. */
export interface SnoozeClassOption {
  readonly value: string
  readonly label: string
}

/**
 * The classes a window can be narrowed to, flattened from the SHARED picker the
 * `classes` RULE condition uses — never a local list. Two surfaces that name
 * the same class differently is how an operator concludes "person" and "Person"
 * are two things.
 *
 * Empty when the hub served no taxonomy (an older hub): the selector then
 * disappears and every window covers every class, which is the behaviour that
 * existed before this control did.
 */
export function snoozeClassOptions(taxonomy: NcTaxonomy | undefined): readonly SnoozeClassOption[] {
  const picker = pickerForCondition('classes', taxonomy)
  if (picker === null) return []
  const seen = new Set<string>()
  const options: SnoozeClassOption[] = []
  for (const group of picker.groups) {
    for (const option of group.options) {
      if (seen.has(option.value)) continue
      seen.add(option.value)
      options.push({ value: option.value, label: option.label })
    }
  }
  return options
}

/** What the window is aimed at: the scope, and the id that scope needs. */
export interface SnoozeTarget {
  readonly scope: NcSnoozeScope
  readonly ruleId: string | null
  readonly deviceId: number | null
}

/** What the panel has been filled in with. */
export interface SnoozeDraft extends SnoozeTarget {
  readonly durationMinutes: number
  readonly global: boolean
  readonly summary: boolean
  /** Chosen classes. Empty = every class (the field is then omitted). */
  readonly classes: readonly string[]
}

/**
 * Can this window be opened at all?
 *
 * A scoped window with nothing to scope to matches NOTHING — the hub refuses
 * it, so the button refuses first rather than turning a mis-tap into an error
 * toast. `all` needs nothing.
 */
export function isSnoozeTargetComplete(target: SnoozeTarget): boolean {
  if (target.scope === 'rule') return target.ruleId !== null
  if (target.scope === 'device') return target.deviceId !== null
  return true
}

/**
 * Serialize the draft into the wire {@link NcSnoozeInput}.
 *
 * Every field is ABSENT unless it was chosen, because absence carries meaning
 * on this contract: no `classes` = all classes, no `summary` = the hub's ON,
 * no `global` = personal. Writing a "default" in would freeze today's default
 * into the window.
 *
 * The id for a scope the draft is not in is dropped rather than carried: a
 * `deviceId` riding along on an `all` window is a claim about what is silenced
 * that the panel never made.
 */
export function buildSnoozeInput(draft: SnoozeDraft): NcSnoozeInput {
  return {
    scope: draft.scope,
    ...(draft.scope === 'rule' && draft.ruleId !== null ? { ruleId: draft.ruleId } : {}),
    ...(draft.scope === 'device' && draft.deviceId !== null ? { deviceId: draft.deviceId } : {}),
    durationMinutes: draft.durationMinutes,
    // Only ever asked for where the hub would allow it; it re-checks regardless.
    ...(draft.global ? { global: true } : {}),
    ...(draft.summary ? {} : { summary: false }),
    ...(draft.classes.length > 0 ? { classes: [...draft.classes] } : {}),
  }
}

// ── A rule's snooze BUTTONS (the rule editor's Advanced sub-screen) ────────

/**
 * The palette a rule's snooze buttons are picked from — the admin's
 * `NC_SNOOZE_BUTTON_CHOICES`, so the two editors offer one vocabulary. It
 * contains every hub default, so a rule on the defaults shows them checked.
 */
export const NC_SNOOZE_BUTTON_CHOICES: readonly number[] = [5, 10, 15, 30, 60, 120, 240, 480]

/**
 * Flip one minute in a rule's `snoozeOptions`, returning a SORTED copy.
 *
 * `undefined` (the hub's defaults) starts from those defaults: the chips show
 * the defaults checked, so the first tap edits what the operator sees. A fifth
 * button is refused — the hub caps the list at {@link NC_SNOOZE_OPTIONS_MAX}.
 */
export function toggleSnoozeMinute(list: readonly number[] | undefined, minutes: number): readonly number[] {
  const chosen = list ?? NC_DEFAULT_SNOOZE_MINUTES
  const next = chosen.includes(minutes)
    ? chosen.filter((m) => m !== minutes)
    : snoozeToggleRefused(list, minutes)
      ? [...chosen]
      : [...chosen, minutes]
  // Sorted on EVERY path — a stored list need not be.
  return next.sort((a, b) => a - b)
}

/** Would this tap ADD a fifth button? The toggle refuses it, and the chip row
 *  says so rather than doing nothing silently. */
export function snoozeToggleRefused(list: readonly number[] | undefined, minutes: number): boolean {
  const chosen = list ?? NC_DEFAULT_SNOOZE_MINUTES
  return !chosen.includes(minutes) && chosen.length >= NC_SNOOZE_OPTIONS_MAX
}

/** i18n key (under `v2.nc.snooze.remaining`) + params for one chip: whole
 *  hours read as hours. */
export function snoozeMinuteLabel(minutes: number): SnoozeRemainingLabel {
  if (minutes >= 60 && minutes % 60 === 0) return { key: 'hours', params: { hours: minutes / 60 } }
  return { key: 'minutes', params: { minutes } }
}
