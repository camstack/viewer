import { ruleKindOf } from '@camstack/types/client'
import { describe, expect, it } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import {
  NC_VIEWER_KIND_ORDER,
  creatableKinds,
  isKindLockedOut,
  kindCreateKey,
  kindEmptyKey,
  kindStrip,
  parseKind,
  parseStripKey,
  viewerKindStrip,
  rulesOfKind,
  seedForKind,
} from '../rule-kind-nav.js'

const det = { delivery: 'immediate' as const, conditions: {} }
const sensor = { delivery: 'device-event' as const, conditions: {} }
const sound = { delivery: 'immediate' as const, conditions: { audio: { labels: ['dog'] } } }

describe('kind-first navigation', () => {
  it('lists each rule under exactly one kind — a sensor rule is not a detection rule', () => {
    const rules = [det, sensor, sound]
    expect(rulesOfKind(rules, 'detection')).toEqual([det])
    expect(rulesOfKind(rules, 'sensor')).toEqual([sensor])
    expect(rulesOfKind(rules, 'sound')).toEqual([sound])
    expect(rulesOfKind(rules, 'all')).toHaveLength(3)
  })

  it('counts come from the same predicate as the list', () => {
    const strip = kindStrip([det, sensor, sound])
    expect(strip[0]).toMatchObject({ key: 'all', count: 3 })
    expect(strip.find((tab) => tab.key === 'sensor')?.count).toBe(1)
  })

  it('only an admin may create a system rule', () => {
    expect(creatableKinds(false)).not.toContain('system')
    expect(creatableKinds(true)).toContain('system')
  })

  it('a sensor seed is a device-event rule with no discriminator', () => {
    expect(seedForKind('sensor')).toEqual({ delivery: 'device-event', conditions: {} })
  })

  it('a seed IS its kind', () => {
    for (const kind of ['detection', 'sensor', 'sound', 'occupancy', 'device-events', 'system', 'alarm'] as const) {
      expect(ruleKindOf(seedForKind(kind))).toBe(kind)
    }
  })

  it('a mixed rule cannot be seeded — it is never offered for creation', () => {
    expect(() => seedForKind('mixed')).toThrow('a mixed rule cannot be created')
  })

  it('an editor never offers another kind’s discriminator', () => {
    expect(isKindLockedOut('detection', 'audio')).toBe(true)
    expect(isKindLockedOut('detection', 'occupancy')).toBe(true)
    expect(isKindLockedOut('sound', 'audio')).toBe(false)
    expect(isKindLockedOut('detection', 'classes')).toBe(false)
  })

  it('a discriminator SHARED by a kind group locks out no member of the group', () => {
    // `systemEvent` makes device-events, system, alarm AND mixed: a map from
    // discriminator to ONE kind would lock three of the four out of their own
    // condition.
    for (const kind of ['device-events', 'system', 'alarm', 'mixed'] as const) {
      expect(isKindLockedOut(kind, 'systemEvent')).toBe(false)
    }
    expect(isKindLockedOut('detection', 'systemEvent')).toBe(true)
  })

  it('lists the three families and mixed; a battery-only rule is a device-events rule', () => {
    const battery = { delivery: 'system-event' as const, conditions: { systemEvent: { kinds: ['device-battery-low'] } } }
    const mixed = { delivery: 'system-event' as const, conditions: { systemEvent: { kinds: ['device-offline', 'alarm-armed'] } } }
    // The viewer files a rule by the SHARED `ruleKindOf` — no viewer-only kind.
    expect(ruleKindOf(battery)).toBe('device-events')
    expect(ruleKindOf(mixed)).toBe('mixed')
    expect(rulesOfKind([battery, mixed], 'device-events')).toEqual([battery])
    expect(rulesOfKind([battery, mixed], 'mixed')).toEqual([mixed])
    expect(rulesOfKind([battery, mixed], 'system')).toEqual([])
  })

  it('never offers mixed for creation; families are admin-only', () => {
    expect(creatableKinds(true)).not.toContain('mixed')
    expect(creatableKinds(true)).toEqual(expect.arrayContaining(['device-events', 'system', 'alarm']))
    expect(creatableKinds(false)).toEqual(['detection', 'sensor', 'sound', 'occupancy'])
  })

  it('the strip hides an EMPTY mixed tab for everyone, and shows a populated one', () => {
    expect(viewerKindStrip([], 'admin').map((t) => t.key)).not.toContain('mixed')
    const mixed = { delivery: 'system-event' as const, conditions: { systemEvent: { kinds: ['device-offline', 'alarm-armed'] } } }
    for (const verdict of ['admin', 'not-admin', 'pending', 'unknown'] as const) {
      expect(viewerKindStrip([mixed], verdict).find((t) => t.key === 'mixed')?.count).toBe(1)
    }
  })

  it('the strip lists the kinds in the viewer order', () => {
    expect(NC_VIEWER_KIND_ORDER).toEqual(['detection', 'sensor', 'sound', 'occupancy', 'device-events', 'system', 'alarm', 'mixed'])
  })

  it('parseKind accepts only real kinds', () => {
    expect(parseKind('sound')).toBe('sound')
    expect(parseKind('audio')).toBeUndefined()
    expect(parseKind(undefined)).toBeUndefined()
  })
})

