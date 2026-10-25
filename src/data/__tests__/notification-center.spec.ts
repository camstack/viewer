import { describe, it, expect, vi } from 'vitest'
import {
  makeNcClient,
  NcConditionCatalogResultSchema,
  NcRuleInputSchema,
  NcRulePatchSchema,
  NcSummaryRulePatchSchema,
  NcSummaryRuleSchema,
  NcSummaryRuleInputSchema,
  NcViewerSummaryRuleSchema,
  NcMediaPolicySchema,
  NcSystemEventKindSchema,
  NcTemplateVarDescriptorSchema,
  NcTemplatePreviewResultSchema,
  NcRuleSchema,
  NcRuleClearableKeySchema,
  NcDryRunResultSchema,
} from '../notification-center.js'
import { NC_GROUPING_MAX_SEC, NC_GROUPING_MIN_SEC, NC_TEMPLATE_VARS } from '@camstack/types/client'
import { NcSystemEventKindSchema as PublishedSystemEventKindSchema } from '@camstack/types'

describe('ncClient', () => {
  it('routes listRules to addons.custom with addonId pipeline-analytics', async () => {
    const mutate = vi.fn().mockResolvedValue({ rules: [] })
    const client = makeNcClient({ addonsCustomMutate: mutate })
    await client.listRules()
    expect(mutate).toHaveBeenCalledWith({ addonId: 'pipeline-analytics', action: 'nc.listRules', input: {} })
  })
  it('routes upsertTarget to addonId notifiers', async () => {
    const mutate = vi.fn().mockResolvedValue({ target: { id: 'x', name: 'n', kind: 'ntfy', addonId: 'notifiers', enabled: true, config: {} } })
    const client = makeNcClient({ addonsCustomMutate: mutate })
    await client.upsertTarget({ id: 'x', name: 'n', kind: 'ntfy', addonId: 'notifiers', enabled: true, config: {} })
    expect(mutate).toHaveBeenCalledWith({ addonId: 'notifiers', action: 'nc.upsertMyTarget', input: { target: expect.any(Object) } })
  })
})

describe('testRule — the real delivery, from the phone', () => {
  const answer = {
    recordId: 'synthetic:abc',
    origin: 'synthetic',
    delivery: 'immediate',
    candidates: 1,
    outcomes: [
      { ruleId: 'r1', ruleName: 'Door', matched: true, cooldown: 'bypassed', enqueued: 1, targetIds: ['t1'] },
    ],
    still: 'live',
    notes: [],
    trigger: 'immediate',
    planNotes: [{ conditionId: 'devices', note: 'no camera' }],
  }

  it('routes nc.testRule to pipeline-analytics and parses trigger + planNotes', async () => {
    const mutate = vi.fn().mockResolvedValue(answer)
    const client = makeNcClient({ addonsCustomMutate: mutate })
    const result = await client.testRule('r1')
    expect(mutate).toHaveBeenCalledWith({ addonId: 'pipeline-analytics', action: 'nc.testRule', input: { ruleId: 'r1' } })
    expect(Object.keys(mutate.mock.calls[0]?.[0]?.input ?? {})).toEqual(['ruleId'])
    expect(result.trigger).toBe('immediate')
    expect(result.planNotes).toEqual([{ conditionId: 'devices', note: 'no camera' }])
    expect(result.outcomes[0]?.enqueued).toBe(1)
  })

  it('forwards the fallback camera only when one is given', async () => {
    const mutate = vi.fn().mockResolvedValue(answer)
    const client = makeNcClient({ addonsCustomMutate: mutate })
    await client.testRule('r1', 42)
    expect(mutate).toHaveBeenCalledWith({
      addonId: 'pipeline-analytics',
      action: 'nc.testRule',
      input: { ruleId: 'r1', deviceId: 42 },
    })
  })
})

