/**
 * Every condition, group, kind blurb, media blurb, AI placeholder and device
 * type the rule editor names — in BOTH locales.
 *
 * The lists are DERIVED from the published catalog/specs on purpose (unlike
 * `family-editors-i18n.spec.ts`): the failure being guarded is a descriptor the
 * hub serves that the phone has no word for, so the hub's vocabulary is the
 * thing to check against. A missing key does not throw — the phone falls back
 * to the hub's English label, or worse, to the raw key.
 */
import { describe, expect, it } from 'vitest'
import { DeviceType, NC_RULE_KIND_SPECS } from '@camstack/types/client'
import { NC_CONDITION_CATALOG } from '@camstack/types'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import {
  NC_RULE_AI_SHAPES,
  ruleAiDefaultPromptKey,
} from '../../../components/notifications/rule-ai-form.js'
import { conditionGroupLabelFallback } from '../../../components/notifications/rule-sections.js'
import {
  kindBlurbKey,
  mediaBlurbKey,
} from '../../../components/notifications/rule-editor-sections.js'
import { deviceTypeLabelKey } from '../../../components/notifications/rule-editor.js'

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

function expectBoth(key: string): void {
  expect(lookupLocale(enLocale, key), `en: ${key}`).toBeTruthy()
  expect(lookupLocale(itLocale, key), `it: ${key}`).toBeTruthy()
}

describe('rule editor condition vocabulary — en + it', () => {
  it('every catalog condition has an Italian and an English label', () => {
    expect(NC_CONDITION_CATALOG.length).toBeGreaterThan(0)
    for (const descriptor of NC_CONDITION_CATALOG) {
      expectBoth(`v2.nc.rules.editor.condition.${descriptor.id}`)
    }
  })

  it('every catalog group has a heading', () => {
    for (const group of new Set(NC_CONDITION_CATALOG.map((d) => d.group))) {
      expectBoth(`v2.nc.rules.editor.group.${group}`)
    }
  })

  it('kindBlurb exists for every kind, or the row is not rendered', () => {
    expect(NC_RULE_KIND_SPECS.length).toBeGreaterThan(0)
    for (const spec of NC_RULE_KIND_SPECS) expectBoth(kindBlurbKey(spec.kind))
  })

  it('every kind that carries a media blurb has it translated', () => {
    const withBlurb = NC_RULE_KIND_SPECS.filter((spec) => spec.mediaBlurb !== undefined)
    expect(withBlurb.length).toBeGreaterThan(0)
    for (const spec of withBlurb) expectBoth(mediaBlurbKey(spec.kind))
  })

  it('the AI prompt placeholder is translated for every shape', () => {
    for (const shape of NC_RULE_AI_SHAPES) expectBoth(ruleAiDefaultPromptKey(shape))
  })

  it('every device type a system rule can be narrowed to has a label', () => {
    for (const type of Object.values(DeviceType)) expectBoth(deviceTypeLabelKey(type))
  })
})

describe('conditionGroupLabelFallback', () => {
  it('never shows a raw i18n key for a group the phone does not know', () => {
    expect(conditionGroupLabelFallback('futureGroup')).toBe('FutureGroup')
    expect(conditionGroupLabelFallback('quality')).toBe('Quality')
    expect(conditionGroupLabelFallback('')).toBe('')
  })
})
