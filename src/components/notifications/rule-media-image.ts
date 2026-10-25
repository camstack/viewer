/**
 * rule-media-image — the ONE picture choice of a notification rule (D897),
 * mirrored from the hub's `packages/types/src/notification/media-image.ts`.
 *
 * A rule used to state its picture as three fields (`attach`, `frame`,
 * `zoneCrop`); the hub now renders the picture at send time and the rule says
 * only what it wants to SEE: `image` (`scene-boxes` | `crop` | `clean` |
 * `none`) plus `showTriggerZone` and `showSubjectPath` (D901). The functions are mirrored rather than
 * imported because they are published on the bare `@camstack/types` entry
 * only, which this app imports for types alone; `rule-media-image-parity.spec.ts`
 * runs both copies over the same inputs, so a hub change turns it red on the
 * next types bump.
 *
 * This module is the editor's only reader of the legacy triple: a stored rule
 * is read through `normalizeMediaPolicy` when the form opens, and the save
 * (`pruneMediaPolicy`) never writes the triple back.
 */
import { ruleKindOf, ruleKindSpec } from '@camstack/types/client'
import type { NcRuleKind } from '@camstack/types'
import type { NcConditions, NcDelivery, NcMediaImage, NcMediaPolicy } from '../../data/notification-center.js'

/** Every mode, in the order the editor offers them. */
export const NC_MEDIA_IMAGE_MODES: readonly NcMediaImage[] = ['scene-boxes', 'crop', 'clean', 'none']

/**
 * The modes a rule of this kind can honour. A kind that carries no media gets
 * none; a kind whose subject has no region of the frame (a sound) is never
 * offered `crop`.
 */
export function imageModesForKind(kind: NcRuleKind): readonly NcMediaImage[] {
  const spec = ruleKindSpec(kind)
  if (!spec.carriesMedia) return []
  return spec.carriesSubjectCrop ? NC_MEDIA_IMAGE_MODES : NC_MEDIA_IMAGE_MODES.filter((mode) => mode !== 'crop')
}

/**
 * The zone ids that FIRE a rule: its `zones` condition, or an occupancy rule's
 * own scoped zone. Empty when the trigger is not a zone — `showTriggerZone`
 * then has nothing to draw, is not offered, and the hub refuses it on save.
 */
export function ruleTriggerZoneIds(conditions: NcConditions): readonly string[] {
  if (conditions.zones !== undefined) return conditions.zones.ids
  const zoneId = conditions.occupancy?.zoneId
  return zoneId !== undefined ? [zoneId] : []
}

/**
 * What the legacy triple MEANT, as a mode. `zoneCrop` forced the clean frame
 * and dropped `frame`; `frame` decided over `attach`; `keyFrame` was the clean
 * scene; every other still (`best`, `best-matching`, absent) was the subject.
 */
export function legacyImageMode(media: NcMediaPolicy): NcMediaImage {
  if (media.attach === 'none') return 'none'
  if (media.zoneCrop === true) return 'clean'
  if (media.frame === 'full') return 'clean'
  if (media.frame === 'boxed') return 'scene-boxes'
  if (media.frame === 'cropped') return 'crop'
  if (media.attach === 'keyFrame') return 'clean'
  return 'crop'
}

/** A mode the kind cannot honour, mapped to the nearest one it can. */
function clampToKind(mode: NcMediaImage, kind: NcRuleKind): NcMediaImage {
  const offered = imageModesForKind(kind)
  if (offered.length === 0 || offered.includes(mode)) return mode
  return mode === 'crop' ? 'clean' : mode
}

/**
 * The mode a rule's picture is rendered in: `image` when stored, else what the
 * legacy triple meant — and `clean` for a SENSOR rule written before D897,
 * whatever it stored, because that is what it shipped. Clamped to the kind.
 */
export function resolveNcMediaImage(media: NcMediaPolicy, kind: NcRuleKind): NcMediaImage {
  if (media.image !== undefined) return clampToKind(media.image, kind)
  if (kind === 'sensor') return 'clean'
  return clampToKind(legacyImageMode(media), kind)
}

/** The rule fields the normalisation reads. */
export interface NcMediaRuleSubject {
  readonly delivery: NcDelivery
  readonly conditions: NcConditions
}

/** Can a zone outline be drawn on this mode for this rule? */
export function triggerZoneDrawable(image: NcMediaImage, conditions: NcConditions): boolean {
  return image !== 'crop' && image !== 'none' && ruleTriggerZoneIds(conditions).length > 0
}

/**
 * True when a rule of this kind has a TRACKED subject whose path can be drawn
 * (`showSubjectPath`, D901): a kind whose subject owns a region of the frame.
 * Mirrors the hub's `subjectHasPath`.
 */
export function subjectHasPath(kind: NcRuleKind): boolean {
  const spec = ruleKindSpec(kind)
  return spec.carriesMedia && spec.carriesSubjectCrop
}

/** Can the subject's path be drawn on this mode for a rule of this kind? */
export function subjectPathDrawable(image: NcMediaImage, kind: NcRuleKind): boolean {
  return image !== 'none' && subjectHasPath(kind)
}

/**
 * A stored media policy as the hub reads it: `image` set, the legacy triple
 * gone, `showTriggerZone` only where it can be drawn (a legacy `zoneCrop` on a
 * zone rule becomes it). Every other field is carried through. Pure.
 */
export function normalizeMediaPolicy(media: NcMediaPolicy, rule: NcMediaRuleSubject): NcMediaPolicy {
  const kind = ruleKindOf(rule)
  const image = resolveNcMediaImage(media, kind)
  const {
    attach: _attach,
    frame: _frame,
    zoneCrop,
    showTriggerZone,
    showSubjectPath,
    image: _image,
    ...rest
  } = media
  const wantsZone = showTriggerZone === true || (media.image === undefined && zoneCrop === true)
  const drawable = wantsZone && triggerZoneDrawable(image, rule.conditions)
  const pathDrawable = showSubjectPath === true && subjectPathDrawable(image, kind)
  return {
    ...rest,
    image,
    ...(drawable ? { showTriggerZone: true } : {}),
    ...(pathDrawable ? { showSubjectPath: true } : {}),
  }
}
