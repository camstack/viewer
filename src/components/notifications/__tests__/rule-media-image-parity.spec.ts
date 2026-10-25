/**
 * The picture-mode mirror (`rule-media-image.ts`) against the PUBLISHED hub
 * functions (`@camstack/types`, D897), over every combination that matters.
 *
 * The mirror exists because those functions ship on the bare entry, which this
 * app imports for types only. A hub change to the mapping, the clamp or the
 * trigger-zone rule turns this red the day the types are bumped — and the
 * save payload is judged by the hub's own `ncMediaPolicyError`, so the editor
 * can never write a policy the hub refuses.
 */
import { describe, expect, it } from 'vitest'
import {
  imageModesForKind as hubImageModesForKind,
  legacyImageMode as hubLegacyImageMode,
  ncMediaPolicyError,
  normalizeNcMediaPolicy,
  resolveNcMediaImage as hubResolveNcMediaImage,
  ruleTriggerZoneIds as hubRuleTriggerZoneIds,
  NC_MEDIA_IMAGE_MODES as HUB_MODES,
  NC_RULE_KIND_SPECS,
} from '@camstack/types'
import type { NcConditions, NcDelivery, NcMediaPolicy } from '../../../data/notification-center.js'
import {
  NC_MEDIA_IMAGE_MODES,
  imageModesForKind,
  legacyImageMode,
  normalizeMediaPolicy,
  resolveNcMediaImage,
  ruleTriggerZoneIds,
} from '../rule-media-image.js'
import { pruneMediaPolicy } from '../rule-editor.js'
import { ruleKindOf } from '@camstack/types/client'

const KINDS = NC_RULE_KIND_SPECS.map((spec) => spec.kind)

/** Every legacy triple the hub ever stored, plus the new fields and their mix. */
const MEDIA: readonly NcMediaPolicy[] = (() => {
  const out: NcMediaPolicy[] = [{}]
  for (const attach of [undefined, 'best', 'best-matching', 'keyFrame', 'none'] as const) {
    for (const frame of [undefined, 'cropped', 'full', 'boxed'] as const) {
      for (const zoneCrop of [undefined, true, false]) {
        out.push({
          ...(attach !== undefined ? { attach } : {}),
          ...(frame !== undefined ? { frame } : {}),
          ...(zoneCrop !== undefined ? { zoneCrop } : {}),
        })
      }
    }
  }
  for (const image of NC_MEDIA_IMAGE_MODES) {
    out.push({ image }, { image, showTriggerZone: true }, { image, zoneCrop: true, attach: 'keyFrame' })
  }
  out.push({ attach: 'best', gif: true, clip: true, clipPreRollSec: 5, profile: 'low', linkedCameras: 'each' })
  return out
})()

/** One rule per kind × trigger-zone shape. */
const RULES: readonly { readonly delivery: NcDelivery; readonly conditions: NcConditions }[] = [
  { delivery: 'immediate', conditions: { classes: ['person'] } },
  { delivery: 'immediate', conditions: { classes: ['person'], zones: { ids: ['z1'] } } },
  { delivery: 'track-end', conditions: { zones: { ids: ['z1', 'z2'], match: 'all' } } },
  { delivery: 'device-event', conditions: {} },
  { delivery: 'device-event', conditions: { occupancy: { zoneId: 'z1', op: 'became-occupied', count: 1, sustainSeconds: 15 } } },
  { delivery: 'device-event', conditions: { occupancy: { op: '>=', count: 2, sustainSeconds: 15 } } },
  { delivery: 'immediate', conditions: { audio: { hitPercent: 50, samplingSeconds: 5, dbThreshold: -40 } } },
  { delivery: 'system-event', conditions: { systemEvent: { kinds: ['node-offline'] } } },
  { delivery: 'system-event', conditions: { systemEvent: { kinds: ['alarm-armed'] } } },
]

describe('rule-media-image mirrors the hub (D897)', () => {
  it('the mode list and its order', () => {
    expect(NC_MEDIA_IMAGE_MODES).toEqual(HUB_MODES)
  })

  it('the modes each kind can honour', () => {
    expect(KINDS.length).toBeGreaterThan(5)
    for (const kind of KINDS) expect(imageModesForKind(kind), kind).toEqual(hubImageModesForKind(kind))
  })

  it('the legacy mapping and the per-kind resolution, for every stored triple', () => {
    expect(MEDIA.length).toBeGreaterThan(60)
    for (const media of MEDIA) {
      expect(legacyImageMode(media), JSON.stringify(media)).toBe(hubLegacyImageMode(media))
      for (const kind of KINDS) {
        expect(resolveNcMediaImage(media, kind), `${kind} ${JSON.stringify(media)}`).toBe(hubResolveNcMediaImage(media, kind))
      }
    }
  })

  it('the trigger zones and the load-time normalisation, rule by rule', () => {
    for (const rule of RULES) {
      expect(ruleTriggerZoneIds(rule.conditions)).toEqual(hubRuleTriggerZoneIds(rule.conditions))
      for (const media of MEDIA) {
        expect(normalizeMediaPolicy(media, rule), `${JSON.stringify(rule)} ${JSON.stringify(media)}`).toEqual(
          normalizeNcMediaPolicy(media, rule),
        )
      }
    }
  })
})

describe('the save payload', () => {
  it('passes the hub\'s own save guard, for every kind and every stored policy', () => {
    for (const rule of RULES) {
      const kind = ruleKindOf(rule)
      for (const media of MEDIA) {
        const saved = pruneMediaPolicy(normalizeMediaPolicy(media, rule), { kind, conditions: rule.conditions })
        expect(ncMediaPolicyError(saved, rule), `${kind} ${JSON.stringify(media)}`).toBeNull()
      }
    }
  })

  it('never carries the legacy triple, and always names the picture', () => {
    for (const rule of RULES) {
      const kind = ruleKindOf(rule)
      for (const media of MEDIA) {
        const saved = pruneMediaPolicy(normalizeMediaPolicy(media, rule), { kind, conditions: rule.conditions })
        expect(saved).not.toHaveProperty('attach')
        expect(saved).not.toHaveProperty('frame')
        expect(saved).not.toHaveProperty('zoneCrop')
        expect(saved.image).toBeDefined()
      }
    }
  })

  it('saves the picture the hub would have rendered from the stored rule', () => {
    for (const rule of RULES) {
      const kind = ruleKindOf(rule)
      if (!NC_RULE_KIND_SPECS.find((spec) => spec.kind === kind)?.carriesMedia) continue
      for (const media of MEDIA) {
        const saved = pruneMediaPolicy(normalizeMediaPolicy(media, rule), { kind, conditions: rule.conditions })
        const hub = normalizeNcMediaPolicy(media, rule)
        expect(saved.image).toBe(hub.image)
        expect(saved.showTriggerZone === true).toBe(hub.showTriggerZone === true)
      }
    }
  })
})
