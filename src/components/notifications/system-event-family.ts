/**
 * system-event-family — a system rule is ONE family at a time (D637).
 *
 * A system rule used to be one editor for every event kind and every filter.
 * "Eventi di sistema" carried the battery kinds under a `deviceTypes` filter
 * meant for liveness, and nothing was delivered for two weeks (D636). The viewer
 * answered with a viewer-only `battery` section; D637 answers it on the hub for
 * both editors: three families — devices, the installation, the alarm panel —
 * each with its own kinds and its own filters. Batteries are device events.
 *
 * Nothing here is restated. Which kinds a family has, in which groups and
 * order (`NC_SYSTEM_EVENT_KIND_GROUP_SPECS`), which filters it may carry
 * (`NC_SYSTEM_EVENT_FAMILY_FILTERS`) and which kinds a filter speaks about
 * (`systemEventFilterAppliesToAnyKind`) are the shared tables the hub validator
 * reads too. The admin's twin is `systemEventFilterVisibilityFor` in
 * `packages/addon-admin-ui/src/pages/system/notification-system-events.ts`.
 */
import {
  NC_BATTERY_CONSUMABLE_SYSTEM_EVENT_KINDS,
  NC_CONSUMABLE_LOW_PERCENT_MAX,
  NC_SYSTEM_EVENT_FAMILY_FILTERS,
  NC_SYSTEM_EVENT_CLASS_SPECS,
  NC_SYSTEM_EVENT_KIND_GROUP_SPECS,
  systemEventClassKinds,
  systemEventFilterAppliesToAnyKind,
} from '@camstack/types/client'
import type { NcSystemEventClassSpec, NcSystemEventFamily } from '@camstack/types'
import type { NcSystemEventCondition, NcSystemEventKind } from '../../data/notification-center.js'
// TYPE-only: `rule-editor.ts` imports this module at runtime (`formToInput`
// prunes through `pruneSystemEventForFamily`), so a value import back would be
// a require cycle metro warns about on every dev launch.
import type { NcSystemEventFilterVisibility, NcSystemEventKindOption } from './rule-editor.js'

/** A hub-served kind option: its value and the hub's (English) label. */
export interface NcServedKindOption {
  readonly value: string
  readonly label: string
}

/** The family editor's filters: the per-kind ones, inside the family's allowed set. */
export interface NcFamilyFilterVisibility extends NcSystemEventFilterVisibility {
  /** The "never these devices" list — a device-events filter only. */
  readonly excludeDevices: boolean
}

const GROUP_PREFIX = 'v2.nc.rules.editor.systemGroups'

/** The heading of one kind group (`NC_SYSTEM_EVENT_KIND_GROUP_SPECS[].id`). */
export function systemEventGroupLabelKey(groupId: string): string {
  return `${GROUP_PREFIX}.${groupId}`
}

/**
 * The chips a family's editor OFFERS, in group order — the family's own kinds
 * and nothing else, a paired CLASS (D906) as ONE chip drawn where its first
 * kind is authored.
 *
 * On an instant rule a class writes BOTH edges. On a scheduled STATE SUMMARY
 * (`summary`) a class means the bad state at the scheduled time: it writes the
 * bad edges only, is labelled as a snapshot ("… now"), and a class the summary
 * has no state source for is flagged `noSnapshot`. The admin twin is
 * `systemEventGroupOptions`.
 *
 * The label fallback of a one-edge kind is the hub's served label when it sent
 * one, else the kind itself; a class falls back to the shared table's label.
 * A selected kind outside the family is never drawn here: a legacy kind, or
 * another family's kind, makes the rule `mixed` (`ruleKindOf`), and a `mixed`
 * rule never mounts a family editor — it is shown read-only instead.
 */
export function systemEventOptionsForFamily(
  family: NcSystemEventFamily,
  served: readonly NcServedKindOption[] | undefined,
  summary = false,
): readonly NcSystemEventKindOption[] {
  return NC_SYSTEM_EVENT_KIND_GROUP_SPECS.filter((group) => group.family === family).flatMap(
    (group) => groupOptions(group.kinds, served, summary),
  )
}

/** One group's chips: one per one-edge kind, one per class (at its first kind). */
function groupOptions(
  groupKinds: readonly NcSystemEventKind[],
  served: readonly NcServedKindOption[] | undefined,
  summary: boolean,
): NcSystemEventKindOption[] {
  const labelOf = (kind: NcSystemEventKind): string =>
    served?.find((option) => option.value === kind)?.label ?? kind
  const emitted = new Set<string>()
  return groupKinds.flatMap((kind): NcSystemEventKindOption[] => {
    const spec = classOfKind(kind)
    if (spec === undefined) return [{ kind, fallback: labelOf(kind), writes: [kind], clears: [kind] }]
    if (emitted.has(spec.id)) return []
    emitted.add(spec.id)
    return [
      {
        kind,
        fallback: summary ? spec.snapshotLabel : spec.label,
        classId: spec.id,
        writes: summary ? [...spec.bad] : systemEventClassKinds(spec),
        clears: systemEventClassKinds(spec),
        ...(summary && spec.snapshotSection === null ? { noSnapshot: true } : {}),
      },
    ]
  })
}