describe('dry-run result mirror', () => {
  it('parses the cap answer, failedCondition included', () => {
    const parsed = NcDryRunResultSchema.parse({
      results: [
        { recordId: 'a', recordKind: 'track', deviceId: 3, timestamp: 5, wouldFire: false, failedCondition: 'classes' },
        { recordId: 'b', recordKind: 'object-event', deviceId: 3, timestamp: 6, wouldFire: true, label: 'person' },
      ],
    })
    expect(parsed.results.map((r) => r.failedCondition)).toEqual(['classes', undefined])
  })
  it('a record kind this build does not know costs nothing — the count stays honest', () => {
    const parsed = NcDryRunResultSchema.parse({
      results: [{ recordId: 'a', recordKind: 'future-kind', deviceId: 3, timestamp: 5, wouldFire: true }],
    })
    expect(parsed.results).toHaveLength(1)
  })
})

describe('updateRule wire — `clear` travels only when it names something', () => {
  // The response is irrelevant here: the delegate refuses, so the test pins
  // only what was PUT ON THE WIRE, never a parsed reply.
  const refusing = () => vi.fn().mockRejectedValue(new Error('wire captured'))

  it('forwards a non-empty clear beside the patch', async () => {
    const mutate = refusing()
    const client = makeNcClient({ addonsCustomMutate: mutate })
    await expect(client.updateRule('r1', { name: 'n' }, ['template', 'schedule'])).rejects.toThrow('wire captured')
    expect(mutate).toHaveBeenCalledWith({
      addonId: 'pipeline-analytics',
      action: 'nc.updateRule',
      input: { ruleId: 'r1', patch: { name: 'n' }, clear: ['template', 'schedule'] },
    })
  })

  it.each([
    ['empty', []],
    ['undefined', undefined],
  ] as const)('sends no clear key when clear is %s', async (_label, clear) => {
    const mutate = refusing()
    const client = makeNcClient({ addonsCustomMutate: mutate })
    await expect(client.updateRule('r1', { name: 'n' }, clear)).rejects.toThrow('wire captured')
    const sent: unknown = mutate.mock.calls[0]?.[0]
    expect(sent).toEqual({
      addonId: 'pipeline-analytics',
      action: 'nc.updateRule',
      input: { ruleId: 'r1', patch: { name: 'n' } },
    })
    // `toEqual` ignores an `undefined`-valued key; the old wire shape has NO key.
    expect(Object.keys(mutate.mock.calls[0]?.[0]?.input ?? {})).toEqual(['ruleId', 'patch'])
  })
})

describe('updateTimelapseRule wire — the same `clear` discipline', () => {
  const refusing = () => vi.fn().mockRejectedValue(new Error('wire captured'))

  it('forwards a non-empty clear beside the patch, on the upsert action', async () => {
    const mutate = refusing()
    const client = makeNcClient({ addonsCustomMutate: mutate })
    await expect(
      client.updateTimelapseRule('tl1', { name: 'n' }, ['previewText', 'denseCadenceSec']),
    ).rejects.toThrow('wire captured')
    expect(mutate).toHaveBeenCalledWith({
      addonId: 'pipeline-analytics',
      action: 'nc.upsertTimelapseRule',
      input: { ruleId: 'tl1', patch: { name: 'n' }, clear: ['previewText', 'denseCadenceSec'] },
    })
  })

  it.each([
    ['empty', []],
    ['undefined', undefined],
  ] as const)('sends no clear key when clear is %s', async (_label, clear) => {
    const mutate = refusing()
    const client = makeNcClient({ addonsCustomMutate: mutate })
    await expect(client.updateTimelapseRule('tl1', { name: 'n' }, clear)).rejects.toThrow('wire captured')
    expect(Object.keys(mutate.mock.calls[0]?.[0]?.input ?? {})).toEqual(['ruleId', 'patch'])
  })
})

