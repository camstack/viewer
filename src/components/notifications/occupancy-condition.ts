/**
 * occupancy-condition — pure, RN-free logic behind the occupancy condition
 * widget (the viewer port of the admin `OccupancyField`). Split out of the
 * component for the reason every other `*-editor.ts` in this folder is: what
 * gets STORED is the part worth asserting, and it is asserted directly in the
 * node test env.
 *
 * Three behaviours here are not cosmetic:
 *
 *  1. **A deleted zone stays visible.** A stored `zoneId` the hub no longer
 *     serves is surfaced as an explicitly-unknown, removable choice — never
 *     tidied into "— whole frame —". Silently rewriting the scope of the rule
 *     the operator is looking at is worse than showing a dangling id.
 *  2. **The hold defaults to 15s, never 0.** `sustainSeconds: 0` is legal and
 *     means "fire on the first frame that crosses" — precisely the chatter the
 *     debounce exists to prevent. It stays reachable, and it is called out.
 *  3. **`classes` and `occupancy` cannot coexist.** They AND, and an occupancy
 *     subject carries exactly ONE class name, so `classes:['vehicle']` beside
 *     `occupancy.className:'person'` is a rule that can never fire and says
 *     nothing about why. {@link reconcileOccupancyClasses} resolves it at the
 *     one place a rule is serialized.
 */
import { pickerForCondition, knownValues } from './condition-taxonomy.js'
import type { NcZoneRef } from '../../data/zones.js'
import type {
  NcConditions,
  NcOccupancyCondition,
  NcTaxonomy,
} from '../../data/notification-center.js'

/** The op vocabulary, mirroring `NcOccupancyConditionSchema.op`. */
export const NC_OCCUPANCY_OP_VALUES = ['became-occupied', 'became-free', '>=', '<='] as const
export type NcOccupancyOp = NcOccupancyCondition['op']

/** Narrow a raw string to a known op (no cast). */
export function parseOccupancyOp(value: string): NcOccupancyOp | undefined {
  return NC_OCCUPANCY_OP_VALUES.find((op) => op === value)
}

/** An EDGE op fires on a crossing; a level op tests the count itself. The
 *  number field means "threshold" for the first and "count" for the second. */
export function isEdgeOccupancyOp(op: NcOccupancyOp): boolean {
  return op === 'became-occupied' || op === 'became-free'
}

/** i18n sub-key for the number field's label, which flips with the op. */
export function occupancyCountLabelKey(op: NcOccupancyOp): 'threshold' | 'count' {
  return isEdgeOccupancyOp(op) ? 'threshold' : 'count'
}

/** Cap bounds on the debounce window. */
export const NC_OCCUPANCY_SUSTAIN_MIN_SEC = 0
export const NC_OCCUPANCY_SUSTAIN_MAX_SEC = 3600
/** The offered default. NOT the schema floor — see the module docblock. */
export const NC_OCCUPANCY_SUSTAIN_DEFAULT_SEC = 15

/** Schema defaults — an untouched sub-field must author exactly these. */
export const NC_OCCUPANCY_DEFAULTS: NcOccupancyCondition = {
  op: 'became-occupied',
  count: 1,
  sustainSeconds: NC_OCCUPANCY_SUSTAIN_DEFAULT_SEC,
}

/** What the widget SHOWS for an unset condition — without authoring it. */
export function occupancyOrDefaults(value: NcOccupancyCondition | undefined): NcOccupancyCondition {
  return value ?? NC_OCCUPANCY_DEFAULTS
}

/** True when the hold is 0s: the edge fires the instant the count crosses. */
export function occupancySustainIsInstant(value: NcOccupancyCondition | undefined): boolean {
  return value !== undefined && value.sustainSeconds === 0
}

/** A patch over the composite condition. A key present with `undefined` CLEARS
 *  the (optional) scope field; an absent key leaves it alone. */
export interface NcOccupancyPatch {
  readonly zoneId?: string | undefined
  readonly className?: string | undefined
  readonly op?: NcOccupancyOp
  readonly count?: number
  readonly sustainSeconds?: number
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function has(patch: NcOccupancyPatch, key: keyof NcOccupancyPatch): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key)
}

/**
 * Apply a sub-field edit, seeding from the defaults when nothing is stored yet.
 * The result is always in-bounds for `NcOccupancyConditionSchema`, and a
 * cleared scope key is OMITTED rather than written as an explicit `undefined`
 * (which survives a merge patch as a deliberate erase and reads as authored).
 */
export function patchOccupancy(
  current: NcOccupancyCondition | undefined,
  patch: NcOccupancyPatch,
): NcOccupancyCondition {
  const base = occupancyOrDefaults(current)
  const zoneId = has(patch, 'zoneId') ? patch.zoneId : base.zoneId
  const className = has(patch, 'className') ? patch.className : base.className
  return {
    ...(zoneId !== undefined && zoneId.length > 0 ? { zoneId } : {}),
    ...(className !== undefined && className.length > 0 ? { className } : {}),
    op: patch.op ?? base.op,
    count: clampInt(patch.count ?? base.count, 0, Number.MAX_SAFE_INTEGER),
    sustainSeconds: clampInt(
      patch.sustainSeconds ?? base.sustainSeconds,
      NC_OCCUPANCY_SUSTAIN_MIN_SEC,
      NC_OCCUPANCY_SUSTAIN_MAX_SEC,
    ),
  }
}

