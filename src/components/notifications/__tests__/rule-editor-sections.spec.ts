/**
 * The section model the rule SUMMARY screen renders.
 *
 * Asserted here: the list IS the shared `ruleEditorSectionsForKind` (so the
 * admin tabs and the phone's rows cannot drift), Actions is admin-only, every
 * form field belongs to exactly one section, and the Devices / Conditions
 * sub-screens split the condition catalog without overlap.
 */
import { describe, expect, it } from 'vitest'
import { NC_RULE_EDITOR_SECTION_ORDER, ruleEditorSectionsForKind } from '@camstack/types/client'
import type { NcRuleKind } from '@camstack/types'
import { emptyRuleForm } from '../rule-editor.js'
import {
  NC_VIEWER_SECTION_FIELDS,
  advancedConditionsFor,
  conditionsForSection,
  editorSectionLabelKey,
  editorSectionsFor,
  kindBlurbKey,
  parseSectionKey,
} from '../rule-editor-sections.js'
import { NC_CONDITION_CATALOG } from '@camstack/types'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'

const KINDS: readonly NcRuleKind[] = [
  'detection',
  'sensor',
  'sound',
  'occupancy',
  'device-events',
  'system',
  'alarm',
  'mixed',
]

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

describe('the viewer editor sections ARE the shared ones', () => {
  it('matches ruleEditorSectionsForKind for an admin, key for key and in order', () => {
    for (const kind of KINDS) {
      expect(editorSectionsFor(kind, true).map((s) => s.key), kind).toEqual(
        ruleEditorSectionsForKind(kind).map((s) => s.key),
      )
    }
  })

  it('a system rule has no Devices section', () => {
    expect(editorSectionsFor('system', true).map((s) => s.key)).not.toContain('devices')
    expect(editorSectionsFor('occupancy', true).map((s) => s.key)).toContain('devices')
  })

  it('a non-admin gets no Actions section — the hub refuses the field', () => {
    expect(editorSectionsFor('detection', false).map((s) => s.key)).not.toContain('actions')
    expect(editorSectionsFor('detection', true).map((s) => s.key)).toContain('actions')
  })

  it('every form field is claimed by exactly one section', () => {
    const claimed = Object.values(NC_VIEWER_SECTION_FIELDS).flat()
    const fields = Object.keys(emptyRuleForm())
    expect([...claimed].sort()).toEqual([...fields].sort())
    expect(new Set(claimed).size).toBe(claimed.length)
  })

  it('each section carries its own claim list', () => {
    for (const section of editorSectionsFor('detection', true)) {
      expect(section.fields).toBe(NC_VIEWER_SECTION_FIELDS[section.key])
    }
  })

  it('parseSectionKey accepts only the shared keys', () => {
    for (const key of NC_RULE_EDITOR_SECTION_ORDER) expect(parseSectionKey(key)).toBe(key)
    expect(parseSectionKey('targets')).toBeUndefined()
    expect(parseSectionKey(undefined)).toBeUndefined()
  })
})

describe('section headings', () => {
  it('NAMES the conditions section after the kind', () => {
    expect(editorSectionLabelKey('conditions', 'sound')).toBe('v2.nc.rules.editor.kindSection.sound')
    expect(editorSectionLabelKey('rule', 'sound')).toBe('v2.nc.rules.editor.section.rule')
    expect(editorSectionsFor('occupancy', true).find((s) => s.key === 'conditions')?.titleKey).toBe(
      'v2.nc.rules.editor.kindSection.occupancy',
    )
  })

  const KEYS: readonly string[] = [
    ...KINDS.flatMap((kind) => editorSectionsFor(kind, true).map((s) => s.titleKey)),
    ...(['occupancy', 'sound', 'sensor', 'device-events', 'system', 'alarm', 'mixed'] as const).map(kindBlurbKey),
  ]

  it.each(KEYS)('%s exists in both locales', (key) => {
    expect(lookupLocale(enLocale, key), `en is missing ${key}`).toBeTruthy()
    expect(lookupLocale(itLocale, key), `it is missing ${key}`).toBeTruthy()
  })
})

describe('the Devices and Conditions sub-screens split the catalog', () => {
  const ALL = ['immediate', 'device-event', 'system-event']
  const CATALOG = [
    { id: 'devices', appliesTo: ALL },
    { id: 'classes', appliesTo: ALL },
    { id: 'audio', appliesTo: ALL },
    { id: 'occupancy', appliesTo: ALL },
  ] as const

  it('Devices edits only the device scope', () => {
    for (const kind of KINDS) {
      expect(conditionsForSection('devices', kind, 'immediate', CATALOG).map((d) => d.id)).toEqual([
        'devices',
      ])
    }
  })

  it('a detection rule’s Conditions offer no audio, occupancy or devices', () => {
    const ids = conditionsForSection('conditions', 'detection', 'immediate', CATALOG).map((d) => d.id)
    expect(ids).toContain('classes')
    expect(ids).not.toContain('audio')
    expect(ids).not.toContain('occupancy')
    expect(ids).not.toContain('devices')
  })

  it('a sound rule’s Conditions offer audio', () => {
    const ids = conditionsForSection('conditions', 'sound', 'immediate', CATALOG).map((d) => d.id)
    expect(ids).toContain('audio')
    expect(ids).not.toContain('devices')
  })

  it('D641: devicesExclude belongs to the Devices field, never to Conditions', () => {
    const catalog = [...CATALOG, { id: 'devicesExclude', appliesTo: ALL }] as const
    expect(conditionsForSection('devices', 'detection', 'immediate', catalog).map((d) => d.id)).toEqual([
      'devices',
      'devicesExclude',
    ])
    expect(conditionsForSection('conditions', 'detection', 'immediate', catalog).map((d) => d.id)).not.toContain(
      'devicesExclude',
    )
  })

  it('honours the trigger: a descriptor that does not apply to the delivery is hidden', () => {
    const catalog = [{ id: 'classes', appliesTo: ['device-event'] }] as const
    expect(conditionsForSection('conditions', 'detection', 'immediate', catalog)).toEqual([])
  })
})

/**
 * Operator, 2026-10-01 (R6): no "show advanced configuration" toggle. The
 * detection source and the zone crossing live in the Advanced section;
 * everything else a kind can use is always in Conditions.
 */
describe('the Advanced section holds the source and the crossing', () => {
  it('a detection rule: Conditions never carry them, Advanced carries both', () => {
    const conditions = conditionsForSection('conditions', 'detection', 'immediate', NC_CONDITION_CATALOG).map(
      (d) => d.id,
    )
    expect(conditions).not.toContain('source')
    expect(conditions).not.toContain('crossing')
    expect(conditions).toEqual(expect.arrayContaining(['classes', 'minConfidence', 'zones', 'identities']))
    expect(advancedConditionsFor('detection', 'immediate', NC_CONDITION_CATALOG).map((d) => d.id)).toEqual([
      'crossing',
      'source',
    ])
  })

  it('only where the kind and trigger use them: a track-end rule has no crossing, a sound rule neither', () => {
    expect(advancedConditionsFor('detection', 'track-end', NC_CONDITION_CATALOG).map((d) => d.id)).toEqual([
      'source',
    ])
    expect(advancedConditionsFor('sound', 'immediate', NC_CONDITION_CATALOG)).toEqual([])
  })

  it('its heading exists in both locales', () => {
    expect(lookupLocale(enLocale, 'v2.nc.rules.editor.advancedConditionsTitle')).toBeTypeOf('string')
    expect(lookupLocale(itLocale, 'v2.nc.rules.editor.advancedConditionsTitle')).toBeTypeOf('string')
  })
})