describe('updateSummaryRule wire — the same `clear` discipline (Task 13)', () => {
  const refusing = () => vi.fn().mockRejectedValue(new Error('wire captured'))

  it('forwards a non-empty clear beside the patch, on the upsert action', async () => {
    const mutate = refusing()
    const client = makeNcClient({ addonsCustomMutate: mutate })
    await expect(client.updateSummaryRule('s1', { name: 'n' }, ['captionText'])).rejects.toThrow('wire captured')
    expect(mutate).toHaveBeenCalledWith({
      addonId: 'pipeline-analytics',
      action: 'nc.upsertSummaryRule',
      input: { ruleId: 's1', patch: { name: 'n' }, clear: ['captionText'] },
    })
  })

  it.each([
    ['empty', []],
    ['undefined', undefined],
  ] as const)('sends no clear key when clear is %s', async (_label, clear) => {
    const mutate = refusing()
    const client = makeNcClient({ addonsCustomMutate: mutate })
    await expect(client.updateSummaryRule('s1', { name: 'n' }, clear)).rejects.toThrow('wire captured')
    expect(Object.keys(mutate.mock.calls[0]?.[0]?.input ?? {})).toEqual(['ruleId', 'patch'])
  })
})

describe('the digest mirror keeps EVERY field the addon stores (Task 13, full parity)', () => {
  // Zod strips unknown keys: a field the mirror forgets is a field the phone
  // reads as absent and — now that it authors every one — writes back wrong.
  const STORED = {
    id: 's1',
    name: 'Notte',
    enabled: true,
    deviceIds: [101, 102],
    window: { kind: 'motion', quietSeconds: 120, maxWindowSeconds: 3600 },
    filters: {
      classes: ['person'],
      classesExclude: ['animal'],
      zones: ['z1'],
      minImportance: 0.4,
      minDwellSeconds: 5,
      includeStationary: true,
    },
    maxTiles: 16,
    maxAiImages: 4,
    rank: 'dwell',
    barrierSeconds: 300,
    targets: [{ targetId: 't1', params: { sound: 'siren' } }],
    template: { title: 'T', body: 'B' },
    captions: 'all',
    captionText: '{{rule}} {{from}}',
    deliverEmpty: true,
    priority: 4,
    ai: {
      enabled: true,
      profileId: 'p1',
      prompt: 'What happened?',
      language: 'it',
      maxImagePx: 512,
      timeoutMs: 120_000,
      onFailure: 'skip',
    },
    generatedAt: 99,
    ownerUserId: 'u1',
    createdBy: 'u1',
    createdAt: 1,
    updatedAt: 2,
  }

  it('the stored rule parses back unchanged', () => {
    expect(NcSummaryRuleSchema.parse(STORED)).toEqual(STORED)
    expect(NcViewerSummaryRuleSchema.parse({ ...STORED, readOnly: false })).toEqual({ ...STORED, readOnly: false })
  })

  it('a rule from an OLDER hub, without the newer fields, still parses', () => {
    const { filters: _f, maxAiImages: _m, rank: _r, barrierSeconds: _b, template: _t, captions: _c,
      captionText: _ct, deliverEmpty: _d, ai: _a, maxTiles: _mt, ...bare } = STORED
    expect(NcSummaryRuleSchema.parse(bare)).toEqual(bare)
  })

  it('a rule stored with the retired `subject: groups` (D680) parses as tracks: the key is stripped', () => {
    const legacy = { ...STORED, subject: 'groups' }
    const parsed = NcSummaryRuleSchema.parse(legacy)
    expect(parsed).toEqual(STORED)
    expect(parsed).not.toHaveProperty('subject')
  })

  it('the create input carries every authorable field', () => {
    const { id: _i, generatedAt: _g, ownerUserId: _o, createdBy: _cb, createdAt: _ca, updatedAt: _u, ...authored } = STORED
    expect(NcSummaryRuleInputSchema.parse(authored)).toEqual(authored)
  })

  it('the patch clears template / filters / ai with null, and covers every input field', () => {
    expect(NcSummaryRulePatchSchema.parse({ template: null, filters: null, ai: null })).toEqual({
      template: null,
      filters: null,
      ai: null,
    })
    expect(Object.keys(NcSummaryRulePatchSchema.shape).sort()).toEqual(
      Object.keys(NcSummaryRuleInputSchema.shape).sort(),
    )
  })
})