/** Resolve a dotted i18n key against a locale JSON tree, without a cast. */
function lookupLocale(tree: unknown, key: string): string | undefined {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined
    const record: Record<string, unknown> = { ...node }
    node = record[part]
  }
  return typeof node === 'string' ? node : undefined
}

const system = { delivery: 'system-event' as const, conditions: { systemEvent: { kinds: ['node-offline'] } } }

describe('the kind strip the Rules tab shows', () => {
  it('parseStripKey accepts a kind filter or a family key, and nothing else', () => {
    for (const key of ['all', 'detection', 'sensor', 'sound', 'occupancy', 'device-events', 'system', 'alarm', 'mixed', 'timelapse', 'summary']) {
      expect(parseStripKey(key)).toBe(key)
    }
    // `audio` was the OLD section key: a remembered value from before the
    // kind strip must fall back rather than select a tab that no longer exists.
    expect(parseStripKey('audio')).toBeUndefined()
    // `battery` was a viewer-only section before D637 folded it into device events.
    expect(parseStripKey('battery')).toBeUndefined()
    expect(parseStripKey('bogus')).toBeUndefined()
    expect(parseStripKey(null)).toBeUndefined()
    expect(parseStripKey(undefined)).toBeUndefined()
  })

  it('drops an EMPTY system tab only once the hub said the caller is not an admin', () => {
    const keys = (verdict: 'pending' | 'admin' | 'not-admin' | 'unknown') =>
      viewerKindStrip([det], verdict).map((tab) => tab.key)
    expect(keys('not-admin')).not.toContain('system')
    // A FAILED role read hides admin surfaces exactly as before it had a name.
    expect(keys('unknown')).not.toContain('system')
    expect(keys('admin')).toContain('system')
    // Not answered yet is not "absent" (D315).
    expect(keys('pending')).toContain('system')
  })

  it('keeps a system tab that HOLDS rules, whoever is asking', () => {
    const strip = viewerKindStrip([det, system], 'not-admin')
    expect(strip.find((tab) => tab.key === 'system')?.count).toBe(1)
  })

  it('every strip word, create label and empty message exists in both locales', () => {
    const keys = [
      ...kindStrip([]).map((tab) => tab.labelKey),
      ...kindStrip([]).map((tab) => kindCreateKey(tab.key)),
      ...kindStrip([]).map((tab) => kindEmptyKey(tab.key)),
    ]
    for (const key of keys) {
      expect(lookupLocale(enLocale, key), `en ${key}`).toBeTypeOf('string')
      expect(lookupLocale(itLocale, key), `it ${key}`).toBeTypeOf('string')
    }
  })
})
