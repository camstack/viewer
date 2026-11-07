/**
 * D1019 on the phone — a rule whose delivery is `modes` must PARSE (the old
 * strict union dropped the whole rule), read like the hub reads it, say its
 * moments in one read-only line, and survive a save from the phone unchanged.
 */
import { describe, expect, it } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import {
  NcListRulesResultSchema,
  NcRuleInputSchema,
  type NcSchedule,
  type NcViewerRule,
} from '../../../data/notification-center.js'
import { ruleSaveRequest } from '../../../screens/notifications/rule-editor/rule-draft-source.js'
import { inputToForm } from '../rule-editor.js'
import { deliveryModesLine, NC_DELIVERY_MODES_KEYS } from '../rule-summary-lines.js'
import {
  isModesDelivery,
  scheduleForSendTimes,
  systemEventDeliveryForSave,
  systemEventDeliveryModesOf,
  NC_SUMMARY_DELIVERY_LABEL_KEYS,
} from '../system-event-delivery.js'

const BASE = {
  id: 'r1',
  enabled: true,
  targets: [{ targetId: 't1' }],
  media: { attach: 'none' },
  throttle: { cooldownSec: 60, scope: 'rule-device' },
  priority: 3,
  createdBy: 'u1',
  createdAt: 1,
  updatedAt: 2,
  disabledTargetIds: [],
  readOnly: false,
  name: 'Doors and batteries',
  delivery: 'system-event',
  conditions: { systemEvent: { kinds: ['device-battery-low'] } },
}

const DAILY_8: NcSchedule = scheduleForSendTimes([{ days: [0, 1, 2, 3, 4, 5, 6], minute: 480 }])
const MODES = {
  mode: 'modes',
  onActivation: true,
  onDeactivation: true,
  onSchedule: { schedule: DAILY_8, grouping: 'section' },
} as const

function served(systemEventDelivery: unknown): NcViewerRule | undefined {
  return NcListRulesResultSchema.parse({ rules: [{ ...BASE, systemEventDelivery }] }).rules[0]
}

const tr = (locale: unknown) => (key: string, params?: Readonly<Record<string, string>>): string => {
  let node: unknown = locale
  for (const part of key.split('.')) node = (node as Record<string, unknown>)[part]
  if (typeof node !== 'string') throw new Error(`missing key ${key}`)
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => params?.[name] ?? '')
}

describe('parse', () => {
  it('a modes rule is NOT dropped from the list', () => {
    const rule = served(MODES)
    expect(rule).toBeDefined()
    expect(rule?.systemEventDelivery).toEqual(MODES)
  })
  it('a modes rule without a schedule parses too', () => {
    expect(served({ mode: 'modes', onActivation: true, onDeactivation: false })).toBeDefined()
  })
  it('still refuses a mode nobody defined', () => {
    expect(served({ mode: 'bogus' })).toBeUndefined()
  })
})

describe('systemEventDeliveryModesOf', () => {
  it('legacy instant and absent speak on both edges, no summary', () => {
    const both = { activation: true, deactivation: true, schedule: null }
    expect(systemEventDeliveryModesOf({})).toEqual(both)
    expect(systemEventDeliveryModesOf({ systemEventDelivery: { mode: 'instant' } })).toEqual(both)
  })
  it('legacy summary is schedule-only, grouping defaulting to rule', () => {
    const summary = { mode: 'summary', schedule: DAILY_8 } as const
    expect(systemEventDeliveryModesOf({ systemEventDelivery: summary })).toEqual({
      activation: false,
      deactivation: false,
      schedule: { schedule: DAILY_8, grouping: 'rule' },
    })
    expect(systemEventDeliveryModesOf({ systemEventDelivery: { ...summary, split: 'section' } }).schedule?.grouping).toBe('section')
  })
  it('modes says itself', () => {
    expect(systemEventDeliveryModesOf({ systemEventDelivery: MODES })).toEqual({
      activation: true,
      deactivation: true,
      schedule: { schedule: DAILY_8, grouping: 'section' },
    })
    expect(
      systemEventDeliveryModesOf({ systemEventDelivery: { mode: 'modes', onActivation: false, onDeactivation: true } }),
    ).toEqual({ activation: false, deactivation: true, schedule: null })
  })
  it('isModesDelivery tells the shapes apart', () => {
    expect(isModesDelivery(MODES)).toBe(true)
    expect(isModesDelivery({ mode: 'instant' })).toBe(false)
    expect(isModesDelivery(undefined)).toBe(false)
  })
})

describe('deliveryModesLine', () => {
  it('says only the moments that are on, in both languages', () => {
    expect(deliveryModesLine(MODES, tr(enLocale))).toBe('Starts · Clears · Summary · daily 08:00')
    expect(deliveryModesLine(MODES, tr(itLocale))).toBe('Inizio · Fine · Riepilogo · ogni giorno 08:00')
    expect(deliveryModesLine({ mode: 'modes', onActivation: false, onDeactivation: true }, tr(enLocale))).toBe('Clears')
    expect(deliveryModesLine({ mode: 'modes', onActivation: false, onDeactivation: false }, tr(enLocale))).toBe(
      'No delivery moment',
    )
  })
  it('every key it uses exists in en and it', () => {
    for (const locale of [enLocale, itLocale]) {
      const t = tr(locale)
      for (const key of [...NC_DELIVERY_MODES_KEYS, ...NC_SUMMARY_DELIVERY_LABEL_KEYS]) expect(() => t(key)).not.toThrow()
    }
  })
})

describe('save round trip', () => {
  it('sends the modes object back unchanged', () => {
    const rule = served(MODES)
    if (rule === undefined) throw new Error('dropped')
    const request = ruleSaveRequest(inputToForm(rule), rule, { isAdmin: true, ownTargetIds: ['t1'], hubKeepsSummary: true })
    if (request.mode !== 'update') throw new Error('expected an update')
    expect(request.patch.systemEventDelivery).toEqual(MODES)
    expect(NcRuleInputSchema.parse(request.patch).systemEventDelivery).toEqual(MODES)
  })
  it('a modes rule moved off the system trigger sends instant, as a summary does', () => {
    expect(systemEventDeliveryForSave({ delivery: 'immediate', systemEventDelivery: MODES })).toEqual({
      systemEventDelivery: { mode: 'instant' },
    })
  })
})