describe('parse boundary — the schemas are a viewer-LOCAL mirror', () => {
  it('keeps the whole media policy instead of stripping it to the attach mode', () => {
    // Zod strips unknown keys, so a mirror missing a field silently DELETES it:
    // the viewer read a rule, lost frame/zoneCrop/gif/clip/profile on the way in
    // and wrote them back missing on the way out.
    const wire = {
      attach: 'keyFrame',
      frame: 'full',
      zoneCrop: true,
      gif: true,
      clip: true,
      clipPreRollSec: 5,
      clipPostRollSec: 12,
      profile: 'low',
    }
    expect(NcMediaPolicySchema.parse(wire)).toEqual(wire)
  })

  it('parses the occupancy condition descriptor the hub actually serves', () => {
    // `getConditionCatalog` parses an ARRAY: one unknown member threw and took
    // the ENTIRE catalog with it, leaving the rule editor with no conditions at
    // all. Occupancy is parsed here even though no widget renders it yet.
    const result = NcConditionCatalogResultSchema.parse({
      catalog: [
        {
          id: 'occupancy',
          group: 'occupancy',
          label: 'Occupancy',
          valueType: 'occupancy',
          operator: 'anyOf',
          appliesTo: ['device-event'],
          phase: 'P1',
        },
        {
          id: 'classes',
          group: 'class',
          label: 'Object classes',
          valueType: 'stringList',
          operator: 'in',
          appliesTo: ['immediate'],
          phase: 'P1',
        },
      ],
    })
    expect(result.catalog).toHaveLength(2)
  })

  it('parses system-event rules and the catalog widget without stripping filters', () => {
    const rule = NcRuleInputSchema.parse({
      name: 'Infrastructure alerts',
      delivery: 'system-event',
      conditions: {
        systemEvent: {
          kinds: ['camera-offline', 'addon-update-available'],
          deviceIds: [104],
          packageNames: ['@camstack/addon-pipeline'],
        },
      },
      targets: [{ targetId: 'target-1' }],
      media: { attach: 'none' },
    })
    expect(rule.conditions.systemEvent).toEqual({
      kinds: ['camera-offline', 'addon-update-available'],
      deviceIds: [104],
      packageNames: ['@camstack/addon-pipeline'],
    })

    const result = NcConditionCatalogResultSchema.parse({
      catalog: [
        {
          id: 'systemEvent',
          group: 'system',
          label: 'System event',
          valueType: 'systemEvent',
          operator: 'in',
          appliesTo: ['system-event'],
          phase: 'P1',
          options: [{ value: 'camera-offline', label: 'Camera offline' }],
        },
      ],
    })
    expect(result.catalog[0]).toMatchObject({
      group: 'system',
      valueType: 'systemEvent',
      appliesTo: ['system-event'],
    })
  })
})

