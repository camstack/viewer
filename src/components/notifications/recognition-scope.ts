/**
 * recognition-scope — pure, RN-free helpers for the two conditions whose EMPTY
 * list is an authored value rather than an absence: `identities` (known faces)
 * and `plates` (known plates), and the question the grouping hints ask of them
 * ({@link ruleHasRecognitionScope}).
 *
 * THE DISTINCTION IS SEMANTIC, and every generic "is this empty" path in the
 * editor gets it wrong by default:
 *
 * | state | `identities` | `plates` |
 * | --- | --- | --- |
 * | off | absent | absent |
 * | any known | `[]` | `{ values: [] }` |
 * | specific | `['<uuid>', …]` | `{ values: ['AB123CD', …] }` |
 *
 * `isConditionValueEmpty` answers "empty" for BOTH the first two, so the save
 * path used to collapse "only people I know" into "anybody" and "any readable
 * plate" into "any vehicle at all" — a rule that quietly widened itself every
 * time it was opened on a phone. {@link isAuthoredEmptyScope} is the exception
 * those paths consult; nothing else may special-case these keys.
 *
 * The faces are drawn by the scope field since 2026-10-01 (an empty Only list
 * is "any known face" — `identityScopeDraftOf` in `rule-scope-form.ts`); the
 * plate widget still reads its three states from here.
 */
import type { NcConditions, NcPlateMatcher } from '../../data/notification-center.js'

/** The three authorable states of a recognition scope. */
export type NcRecognitionMode = 'off' | 'anyKnown' | 'specific'

/** The modes in the order the segmented control offers them. */
export const NC_RECOGNITION_MODES: readonly NcRecognitionMode[] = ['off', 'anyKnown', 'specific']

/** Narrow a raw segment value to a mode (no cast). */
export function parseRecognitionMode(value: string): NcRecognitionMode | undefined {
  return NC_RECOGNITION_MODES.find((mode) => mode === value)
}

/**
 * The `NcConditions` keys whose EMPTY value is authored, not unset.
 *
 * `identitiesExclude` is deliberately NOT here: the hub reads an empty exclude
 * list as "exclude nobody", which is exactly what absence means, so pruning it
 * loses nothing and keeping it would leave a condition the operator emptied
 * stuck on the rule with no way to remove it.
 */
export const NC_AUTHORED_EMPTY_SCOPE_KEYS = { identities: true, plates: true } as const
export type NcAuthoredEmptyScopeKey = keyof typeof NC_AUTHORED_EMPTY_SCOPE_KEYS

/** True when `key` is one whose empty value carries meaning. */
export function isAuthoredEmptyScopeKey(key: string): key is NcAuthoredEmptyScopeKey {
  return Object.prototype.hasOwnProperty.call(NC_AUTHORED_EMPTY_SCOPE_KEYS, key)
}

/**
 * True when this `(key, value)` pair is an EMPTY-but-AUTHORED recognition scope
 * — the one case a generic emptiness check must not prune.
 *
 * Shape-checked rather than trusted: `identities` must actually be an array and
 * `plates` an object carrying a `values` array, so a malformed value still falls
 * through to the ordinary prune instead of being written back verbatim.
 */
export function isAuthoredEmptyScope(key: string, value: unknown): boolean {
  if (!isAuthoredEmptyScopeKey(key)) return false
  if (key === 'identities') return Array.isArray(value) && value.length === 0
  if (value === null || typeof value !== 'object' || !('values' in value)) return false
  const values = value.values
  return Array.isArray(values) && values.length === 0
}

// ── plates: NcPlateMatcher | undefined ──────────────────────────────────────

/** The hub's default fuzzy tolerance when the matcher does not say. */
export const NC_PLATE_MAX_DISTANCE_DEFAULT = 1
export const NC_PLATE_MAX_DISTANCE_MIN = 0
export const NC_PLATE_MAX_DISTANCE_MAX = 3

/** Which of the three states a `plates` value represents. */
export function plateScopeMode(value: NcPlateMatcher | undefined): NcRecognitionMode {
  if (value === undefined) return 'off'
  return value.values.length === 0 ? 'anyKnown' : 'specific'
}

/** The `plates` value for a mode, preserving the plate list and the tolerance. */
export function plateScopeValue(
  mode: NcRecognitionMode,
  values: readonly string[],
  maxDistance: number,
): NcPlateMatcher | undefined {
  if (mode === 'off') return undefined
  if (mode === 'anyKnown') return { values: [], maxDistance }
  return { values: [...values], maxDistance }
}

// ── does the rule depend on a NAME? ─────────────────────────────────────────

/**
 * Does the rule's match depend on RECOGNITION — a face or plate scope?
 *
 * PRESENT, not non-empty: an empty identity list is "only known faces" and
 * waits for a name like a named one. Read by the two "Immediate, grouped"
 * hints (D692): plain Immediate fires only if the name is already known, and a
 * grouped rule drops a subject not recognised within its window.
 */
export function ruleHasRecognitionScope(conditions: NcConditions): boolean {
  return conditions.identities !== undefined || conditions.plates !== undefined
}