/** The paired class of a kind (D906), or `undefined` for a one-edge kind. */
function classOfKind(kind: NcSystemEventKind): NcSystemEventClassSpec | undefined {
  return NC_SYSTEM_EVENT_CLASS_SPECS.find(
    (spec) => spec.bad.includes(kind) || spec.recovery.includes(kind),
  )
}

const CLASS_PREFIX = 'v2.nc.rules.editor.systemClasses'
const SNAPSHOT_PREFIX = 'v2.nc.rules.editor.systemClassSnapshots'

/**
 * The i18n key of a chip: its kind's, or its class's — the snapshot wording on
 * a summary. `kindLabelKey` is the one-edge key.
 */
export function systemEventOptionLabelKey(
  option: NcSystemEventKindOption,
  summary: boolean,
  kindLabelKey: (kind: NcSystemEventKind) => string,
): string {
  if (option.classId === undefined) return kindLabelKey(option.kind)
  return `${summary ? SNAPSHOT_PREFIX : CLASS_PREFIX}.${option.classId}`
}

/** Is a chip ticked: does the rule carry any kind it stands for? */
export function systemEventOptionSelected(
  kinds: readonly NcSystemEventKind[],
  option: NcSystemEventKindOption,
): boolean {
  return option.clears.some((kind) => kinds.includes(kind))
}

/** One heading of the family editor and the kinds drawn under it. */
export interface NcSystemEventKindGroup {
  readonly id: string
  readonly labelKey: string
  /** The shared table's English label — the heading's i18n fallback. */
  readonly fallback: string
  readonly options: readonly NcSystemEventKindOption[]
}

/**
 * {@link systemEventOptionsForFamily}, cut into the family's groups in
 * `NC_SYSTEM_EVENT_KIND_GROUP_SPECS` order. Every drawn chip belongs to one
 * of these groups (a class never spans two).
 */
export function systemEventKindGroupsForFamily(
  family: NcSystemEventFamily,
  served: readonly NcServedKindOption[] | undefined,
  summary = false,
): readonly NcSystemEventKindGroup[] {
  return NC_SYSTEM_EVENT_KIND_GROUP_SPECS.filter((group) => group.family === family).map(
    (group): NcSystemEventKindGroup => ({
      id: group.id,
      labelKey: systemEventGroupLabelKey(group.id),
      fallback: group.label,
      options: groupOptions(group.kinds, served, summary),
    }),
  )
}

/**
 * The kinds after one chip is pressed, in AUTHORING order
 * (`NC_SYSTEM_EVENT_KIND_GROUP_SPECS`) — never in tick order. The admin's
 * `toggleSystemEventOption` sorts the same way, so a rule saved by either
 * editor carries the same `kinds` order, and unticking and re-ticking a chip
 * is not a change. Unticking a class clears every edge it stands for; ticking
 * writes the chip's `writes` (both edges, or the bad edges on a summary).
 */
export function toggledSystemEventKinds(
  kinds: readonly NcSystemEventKind[],
  option: NcSystemEventKindOption,
): NcSystemEventKind[] {
  if (systemEventOptionSelected(kinds, option)) {
    return kinds.filter((item) => !option.clears.includes(item))
  }
  return NC_SYSTEM_EVENT_KIND_GROUP_SPECS.flatMap((group) => group.kinds).filter(
    (item) => option.writes.includes(item) || kinds.includes(item),
  )
}

/**
 * Which filters a rule of this family, with these kinds, may show — the
 * per-kind scoping composed with the family's allowed filters. For alarm,
 * `deviceIds` speaks only about `alarm-triggered`, so "the camera filter only
 * with alarm-triggered" falls out of the shared predicate.
 */