/** One offered scope value. `unknown` = stored by the rule, not offered by the
 *  hub — kept so the operator can SEE it and choose to drop it. */
export interface NcOccupancyChoice {
  readonly value: string
  readonly label: string
  readonly unknown: boolean
}

function withUnknown(
  choices: readonly NcOccupancyChoice[],
  selected: string | undefined,
): { readonly choices: readonly NcOccupancyChoice[]; readonly unknown: string | undefined } {
  // An EMPTY catalogue is "not loaded / no camera selected", never "deleted" —
  // flagging in that state would mark every zone unknown on first paint.
  if (selected === undefined || choices.length === 0) return { choices, unknown: undefined }
  if (choices.some((choice) => choice.value === selected)) return { choices, unknown: undefined }
  return {
    choices: [...choices, { value: selected, label: selected, unknown: true }],
    unknown: selected,
  }
}

/**
 * The zone choices for the scope picker: the REAL names from `zones.listZones`
 * across the rule's cameras, deduped, plus the stored-but-unserved zone.
 */
export function occupancyZoneChoices(
  zones: readonly NcZoneRef[],
  selectedZoneId: string | undefined,
): { readonly choices: readonly NcOccupancyChoice[]; readonly unknownZoneId: string | undefined } {
  const seen = new Set<string>()
  const choices: NcOccupancyChoice[] = []
  for (const zone of zones) {
    if (seen.has(zone.id)) continue
    seen.add(zone.id)
    choices.push({ value: zone.id, label: zone.name, unknown: false })
  }
  const merged = withUnknown(choices, selectedZoneId)
  return { choices: merged.choices, unknownZoneId: merged.unknown }
}

/**
 * The class choices, flattened from the SHARED picker — never a local class
 * list, so the phone and the admin can never disagree about what "person" is
 * called.
 *
 * It is the `occupancy` picker, not the `classes` one: MACRO CLASSES ONLY. An
 * occupancy count is read straight out of the snapshot's `byClass`, which is
 * keyed on macros, so a sub-type ("car") names a key that does not exist and the
 * counter stays 0 forever. Two rules on device 102 shipped that way and were
 * silent for a day (2026-08-12).
 *
 * A stored sub-type still comes back as an `unknown` choice — the widget renders
 * it with the `classMissing` warning — because hiding the dead value would blank
 * the control for exactly the rules that need fixing.
 */
export function occupancyClassChoices(
  taxonomy: NcTaxonomy | undefined,
  selectedClassName: string | undefined,
): {
  readonly choices: readonly NcOccupancyChoice[]
  readonly unknownClassName: string | undefined
} {
  const picker = pickerForCondition('occupancy', taxonomy)
  const choices: NcOccupancyChoice[] =
    picker === null
      ? []
      : picker.groups.flatMap((group) =>
          group.options.map((option) => ({
            value: option.value,
            label: option.label,
            unknown: false,
          })),
        )
  const known = picker === null ? new Set<string>() : knownValues(picker)
  const merged = withUnknown(
    choices,
    selectedClassName !== undefined && known.has(selectedClassName) ? undefined : selectedClassName,
  )
  return { choices: merged.choices, unknownClassName: merged.unknown }
}

/**
 * Resolve the `classes` × `occupancy` contradiction, in the ONE direction that
 * keeps intent: a single authored class becomes the occupancy scope (which is
 * what the operator meant), then the class conditions are dropped.
 *
 * They are dropped rather than kept because an occupancy subject carries a
 * single class name — the edge's own — so `classes` can only ever narrow the
 * rule to nothing or restate what `occupancy.className` already says, and
 * `classesExclude` can only ever subtract the one class being counted. A rule
 * that cannot fire is not a filter, it is a silent outage.
 *
 * Returns the SAME object when there is no occupancy condition, so a rule that
 * does not use the feature is untouched by it.
 */
export function reconcileOccupancyClasses(conditions: NcConditions): NcConditions {
  const occupancy = conditions.occupancy
  if (occupancy === undefined) return conditions
  const { classes, classesExclude, ...rest } = conditions
  const adopted =
    occupancy.className === undefined && classes !== undefined && classes.length === 1
      ? classes[0]
      : undefined
  return {
    ...rest,
    occupancy: adopted === undefined ? occupancy : { ...occupancy, className: adopted },
  }
}

/** The class values {@link reconcileOccupancyClasses} would drop — what the
 *  editor tells the operator BEFORE the save, instead of after. */
export function occupancyDroppedClasses(conditions: NcConditions): readonly string[] {
  if (conditions.occupancy === undefined) return []
  return [...(conditions.classes ?? []), ...(conditions.classesExclude ?? [])]
}