describe('recognition scope — the three states reach the mirror intact', () => {
  const base = {
    name: 'Someone I know',
    delivery: 'immediate',
    targets: [{ targetId: 'target-1' }],
    media: { attach: 'best' },
  }

  it('parses a rule whose plates.values is EMPTY instead of dropping the rule', () => {
    // The mirror carried `.min(1)` on `values`, so a rule the admin UI authored
    // as "any readable plate" FAILED safeParse — and a rule that fails to parse
    // is skipped by NcListRulesResultSchema. The rule was not merely uneditable
    // on the phone, it was INVISIBLE there.
    const parsed = NcRuleInputSchema.safeParse({
      ...base,
      conditions: { plates: { values: [], maxDistance: 1 } },
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.conditions.plates).toEqual({ values: [], maxDistance: 1 })
  })

  it('keeps identities: [] as [] — "only known faces", not "unset"', () => {
    const rule = NcRuleInputSchema.parse({ ...base, conditions: { identities: [] } })
    expect(rule.conditions.identities).toEqual([])
  })

  it('keeps a gallery-id identity list and an exclude list verbatim', () => {
    const rule = NcRuleInputSchema.parse({
      ...base,
      conditions: {
        identities: ['3f1b-uuid', '9ac2-uuid'],
        identitiesExclude: ['0000-uuid'],
        plates: { values: ['AB123CD'], maxDistance: 2 },
      },
    })
    expect(rule.conditions.identities).toEqual(['3f1b-uuid', '9ac2-uuid'])
    expect(rule.conditions.identitiesExclude).toEqual(['0000-uuid'])
    expect(rule.conditions.plates).toEqual({ values: ['AB123CD'], maxDistance: 2 })
  })

  it('mirrors groupingSec (D692) instead of stripping it', () => {
    // An unmirrored top-level field is one the operator can neither see nor
    // change from the phone, and Zod would strip it silently.
    const rule = NcRuleInputSchema.parse({ ...base, groupingSec: 20 })
    expect(rule.groupingSec).toBe(20)
    // Absent stays absent: no Zod default may materialise a grouped rule.
    const plain = NcRuleInputSchema.parse(base)
    expect('groupingSec' in plain).toBe(false)
  })

  it('strips the two retired fields an OLD hub still sends', () => {
    // `waitForEnhancement` / `groupIdleSec` are gone from the mirror; a row from a
    // hub that has not migrated yet must still parse, without the keys.
    const parsed = NcRuleInputSchema.safeParse({ ...base, waitForEnhancement: false, groupIdleSec: 30 })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect('waitForEnhancement' in parsed.data).toBe(false)
      expect('groupIdleSec' in parsed.data).toBe(false)
    }
  })

  it('refuses a grouping window under the hub floor', () => {
    expect(NcRuleInputSchema.safeParse({ ...base, groupingSec: NC_GROUPING_MIN_SEC - 1 }).success).toBe(false)
    expect(NcRuleInputSchema.safeParse({ ...base, groupingSec: NC_GROUPING_MIN_SEC }).success).toBe(true)
    expect(NcRuleInputSchema.safeParse({ ...base, groupingSec: NC_GROUPING_MAX_SEC }).success).toBe(true)
    expect(NcRuleInputSchema.safeParse({ ...base, groupingSec: NC_GROUPING_MAX_SEC + 1 }).success).toBe(false)
    expect(NcRuleInputSchema.safeParse({ ...base, groupingSec: 4 }).success).toBe(false)
  })

  it('the patch schema carries groupingSec and drops the retired keys', () => {
    const patch = NcRulePatchSchema.parse({ groupingSec: 30, waitForEnhancement: true, groupIdleSec: 5 })
    expect(patch).toEqual({ groupingSec: 30 })
  })

  it('accepts the clearable keys the hub accepts, retired ones included', () => {
    for (const key of ['groupingSec', 'waitForEnhancement', 'groupIdleSec']) {
      expect(NcRuleClearableKeySchema.safeParse(key).success).toBe(true)
    }
  })
})

// ── The `.partial()` trap, checked rather than assumed ──────────────
//
// Commit `e0921ac6e`, found in production 2026-08-12: `NcRulePatchSchema` was
// `NcRuleInputSchema.partial()`, and Zod 4 `.partial()` KEEPS the inner
// `.default()`. Parsing `{ name: 'x' }` therefore materialised every defaulted
// key, and the merge wrote them over the rule — a camera- and zone-scoped rule
// silently became one that matched everything.
//
// This app now sends a patch for THREE rule families. Two of the three patch
// schemas are `.partial()` derivations, which is only safe while their Input
// carries no `.default()` — and "carries no default today" is exactly the kind
// of fact that stops being true without anyone noticing.

describe('a one-key patch stays a one-key patch', () => {
  it('NcRulePatchSchema materialises nothing', () => {
    expect(Object.keys(NcRulePatchSchema.parse({ name: 'x' }))).toEqual(['name'])
  })

  it('the hand-written rule patch covers EVERY input field', () => {
    // The price of hand-writing it: a field added to the Input and forgotten
    // here is a field the phone can never change, silently. `.partial()` would
    // have got that for free and cost the defaults instead — the same trade
    // `timelapse-rule.ts` makes, pinned the same way.
    expect(Object.keys(NcRulePatchSchema.shape).sort()).toEqual(
      Object.keys(NcRuleInputSchema.shape).sort(),
    )
  })

  it('NcSummaryRulePatchSchema materialises nothing', () => {
    expect(Object.keys(NcSummaryRulePatchSchema.parse({ name: 'x' }))).toEqual(['name'])
    // The two the phone is most likely to touch alone, named explicitly: a
    // resurrected `enabled: true` would silently re-enable a rule the operator
    // had switched off, and a resurrected `priority` would undo a per-rule
    // urgency set from the desktop.
    const patched = NcSummaryRulePatchSchema.parse({ enabled: false })
    expect(patched).toEqual({ enabled: false })
  })
})