export function familyFilterVisibility(
  family: NcSystemEventFamily,
  kinds: readonly NcSystemEventKind[],
): NcFamilyFilterVisibility {
  const allowed = NC_SYSTEM_EVENT_FAMILY_FILTERS[family]
  // The exclude list speaks about the same kinds the include list does.
  const speaksAboutDevices = systemEventFilterAppliesToAnyKind(kinds, 'deviceIds')
  return {
    devices: allowed.includes('deviceIds') && speaksAboutDevices,
    excludeDevices: allowed.includes('excludeDeviceIds') && speaksAboutDevices,
    deviceTypes: allowed.includes('deviceTypes') && systemEventFilterAppliesToAnyKind(kinds, 'deviceTypes'),
    nodes: allowed.includes('nodeIds') && systemEventFilterAppliesToAnyKind(kinds, 'nodeIds'),
    packages: allowed.includes('packageNames') && systemEventFilterAppliesToAnyKind(kinds, 'packageNames'),
    // D642: only the consumable kinds are judged at a threshold, and only a
    // device-events rule may carry one.
    consumableThreshold:
      allowed.includes('consumableLowPercent') &&
      systemEventFilterAppliesToAnyKind(kinds, 'consumableLowPercent'),
  }
}

/**
 * The condition a family rule SAVES: its kinds, and only the filters
 * {@link familyFilterVisibility} shows for them — the admin's
 * `pruneSystemEventForSave` says the same. The consumable threshold (D642) is
 * one of them: without a consumable kind it is not saved.
 *
 * The editor carries a hidden filter across a kind change on purpose (unticking
 * `alarm-triggered` and ticking it back must not lose the cameras). What it must
 * never do is SAVE one: a filter the editor no longer shows is part of a rule
 * nobody can see the whole of, and the hub refuses a filter outside the family
 * (D637). An empty list is written as absent (the schema's `.min(1)`).
 */
export function pruneSystemEventForFamily(
  family: NcSystemEventFamily,
  value: NcSystemEventCondition,
): NcSystemEventCondition {
  const visible = familyFilterVisibility(family, value.kinds)
  const keep = <T>(shown: boolean, list: readonly T[] | undefined): T[] | undefined =>
    shown && list !== undefined && list.length > 0 ? [...list] : undefined
  const deviceIds = keep(visible.devices, value.deviceIds)
  const excludeDeviceIds = keep(visible.excludeDevices, value.excludeDeviceIds)
  const deviceTypes = keep(visible.deviceTypes, value.deviceTypes)
  const nodeIds = keep(visible.nodes, value.nodeIds)
  const packageNames = keep(visible.packages, value.packageNames)
  // A threshold is a number, not a list: kept only while its box shows.
  const consumableLowPercent = visible.consumableThreshold ? value.consumableLowPercent : undefined
  return {
    kinds: [...value.kinds],
    ...(deviceIds !== undefined ? { deviceIds } : {}),
    ...(excludeDeviceIds !== undefined ? { excludeDeviceIds } : {}),
    ...(deviceTypes !== undefined ? { deviceTypes } : {}),
    ...(nodeIds !== undefined ? { nodeIds } : {}),
    ...(packageNames !== undefined ? { packageNames } : {}),
    ...(consumableLowPercent !== undefined ? { consumableLowPercent } : {}),
  }
}

/** The bounds the hub's schema holds a consumable threshold to (D642). */
export const NC_CONSUMABLE_THRESHOLD_MIN = 1
export const NC_CONSUMABLE_THRESHOLD_MAX = NC_CONSUMABLE_LOW_PERCENT_MAX

/** What the threshold box's text means: clear it, set it, or nothing yet. */
export type NcConsumableThresholdInput =
  | { readonly kind: 'clear' }
  | { readonly kind: 'set'; readonly value: number }
  | { readonly kind: 'invalid' }

/**
 * Read the threshold box — the admin's `parseConsumableThreshold`, word for
 * word. Empty is `clear` (the rule judges at the default); a whole number in
 * 1–95 is `set`; anything else is `invalid` and is never written — the hub
 * would refuse the save, and a half-typed number is not a decision.
 */
export function parseConsumableThreshold(raw: string): NcConsumableThresholdInput {
  const text = raw.trim()
  if (text === '') return { kind: 'clear' }
  const value = Number(text)
  return Number.isInteger(value) &&
    value >= NC_CONSUMABLE_THRESHOLD_MIN &&
    value <= NC_CONSUMABLE_THRESHOLD_MAX
    ? { kind: 'set', value }
    : { kind: 'invalid' }
}

/**
 * Does this condition put a battery or consumable kind behind a device-type
 * filter? Batteries belong to sensors, containers, vacuums and mowers — rarely
 * to a camera — so a type filter meant for liveness silences them (D636). The
 * admin's `batteryKindsNarrowedByType` says the same.
 */
export function batteryKindsNarrowedByType(
  condition: Pick<NcSystemEventCondition, 'kinds' | 'deviceTypes'> | undefined,
): boolean {
  if (condition === undefined || (condition.deviceTypes?.length ?? 0) === 0) return false
  return condition.kinds.some((kind) =>
    NC_BATTERY_CONSUMABLE_SYSTEM_EVENT_KINDS.some((member) => member === kind),
  )
}
