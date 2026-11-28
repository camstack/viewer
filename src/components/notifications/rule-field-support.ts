/**
 * rule-field-support — which message fields the rule editor shows for the
 * selected targets (#483), read from what each target's kind DECLARES
 * (`TargetKind.caps`). The editor names no service: a speaker that says only a
 * title is told apart from a phone by its declaration, never by its kind string.
 *
 * A port of the hub's `deliverableFields` / `fieldSupportForTargets`
 * (`@dominevo/types` `notification/notification-fields.ts`, which the hub's
 * dispatcher drops fields by and the admin editor hides them by) and of the
 * admin's `fieldSupportForSelection`. Those values are not on the
 * `@dominevo/types/client` entry, so the viewer keeps this copy; the spec pins
 * the same cases.
 */
import {
  NotificationFieldSchema,
  type NotificationField,
  type Target,
  type TargetKind,
  type TargetKindCaps,
} from '../../data/notification-center.js'

/** Every field, in the order an editor meets them. */
export const NOTIFICATION_FIELDS: readonly NotificationField[] = NotificationFieldSchema.options

/**
 * The fields a kind delivers:
 *  - `title` / `body` — `caps.text`; absent = both;
 *  - `attachments` — at least one slot and one media type;
 *  - `actions` — at least one button;
 *  - `priority` — at least two distinct ordinals to choose between;
 *  - `sound`, `clickUrl` — their flags.
 */
export function deliverableFields(caps: TargetKindCaps): readonly NotificationField[] {
  const ordinals = new Set(
    caps.levels.map((level) => level.ordinal).filter((ordinal) => ordinal !== null),
  )
  const supported: Readonly<Record<NotificationField, boolean>> = {
    title: caps.text?.title ?? true,
    body: caps.text?.body ?? true,
    attachments: caps.attachments.max > 0 && caps.attachments.mediaTypes.length > 0,
    actions: caps.actions > 0,
    priority: ordinals.size >= 2,
    sound: caps.sound,
    clickUrl: caps.clickUrl,
  }
  return NOTIFICATION_FIELDS.filter((field) => supported[field])
}

/** Whether the editor shows a field, and which selected targets drop it. */
export interface NotificationFieldSupport {
  readonly field: NotificationField
  /** At least one selected target delivers it — or nothing is selected, or a kind is unknown. */
  readonly shown: boolean
  /** Names of the selected targets KNOWN not to deliver it (the per-field hint). */
  readonly droppedBy: readonly string[]
}

export type NotificationFieldSupportMap = ReadonlyMap<NotificationField, NotificationFieldSupport>

/** One selected target as the question sees it; `fields` undefined = unknown. */
interface FieldTarget {
  readonly name: string
  readonly fields: readonly NotificationField[] | undefined
}

/**
 * What the rule-level editor shows for the selected targets: the union of what
 * they deliver, each field with the targets that drop it. No selection, an
 * unanswered kinds query (`kinds` undefined) or a kind the catalog does not
 * describe narrows nothing — not-yet-known must never look like not-supported.
 */
export function fieldSupportForSelection(
  targetIds: readonly string[],
  targets: readonly Target[],
  kinds: readonly TargetKind[] | undefined,
): NotificationFieldSupportMap {
  const selected: readonly FieldTarget[] = targetIds.map((id) => {
    const target = targets.find((candidate) => candidate.id === id)
    const kind =
      target === undefined
        ? undefined
        : kinds?.find((candidate) => candidate.kind === target.kind && candidate.addonId === target.addonId)
    return {
      name: target?.name ?? id,
      fields: kind === undefined ? undefined : deliverableFields(kind.caps),
    }
  })
  return new Map(
    NOTIFICATION_FIELDS.map((field) => {
      const droppedBy = selected
        .filter((target) => target.fields !== undefined && !target.fields.includes(field))
        .map((target) => target.name)
      const shown = selected.length === 0 || droppedBy.length < selected.length
      return [field, { field, shown, droppedBy }]
    }),
  )
}
