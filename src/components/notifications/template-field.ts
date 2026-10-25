/**
 * Local interpreter of the hub's catalog data. Local because this app
 * resolves @camstack/types from the PUBLISHED package and must work against a
 * hub older than the one that published it; the parity spec pins it to
 * `templateVarsFor`. The kind axes (D637: a served `system` covers every
 * system rule kind, and a family narrows the event-kind axis) are read through
 * the shared `templateVarKindApplies` / `templateVarSystemEventApplies`.
 */
import {
  NC_TEMPLATE_HELD_BACK_SYSTEM_EVENT_KINDS,
  NC_TEMPLATE_VARS,
  isHeldBackTemplateVar,
  templateVarDeliveryApplies,
  templateVarKindApplies,
  templateVarSystemEventApplies,
} from '@camstack/types/client'
import type {
  NcSystemEventKind,
  NcTemplateVarContext,
  NcTemplateVarDescriptor,
} from '../../data/notification-center.js'

export interface TextSelection {
  readonly start: number
  readonly end: number
}

export interface InsertResult {
  readonly value: string
  readonly cursor: number
}

export interface PlaceholderToken {
  readonly text: string
  readonly cursorOffset: number
}

export type TemplateVarGroupId = NcTemplateVarDescriptor['group']

export interface TemplateVarGroup {
  readonly group: TemplateVarGroupId
  readonly vars: readonly NcTemplateVarDescriptor[]
}

/** The renderer's own grammar (`render-template.ts:28`) — flat `\w+` names. */
const PLACEHOLDER_RE = /\{\{\s*(\w+)\s*\}\}/g

export const TEMPLATE_GROUP_ORDER: readonly TemplateVarGroupId[] = [
  'subject',
  'place',
  'time',
  'rule',
  'occupancy',
  'sound',
  'sensor',
  'system',
  'digest',
  'ai',
]

export function insertPlaceholder(
  value: string,
  selection: TextSelection,
  token: string,
): InsertResult {
  const start = Math.min(Math.max(selection.start, 0), value.length)
  const end = Math.min(Math.max(selection.end, start), value.length)
  return { value: value.slice(0, start) + token + value.slice(end), cursor: start + token.length }
}

/** A dynamic family (`count_<class>`) cannot be inserted whole: the cursor is
 *  left before the closing braces so the operator types the class. */
export function placeholderToken(descriptor: NcTemplateVarDescriptor): PlaceholderToken {
  const text = `{{${descriptor.name}}}`
  return { text, cursorOffset: descriptor.dynamic ? text.length - 2 : text.length }
}

export function templatePlaceholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_RE)]
    .map((match) => match[1] ?? '')
    .filter((name) => name.length > 0)
}

function isKnown(name: string, known: readonly NcTemplateVarDescriptor[]): boolean {
  return known.some((descriptor) =>
    descriptor.dynamic
      ? name.startsWith(descriptor.dynamic.prefix) && name.length > descriptor.dynamic.prefix.length
      : descriptor.name === name,
  )
}

/** Names the hub would print as EMPTY (the renderer's unknown-name rule). */
export function unknownPlaceholders(
  template: string,
  known: readonly NcTemplateVarDescriptor[],
): string[] {
  return [...new Set(templatePlaceholders(template))].filter((name) => !isKnown(name, known))
}

/**
 * The caption fields see a fixed, smaller vocabulary — mirrors
 * `CAPTION_VARS` in `packages/types/src/notification/template-vars.ts`
 * (~757-763). Kept in sync by the exhaustive parity spec, not by hand.
 */
const CAPTION_VARS: Readonly<Record<'previewText' | 'captionText', readonly string[]>> = {
  previewText: ['camera', 'rule', 'from', 'to'],
  captionText: ['rule', 'from', 'to'],
}

/**
 * Put back the system-event kinds the HUB held back from the served catalog
 * (D642 review M3) — the admin's `restoreHeldBackKinds`, same rule.
 *
 * The hub drops `NC_TEMPLATE_HELD_BACK_SYSTEM_EVENT_KINDS` from every served
 * descriptor because an installed VIEWER parses the catalog whole with a strict
 * kind enum. This build knows those kinds, so it restores them from its own
 * `NC_TEMPLATE_VARS`, for descriptors of the same name only, and only the
 * held-back kinds. The served catalog stays the authority for everything else,
 * and a descriptor this build does not know is passed through untouched.
 */
