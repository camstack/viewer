import { describe, it, expect } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import {
  DEFAULT_NC_TAB,
  NC_TAB_ORDER,
  NC_TAB_LABEL_KEYS,
  buildNcTabs,
  ncTabsFor,
  visibleNcTab,
  type NcTabKey,
} from '../nc-tabs.js'

/** Resolve a dotted i18n key (`v2.nc.tabs.rules`) against a locale JSON tree. */
function lookup(tree: unknown, key: string): string {
  const value = key.split('.').reduce<unknown>((node, part) => {
    if (node != null && typeof node === 'object' && part in node) {
      return (node as Record<string, unknown>)[part]
    }
    return undefined
  }, tree)
  if (typeof value !== 'string') throw new Error(`missing i18n key: ${key}`)
  return value
}

describe('nc-tabs', () => {
  it('defaults to the Rules tab', () => {
    expect(DEFAULT_NC_TAB).toBe('rules')
    // Rules is first so it is the default segment on open.
    expect(NC_TAB_ORDER[0]).toBe('rules')
  })

  it('orders Rules, Targets, Snooze, then Alarm', () => {
    expect(NC_TAB_ORDER).toEqual<readonly NcTabKey[]>(['rules', 'targets', 'snooze', 'alarm'])
  })

  it('offers the Alarm section to a CONFIRMED admin only', () => {
    expect(ncTabsFor('admin')).toEqual(['rules', 'targets', 'snooze', 'alarm'])
    // Pending and unknown hide it, exactly like not-admin: the alarm actions
    // are admin-only and a section must not appear and then vanish (D315).
    for (const verdict of ['pending', 'unknown', 'not-admin'] as const) {
      expect(ncTabsFor(verdict)).toEqual(['rules', 'targets', 'snooze'])
    }
  })

  it('falls back to Rules when the selected section is no longer offered', () => {
    expect(visibleNcTab('alarm', 'admin')).toBe('alarm')
    expect(visibleNcTab('alarm', 'not-admin')).toBe('rules')
    expect(visibleNcTab('snooze', 'not-admin')).toBe('snooze')
  })

  it('resolves each tab label through its i18n key', () => {
    const tabs = buildNcTabs((key) => `label:${key}`, 'admin')
    expect(tabs).toEqual([
      { value: 'rules', label: `label:${NC_TAB_LABEL_KEYS.rules}` },
      { value: 'targets', label: `label:${NC_TAB_LABEL_KEYS.targets}` },
      { value: 'snooze', label: `label:${NC_TAB_LABEL_KEYS.snooze}` },
      { value: 'alarm', label: `label:${NC_TAB_LABEL_KEYS.alarm}` },
    ])
  })

  it('has every tab label present in the English locale', () => {
    const tabs = buildNcTabs((key) => lookup(enLocale, key), 'admin')
    expect(tabs.map((tab) => tab.label)).toEqual(['Rules', 'Targets', 'Snooze', 'Alarm'])
  })

  it('has every tab label present in the Italian locale', () => {
    const tabs = buildNcTabs((key) => lookup(itLocale, key), 'admin')
    expect(tabs.map((tab) => tab.label)).toEqual(['Regole', 'Targets', 'Silenzia', 'Allarme'])
  })
})