// ── Template-variable catalog / preview (Task 4) ────────────────────────────

describe('template-variable catalog client', () => {
  it('getTemplateCatalog routes to pipeline-analytics and validates the payload', async () => {
    const mutate = vi.fn().mockResolvedValue({
      vars: [{ name: 'camera', label: 'Camera', example: 'Gate', group: 'subject', families: ['rule'] }],
    })
    const client = makeNcClient({ addonsCustomMutate: mutate })
    const result = await client.getTemplateCatalog()
    expect(mutate).toHaveBeenCalledWith({ addonId: 'pipeline-analytics', action: 'nc.getTemplateCatalog', input: {} })
    expect(result.vars[0]?.name).toBe('camera')
  })

  it('previewTemplate routes to pipeline-analytics with context + template on the wire', async () => {
    const mutate = vi.fn().mockResolvedValue({ title: 'Gate: person', body: null, unknown: ['tiles'] })
    const client = makeNcClient({ addonsCustomMutate: mutate })
    const context = { family: 'rule' as const, field: 'title' as const, kind: 'detection' as const }
    const result = await client.previewTemplate(context, { title: '{{camera}}: {{class}}' })
    expect(mutate).toHaveBeenCalledWith({
      addonId: 'pipeline-analytics',
      action: 'nc.previewTemplate',
      input: { context, template: { title: '{{camera}}: {{class}}' } },
    })
    expect(result).toEqual({ title: 'Gate: person', body: null, unknown: ['tiles'] })
  })

  it('previewTemplate sends a FAMILY kind as `system` plus the event kinds it watches — every hub parses it (D637)', async () => {
    // A pre-D637 hub's input enum is the strict five: `device-events` would be
    // refused. `system` + the family's event kinds asks the same question of
    // both hubs.
    const mutate = vi.fn().mockResolvedValue({ title: null, body: null, unknown: [] })
    const client = makeNcClient({ addonsCustomMutate: mutate })
    await client.previewTemplate({ family: 'rule', field: 'body', kind: 'alarm' }, { body: '{{mode}}' })
    const sent = mutate.mock.lastCall?.[0]?.input?.context
    expect(sent?.kind).toBe('system')
    expect(sent?.systemEventKinds).toEqual(expect.arrayContaining(['alarm-armed', 'alarm-triggered']))
    expect(sent?.systemEventKinds).not.toContain('device-offline')

    await client.previewTemplate(
      { family: 'rule', field: 'body', kind: 'device-events', systemEventKinds: ['device-battery-low'] },
      { body: '{{deviceName}}' },
    )
    expect(mutate.mock.lastCall?.[0]?.input?.context).toEqual({
      family: 'rule',
      field: 'body',
      kind: 'system',
      systemEventKinds: ['device-battery-low'],
    })

    // A mixed rule with kinds sends ITS kinds.
    await client.previewTemplate(
      { family: 'rule', field: 'body', kind: 'mixed', systemEventKinds: ['device-offline', 'alarm-armed'] },
      { body: '{{eventKind}}' },
    )
    expect(mutate.mock.lastCall?.[0]?.input?.context).toEqual({
      family: 'rule',
      field: 'body',
      kind: 'system',
      systemEventKinds: ['device-offline', 'alarm-armed'],
    })

    // A camera kind travels as it is.
    await client.previewTemplate({ family: 'rule', field: 'body', kind: 'sound' }, { body: '{{label}}' })
    expect(mutate.mock.lastCall?.[0]?.input?.context).toEqual({ family: 'rule', field: 'body', kind: 'sound' })
  })

  it('a mixed rule with NO event kinds sends `system` alone — never the expanded list an older hub rejects', async () => {
    // Hubs published before 2026-09-25 refuse `alarm-pending`, `alarm-rearmed`,
    // `alarm-sensor-bypass` and `alarm-check-failed` in the input enum.
    const mutate = vi.fn().mockResolvedValue({ title: null, body: null, unknown: [] })
    const client = makeNcClient({ addonsCustomMutate: mutate })
    for (const systemEventKinds of [undefined, []]) {
      await client.previewTemplate(
        { family: 'rule', field: 'body', kind: 'mixed', systemEventKinds },
        { body: '{{eventKind}}' },
      )
      const sent = mutate.mock.lastCall?.[0]?.input?.context
      expect(sent).toEqual({ family: 'rule', field: 'body', kind: 'system' })
      expect(sent).not.toHaveProperty('systemEventKinds')
    }
  })

  // The mirror is pinned against the REAL catalog the hub serves — imported
  // from the published types (1.2.250+) rather than hand-copied, so a
  // descriptor shape the mirror cannot parse fails here the day it ships.
  it('the mirrored descriptor schema accepts every descriptor of the shared catalog', () => {
    expect(NC_TEMPLATE_VARS.length).toBeGreaterThan(40)
    const rejected = NC_TEMPLATE_VARS.filter(
      (descriptor) => !NcTemplateVarDescriptorSchema.safeParse(descriptor).success,
    ).map((descriptor) => descriptor.name)
    expect(rejected).toEqual([])
  })

  it('parses a null title/body preview result', () => {
    const parsed = NcTemplatePreviewResultSchema.safeParse({ title: null, body: null, unknown: [] })
    expect(parsed.success).toBe(true)
  })
})

