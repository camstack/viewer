/**
 * The condition-catalog mirror, and the boundary that has now failed twice.
 *
 * The app mirrors the hub's cap schemas locally, so ANY condition the hub adds
 * before the app is rebuilt is an unknown member. `z.array(Schema).parse()`
 * rejects the whole array on one unknown member, so:
 *
 *   - when the hub began serving `occupancy`, the rule editor lost ALL of its
 *     conditions;
 *   - when the hub began serving `crossingSelect`, it lost them again — that
 *     was live on 2026-08-04, with the hub serving 21 descriptors and the app
 *     rendering none.
 *
 * Adding the missing name fixes one instance. These tests pin the fix for the
 * CLASS: an undecodable descriptor costs that one descriptor.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  NcConditionCatalogResultSchema,
  NcConditionsSchema,
  NcListRulesResultSchema,
} from '../notification-center.js'

function descriptor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'devices',
    group: 'scope',
    label: 'Cameras',
    valueType: 'deviceIdList',
    operator: 'in',
    appliesTo: ['immediate'],
    phase: 'P1',
    ...overrides,
  }
}

describe('NcConditionCatalogResultSchema', () => {
  it('keeps every descriptor it understands when one is from a NEWER hub', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const parsed = NcConditionCatalogResultSchema.parse({
      catalog: [
        descriptor(),
        descriptor({ id: 'fromTheFuture', valueType: 'somethingThisBuildHasNeverHeardOf' }),
        descriptor({ id: 'classes', group: 'class', valueType: 'stringList' }),
      ],
    })

    expect(parsed.catalog.map((c) => c.id)).toEqual(['devices', 'classes'])
    // Not silent: an editor missing a condition the hub offers is a real gap.
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain('fromTheFuture')
    warn.mockRestore()
  })

  it('renders the crossing condition rather than dropping it', () => {
    const parsed = NcConditionCatalogResultSchema.parse({
      catalog: [descriptor({ id: 'crossing', group: 'zones', valueType: 'crossingSelect' })],
    })
    expect(parsed.catalog).toHaveLength(1)
    expect(parsed.catalog[0]!.valueType).toBe('crossingSelect')
  })

  it('survives a catalog whose members are ALL unknown, instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const parsed = NcConditionCatalogResultSchema.parse({
      catalog: [descriptor({ id: 'a', valueType: 'nope' }), descriptor({ id: 'b', group: 'nope' })],
    })
    expect(parsed.catalog).toEqual([])
    warn.mockRestore()
  })

  it('is unchanged for a catalog this build fully understands', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const parsed = NcConditionCatalogResultSchema.parse({ catalog: [descriptor()] })
    expect(parsed.catalog).toHaveLength(1)
    // A healthy catalog says nothing.
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('NcConditionsSchema — a mirrored rule must round-trip', () => {
  it('PRESERVES `crossing` on a save', () => {
    // The failure this pins: a field the app does not mirror is stripped by
    // Zod when the rule is parsed, and writing the rule back wipes whatever the
    // admin UI configured. That is exactly how editing a rule from the phone
    // once destroyed its media policy.
    const parsed = NcConditionsSchema.parse({ crossing: 'exit', classes: ['person'] })
    expect(parsed.crossing).toBe('exit')
  })

  it('leaves `crossing` absent when it was absent, so an untouched rule is byte-identical', () => {
    const parsed = NcConditionsSchema.parse({ classes: ['person'] })
    expect('crossing' in parsed).toBe(false)
  })

  it('accepts each direction the hub can send', () => {
    for (const c of ['enter', 'exit', 'any'] as const) {
      expect(NcConditionsSchema.parse({ crossing: c }).crossing).toBe(c)
    }
  })

  it('PRESERVES `occupancy` on a save', () => {
    // The same class of failure, third instance: the hub shipped the whole
    // occupancy engine and the app mirrored the catalog GROUP but not the
    // condition, so a rule carrying one was silently stripped of it the moment
    // it was edited from the phone.
    const parsed = NcConditionsSchema.parse({
      occupancy: { zoneId: 'z1', className: 'person', op: '>=', count: 2, sustainSeconds: 20 },
    })
    expect(parsed.occupancy).toEqual({
      zoneId: 'z1',
      className: 'person',
      op: '>=',
      count: 2,
      sustainSeconds: 20,
    })
  })

  it('applies the cap defaults to a partially-authored occupancy condition', () => {
    expect(NcConditionsSchema.parse({ occupancy: {} }).occupancy).toEqual({
      op: 'became-occupied',
      count: 1,
      sustainSeconds: 15,
    })
  })

  it('leaves `occupancy` absent when it was absent', () => {
    expect('occupancy' in NcConditionsSchema.parse({ classes: ['person'] })).toBe(false)
  })
})

describe('descriptor options — the third copy of the vocabulary', () => {
  it('carries the choices the hub sends', () => {
    const parsed = NcConditionCatalogResultSchema.parse({
      catalog: [
        descriptor({
          id: 'crossing',
          group: 'zones',
          valueType: 'crossingSelect',
          options: [
            { value: '', label: 'Not set — entering', hint: 'Entries only.' },
            { value: 'exit', label: 'Left a zone' },
          ],
        }),
      ],
    })
    expect(parsed.catalog[0]!.options).toHaveLength(2)
    expect(parsed.catalog[0]!.options?.[0]?.hint).toBe('Entries only.')
  })

  it('accepts a descriptor with NO options — an older hub is not an error', () => {
    // Absent means "use your own list", never "no choices". A build that
    // treated absence as an empty control would render a select with nothing
    // in it the moment it met a hub older than this field.
    const parsed = NcConditionCatalogResultSchema.parse({
      catalog: [descriptor({ id: 'source', valueType: 'sourceSelect' })],
    })
    expect(parsed.catalog).toHaveLength(1)
    expect(parsed.catalog[0]!.options).toBeUndefined()
  })

  it('does not reject a descriptor whose options carry a value this build has never seen', () => {
    // The whole point: a NEW choice on an EXISTING valueType must reach the app
    // without an app build.
    const parsed = NcConditionCatalogResultSchema.parse({
      catalog: [
        descriptor({
          id: 'source',
          valueType: 'sourceSelect',
          options: [{ value: 'from-the-future', label: 'Something new' }],
        }),
      ],
    })
    expect(parsed.catalog[0]!.options?.[0]?.value).toBe('from-the-future')
  })
})

describe('NcListRulesResultSchema — the operator\'s own configuration', () => {
  function rule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'r1',
      name: 'Front door',
      enabled: true,
      delivery: 'immediate',
      conditions: {},
      // `targets` is min(1) and `readOnly` / the server stamps are required —
      // a fixture that omits them tests the fixture, not the parser.
      targets: [{ targetId: 't1' }],
      media: { attach: 'best' },
      priority: 3,
      createdBy: 'u1',
      createdAt: 1,
      updatedAt: 1,
      readOnly: false,
      ...overrides,
    }
  }

  it('keeps the rules it understands when one uses a delivery from a NEWER hub', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const parsed = NcListRulesResultSchema.parse({
      rules: [rule(), rule({ id: 'r2', delivery: 'something-new' }), rule({ id: 'r3' })],
    })
    // The whole list used to go. Losing ONE rule is bad; losing the screen is
    // indistinguishable from having no rules at all.
    expect(parsed.rules.map((r) => r.id)).toEqual(['r1', 'r3'])
    expect(String(warn.mock.calls[0]?.[0])).toContain('r2')
    warn.mockRestore()
  })

  it('names the rule it dropped, so the gap is visible rather than survived', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    NcListRulesResultSchema.parse({ rules: [rule({ id: 'broken', media: 'not-an-object' })] })
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain('broken')
    warn.mockRestore()
  })

  it('says nothing for a list it fully understands', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const parsed = NcListRulesResultSchema.parse({ rules: [rule()] })
    expect(parsed.rules).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