export function restoreHeldBackKinds(
  served: readonly NcTemplateVarDescriptor[],
): NcTemplateVarDescriptor[] {
  return served.map((descriptor) => {
    const own = NC_TEMPLATE_VARS.find((local) => local.name === descriptor.name)
    const servedKinds = descriptor.systemEventKinds
    if (own?.systemEventKinds === undefined || servedKinds === undefined) return descriptor
    const kept = (kind: NcSystemEventKind): boolean =>
      servedKinds.includes(kind) || NC_TEMPLATE_HELD_BACK_SYSTEM_EVENT_KINDS.includes(kind)
    const restored = own.systemEventKinds.filter(kept)
    const newer = servedKinds.filter((kind) => !restored.includes(kind))
    return { ...descriptor, systemEventKinds: [...restored, ...newer] }
  })
}

/**
 * Put back the WHOLE descriptors the hub holds back from the served catalog
 * (D647) — the admin's `restoreHeldBackVars`, same rule. The state-summary
 * vocabulary (`{{summaryText}}`, `{{summaryBattery}}`, …) is served to no one,
 * because an installed viewer that predates the delivery axis would offer it
 * on every instant system rule. This build reads the axis, so it appends them
 * from its own `NC_TEMPLATE_VARS`, only when the hub did not serve one of that
 * name.
 */
export function restoreHeldBackVars(served: readonly NcTemplateVarDescriptor[]): NcTemplateVarDescriptor[] {
  const names = new Set(served.map((descriptor) => descriptor.name))
  const held = NC_TEMPLATE_VARS.filter((d) => isHeldBackTemplateVar(d) && !names.has(d.name))
  return [...served, ...held]
}

export function varsForContext(
  vars: readonly NcTemplateVarDescriptor[],
  ctx: NcTemplateVarContext,
): NcTemplateVarDescriptor[] {
  // Mirrors `templateVarsFor`'s two-path split (template-vars.ts ~783-798):
  // a caption field (`previewText`/`captionText`) reads a fixed, explicit
  // name allow-list — never the generic families/fields/kinds/deliveries/
  // systemEventKinds axes below, and never a `dynamic` (count_<class>)
  // descriptor.
  if (ctx.field === 'previewText' || ctx.field === 'captionText') {
    const allowed = CAPTION_VARS[ctx.field]
    return vars.filter(
      (descriptor) =>
        descriptor.families.includes(ctx.family) &&
        allowed.includes(descriptor.name) &&
        !descriptor.dynamic,
    )
  }
  return vars.filter((descriptor) => {
    if (!descriptor.families.includes(ctx.family)) return false
    if (descriptor.fields && !descriptor.fields.includes(ctx.field)) return false
    // An axis the CONTEXT leaves unstated is not a filter — `templateVarsFor`'s
    // `onAxis` passes when `asked` is undefined, regardless of what the
    // descriptor declares (a timelapse/summary context never names a `kind`).
    // The served `kinds` are the frozen pre-D637 five: `system` there stands
    // for every system rule kind (D637). The shared predicate owns that widening.
    if (!templateVarKindApplies(descriptor.kinds, ctx.kind)) return false
    if (
      descriptor.deliveries &&
      ctx.delivery !== undefined &&
      !descriptor.deliveries.includes(ctx.delivery)
    )
      return false
    // `systemEventKinds` is read only for a system rule kind (any family, or
    // `mixed`). With no event kind chosen, a FAMILY watches its own family's
    // kinds and `mixed` all of them — the shared predicate, never a copy.
    // …and the rule's DELIVERY (D647): a summary row has no one device, so a
    // per-event variable is not offered on it, and a summary variable is not
    // offered on an instant rule.
    return templateVarSystemEventApplies(descriptor, ctx) && templateVarDeliveryApplies(descriptor, ctx)
  })
}

export function groupTemplateVars(vars: readonly NcTemplateVarDescriptor[]): TemplateVarGroup[] {
  return TEMPLATE_GROUP_ORDER.map((group) => ({
    group,
    vars: vars.filter((d) => d.group === group),
  })).filter((entry) => entry.vars.length > 0)
}

/**
 * The slice of i18next's `t` the label needs. Named rather than `TFunction` so a
 * pure spec can pass a two-line stub; the real `t` satisfies it.
 */
export type TemplateLabelTranslate = (key: string, options: { defaultValue: string }) => string

/** Translated by NAME; a variable newer than this app shows the hub's English label. */
export function templateVarLabel(
  t: TemplateLabelTranslate,
  descriptor: NcTemplateVarDescriptor,
): string {
  return t(`v2.nc.templateVars.${descriptor.name}`, { defaultValue: descriptor.label })
}