describe('system-event kinds mirror — the four alarm additions round-trip', () => {
  // A rule authored on the admin UI with one of these kinds used to vanish
  // from the phone: `safeParse` failed on the whole rule, not just the
  // condition, because the mirror did not recognise the member.
  it.each([
    'alarm-pending',
    'alarm-rearmed',
    'alarm-sensor-bypass',
    'alarm-check-failed',
  ] as const)('%s round-trips through the mirrored enum', (kind) => {
    const parsed = NcSystemEventKindSchema.safeParse(kind)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data).toBe(kind)
  })

  it('a system-event rule carrying the new kinds parses end to end', () => {
    const rule = NcRuleInputSchema.safeParse({
      name: 'Alarm lifecycle',
      delivery: 'system-event',
      conditions: {
        systemEvent: {
          kinds: ['alarm-pending', 'alarm-rearmed', 'alarm-sensor-bypass', 'alarm-check-failed'],
        },
      },
      targets: [{ targetId: 'target-1' }],
      media: { attach: 'none' },
    })
    expect(rule.success).toBe(true)
    expect(rule.success && rule.data.conditions.systemEvent?.kinds).toEqual([
      'alarm-pending',
      'alarm-rearmed',
      'alarm-sensor-bypass',
      'alarm-check-failed',
    ])
  })
})

describe('system-event kinds mirror — member for member with the published cap', () => {
  // A rule carrying a kind this build cannot decode fails safeParse WHOLE and
  // vanishes from the phone. `wrapper-update-available` and `backup-completed`
  // were published in types 1.2.247 and missing here.
  it.each(['wrapper-update-available', 'backup-completed', 'device-consumable-low', 'device-consumable-normal'] as const)(
    '%s parses',
    (kind) => {
      expect(NcSystemEventKindSchema.safeParse(kind).success).toBe(true)
    },
  )

  it('carries exactly the published members', () => {
    expect([...NcSystemEventKindSchema.options].sort()).toEqual([...PublishedSystemEventKindSchema.options].sort())
  })
})

describe('system-event kinds mirror — a node restarting / updating (hub D723)', () => {
  it.each(['node-restarting', 'node-updating'] as const)('%s parses, and a rule carrying it survives', (kind) => {
    expect(NcSystemEventKindSchema.safeParse(kind).success).toBe(true)
    const rule = NcRuleInputSchema.safeParse({
      name: 'Restarts',
      delivery: 'system-event',
      conditions: { systemEvent: { kinds: [kind] } },
      targets: [{ targetId: 'target-1' }],
      media: { attach: 'none' },
    })
    expect(rule.success && rule.data.conditions.systemEvent?.kinds).toEqual([kind])
  })
})

describe('persisted rule — the admin-authored fields survive a parse', () => {
  const persisted = {
    id: 'r1',
    name: 'Gate',
    enabled: true,
    delivery: 'immediate',
    conditions: {},
    targets: [{ targetId: 't1' }],
    targetUsers: ['u-anna'],
    media: { attach: 'best', linkedCameras: 'each' },
    throttle: { cooldownSec: 60, scope: 'rule-device' },
    priority: 3,
    actions: {
      onActivation: [{ kind: 'sequence', sequenceId: 'seq-arm' }],
      onTrigger: [
        { kind: 'sequence', sequenceId: 'seq-siren' },
        { kind: 'do', action: { kind: 'cap', deviceId: 7, cap: 'switch', method: 'turnOn', args: { level: 5 } } },
      ],
      onTriggerOff: [{ kind: 'do', action: { kind: 'wait', seconds: 2 } }],
      buttons: [{ id: 'b1', label: 'Siren', sequenceId: 'seq-siren', icon: 'alert', destructive: true }],
    },
    confirm: { enabled: true, profileId: 'p1', prompt: 'a car?', expect: { op: '>=', count: 2 }, timeoutMs: 5000, onTimeout: 'suppress', maxImagePx: 512 },
    groupingSec: 20,
    createdBy: 'admin',
    createdAt: 1,
    updatedAt: 2,
    disabledTargetIds: [],
  }

  it('keeps targetUsers, actions, confirm, groupingSec and media.linkedCameras', () => {
    const parsed = NcRuleSchema.parse(persisted)
    expect(parsed.targetUsers).toEqual(persisted.targetUsers)
    expect(parsed.actions).toEqual(persisted.actions)
    expect(parsed.confirm).toEqual(persisted.confirm)
    expect(parsed.groupingSec).toBe(20)
    expect(parsed.media.linkedCameras).toBe('each')
  })

  it('a rule still carrying the LEGACY inline sequences is refused, not half-parsed', () => {
    // The hub migrates these at boot; a mirror that accepted them would let the
    // phone write back a shape the hub's input schema rejects.
    const legacy = { ...persisted, actions: { onTrigger: [{ name: 'siren', enabled: true, actions: [{ kind: 'wait', seconds: 1 }] }] } }
    expect(NcRuleSchema.safeParse(legacy).success).toBe(false)
  })

  it('a rule addressed only to USERS (no targets) does not vanish', () => {
    // The hub's `targets` has no `.min(1)` — `targetUsers` alone is an addressee.
    expect(NcRuleSchema.safeParse({ ...persisted, targets: [] }).success).toBe(true)
  })
})

describe('setRuleEnabled wire — the owner-gated rule update, carrying ONLY `enabled`', () => {
  // `notificationRules.setRuleEnabled` on the cap router is admin-only; the
  // bridge's `nc.updateRule` is gated on ownership (admin or owner), which is
  // exactly who the row offers the switch to, and it lets a stored `mixed`
  // rule be toggled (D637: a patch that leaves the kinds alone passes).
  it('sends nc.updateRule with a patch of enabled and nothing else', async () => {
    const mutate = vi.fn().mockRejectedValue(new Error('wire captured'))
    const client = makeNcClient({ addonsCustomMutate: mutate })
    await expect(client.setRuleEnabled('r1', false)).rejects.toThrow('wire captured')
    expect(mutate).toHaveBeenCalledWith({
      addonId: 'pipeline-analytics',
      action: 'nc.updateRule',
      input: { ruleId: 'r1', patch: { enabled: false } },
    })
  })
})
