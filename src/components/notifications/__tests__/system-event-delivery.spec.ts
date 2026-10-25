/**
 * D647 on the phone — the scheduled STATE SUMMARY of a device-events / system
 * rule, and the round trip that must not lose it (or anything else the hub
 * stores) when a rule is saved from the phone.
 *
 * The phone re-sends `conditions` WHOLE and parses every rule through its own
 * mirror, so a key the mirror lacks is stripped on the first save. Each case
 * below starts from what the HUB serves (parsed through the viewer's list
 * schema, as `nc.listRules` is) and ends at what the phone SENDS.
 */
import {
  servedTemplateVars,
  scheduleForSendTimes as publishedScheduleForSendTimes,
  sendTimesOfSchedule as publishedSendTimesOfSchedule,
} from '@camstack/types'
import { describe, expect, it } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import {
  NcListRulesResultSchema,
  NcRuleInputSchema,
  NcTemplateVarDescriptorSchema,
  type NcSchedule,
  type NcViewerRule,
} from '../../../data/notification-center.js'
import { assertSummaryDeliveryLanded, NcSummaryNotKeptError } from '../../../data/nc-errors.js'
import { selectTemplateCatalog } from '../../../data/use-notification-center.js'
import { ruleSaveRequest } from '../../../screens/notifications/rule-editor/rule-draft-source.js'
import { formToInput, inputToForm, ruleClearsFor, ruleFormProblems, type NcRuleFormState } from '../rule-editor.js'
import { NC_VIEWER_SECTION_FIELDS } from '../rule-editor-sections.js'
import { buildRuleRowModel } from '../rule-row.js'
import {
  defaultSummaryDelivery,
  hubKeepsSummaryDelivery,
  isStateSummaryHistoryRow,
  minuteOfHhmm,
  NC_SUMMARY_DELIVERY_LABEL_KEYS,
  NC_SUMMARY_FORM_PROBLEMS,
  scheduleForSendTimes,
  sendTimesOfSchedule,
  summaryBodyWarning,
  summaryDeliveryLabel,
  summaryDeliveryOffered,
  summaryFormProblems,
  systemEventDeliveryForSave,
  type NcSummarySendTime,
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
}

/** A rule as the HUB serves it, through the phone's list parse. */
function served(raw: Record<string, unknown>): NcViewerRule {
  const { rules } = NcListRulesResultSchema.parse({ rules: [{ ...BASE, ...raw }] })
  const rule = rules[0]
  if (rule === undefined) throw new Error('the mirror dropped the rule')
  return rule
}

const DAILY_8: NcSchedule = scheduleForSendTimes([{ days: [0, 1, 2, 3, 4, 5, 6], minute: 480 }])

/** A device-events summary rule carrying every D636/D642/D647 key. */
function summaryRule(extra: Record<string, unknown> = {}): NcViewerRule {
  return served({
    name: 'Morning state',
    delivery: 'system-event',
    conditions: {
      systemEvent: {
        kinds: ['device-battery-low', 'device-consumable-low'],
        excludeDeviceIds: [44],
        consumableLowPercent: 25,
      },
    },
    systemEventDelivery: { mode: 'summary', schedule: DAILY_8 },
    ...extra,
  })
}

function update(
  rule: NcViewerRule,
  form: NcRuleFormState = inputToForm(rule),
  isAdmin = true,
  hubKeepsSummary = true,
) {
  const request = ruleSaveRequest(form, rule, { isAdmin, ownTargetIds: ['t1'], hubKeepsSummary })
  if (request.mode !== 'update') throw new Error('expected an update')
  return request
}

describe('a phone save keeps what the hub stored (round trip)', () => {
  it('keeps excludeDeviceIds, consumableLowPercent and systemEventDelivery on a device-events rule', () => {
    const { patch, clear } = update(summaryRule())
    expect(patch.conditions.systemEvent).toEqual({
      kinds: ['device-battery-low', 'device-consumable-low'],
      excludeDeviceIds: [44],
      consumableLowPercent: 25,
    })
    expect(patch.systemEventDelivery).toEqual({ mode: 'summary', schedule: DAILY_8 })
    expect(clear).toEqual([])
    // …and the patch is one the hub's input schema accepts whole.
    expect(NcRuleInputSchema.parse(patch).systemEventDelivery).toEqual({ mode: 'summary', schedule: DAILY_8 })
  })

  it('keeps devicesExclude and sensorTransition on a sensor rule', () => {
    const rule = served({
      name: 'Doors',
      delivery: 'device-event',
      conditions: { sensorKinds: ['contact'], devicesExclude: [7, 9], sensorTransition: 'raised' },
      media: { attach: 'best' },
    })
    const { patch } = update(rule)
    expect(patch.conditions.devicesExclude).toEqual([7, 9])
    expect(patch.conditions.sensorTransition).toBe('raised')
    expect(patch.conditions.sensorKinds).toEqual(['contact'])
  })

  it('an instant rule authored before D647 saves back WITHOUT the key', () => {
    const rule = served({
      name: 'Low battery',
      delivery: 'system-event',
      conditions: { systemEvent: { kinds: ['device-battery-low'] } },
    })
    expect(rule.systemEventDelivery).toBeUndefined()
    expect(update(rule).patch).not.toHaveProperty('systemEventDelivery')
  })

  it('an explicit instant round-trips as instant', () => {
    const rule = summaryRule({ systemEventDelivery: { mode: 'instant' } })
    expect(update(rule).patch.systemEventDelivery).toEqual({ mode: 'instant' })
  })
})

describe('the save shape of a summary rule', () => {
  it('drops the active-hours schedule beside a summary, and CLEARS a stored one on a D647 hub', () => {
    // Stored as instant with active hours; switched to Summary on the phone.
    const rule = served({
      name: 'Nightly',
      delivery: 'system-event',
      conditions: { systemEvent: { kinds: ['device-battery-low'] } },
      schedule: { windows: [{ days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1080 }] },
    })
    const form: NcRuleFormState = { ...inputToForm(rule), systemEventDelivery: defaultSummaryDelivery() }
    const { patch, clear } = update(rule, form)
    expect(patch).not.toHaveProperty('schedule')
    expect(clear).toContain('schedule')
    // Back to Instant: the active hours come back from the form, untouched.
    const back = formToInput({ ...form, systemEventDelivery: { mode: 'instant' } })
    expect(back.schedule).toEqual(rule.schedule)
    expect(ruleClearsFor({ ...form, systemEventDelivery: { mode: 'instant' } }, { stored: rule })).not.toContain(
      'schedule',
    )
  })

  it('a rule off the system trigger that still holds a summary sends instant (review M4)', () => {
    expect(
      systemEventDeliveryForSave({ delivery: 'device-event', systemEventDelivery: defaultSummaryDelivery() }),
    ).toEqual({ systemEventDelivery: { mode: 'instant' } })
    expect(systemEventDeliveryForSave({ delivery: 'device-event', systemEventDelivery: undefined })).toEqual({})
    expect(systemEventDeliveryForSave({ delivery: 'device-event', systemEventDelivery: { mode: 'instant' } })).toEqual(
      {},
    )
  })
})

describe('switching to Summary on a hub NOT known to keep it (older than D647, or unanswered)', () => {
  const rule = served({
    name: 'Nightly',
    delivery: 'system-event',
    conditions: { systemEvent: { kinds: ['device-battery-low'] } },
    schedule: { windows: [{ days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1080 }] },
  })
  const form: NcRuleFormState = { ...inputToForm(rule), systemEventDelivery: defaultSummaryDelivery() }

  it('never clears the stored active hours — an older hub strips the summary and keeps them', () => {
    const { patch, clear } = update(rule, form, true, false)
    expect(clear).not.toContain('schedule')
    expect(patch).not.toHaveProperty('schedule')
    // What an older hub stores: its merge of the patch, the summary stripped.
    const { systemEventDelivery: _stripped, ...kept } = patch
    const stored = { ...rule, ...kept }
    expect(stored.schedule).toEqual(rule.schedule)
    expect(stored.systemEventDelivery).toBeUndefined()
  })

  it('absent (no signal) counts as not known', () => {
    expect(ruleClearsFor(form, { stored: rule })).not.toContain('schedule')
    expect(ruleClearsFor(form, { stored: rule, hubKeepsSummary: true })).toContain('schedule')
  })

  it('an INSTANT rule still clears an emptied schedule, whatever the hub', () => {
    const emptied: NcRuleFormState = { ...inputToForm(rule), schedule: undefined }
    expect(ruleClearsFor(emptied, { stored: rule, hubKeepsSummary: false })).toContain('schedule')
  })
})

describe('what the hub serves says whether it keeps a summary', () => {
  it('a D647 catalog declares the delivery axis; an older one, an empty or an unanswered one does not', () => {
    const d647 = NcTemplateVarDescriptorSchema.array().parse(servedTemplateVars())
    expect(hubKeepsSummaryDelivery(d647)).toBe(true)
    const older = d647.map(({ systemEventDeliveries: _axis, ...rest }) => rest)
    expect(hubKeepsSummaryDelivery(older)).toBe(false)
    expect(hubKeepsSummaryDelivery([])).toBe(false)
    expect(hubKeepsSummaryDelivery(undefined)).toBe(false)
  })

  it("useNcTemplateCatalog's select restores the held-back summary vocabulary", () => {
    const served = NcTemplateVarDescriptorSchema.array().parse(servedTemplateVars())
    expect(served.map((d) => d.name)).not.toContain('summaryText')
    const selected = selectTemplateCatalog({ vars: served })
    const names = selected.map((d) => d.name)
    for (const name of ['summaryText', 'summaryCount', 'summaryBattery', 'summaryUpdates']) expect(names).toContain(name)
    // Once each, and the served descriptors are all still there.
    expect(names.filter((n) => n === 'summaryText')).toHaveLength(1)
    for (const d of served) expect(names).toContain(d.name)
  })

  it('the restored catalog would lie, so the signal is read BEFORE the restore', () => {
    const d647 = NcTemplateVarDescriptorSchema.array().parse(servedTemplateVars())
    const older = d647.map(({ systemEventDeliveries: _axis, ...rest }) => rest)
    expect(hubKeepsSummaryDelivery(selectTemplateCatalog({ vars: older }))).toBe(true)
  })
})

describe('what the editor offers and refuses (the hub verdict, said before the save)', () => {
  it('offers Delivery on device-events and system rules only — the alarm stays instant, mixed is read-only', () => {
    expect(summaryDeliveryOffered('device-events')).toBe(true)
    expect(summaryDeliveryOffered('system')).toBe(true)
    expect(summaryDeliveryOffered('alarm')).toBe(false)
    expect(summaryDeliveryOffered('mixed')).toBe(false)
    expect(summaryDeliveryOffered('sensor')).toBe(false)
  })

  it('a valid summary rule has no problem', () => {
    expect(ruleFormProblems(inputToForm(summaryRule()), { isAdmin: true })).toEqual([])
  })

  it('refuses a summary beside actions, which would never run', () => {
    const form: NcRuleFormState = {
      ...inputToForm(
        summaryRule({
          actions: { onTrigger: [{ kind: 'do', action: { kind: 'wait', seconds: 1 } }] },
        }),
      ),
    }
    expect(summaryFormProblems(form, { isAdmin: true })).toEqual(['summaryActions'])
    expect(ruleFormProblems(form, { isAdmin: true })).toContain('summaryActions')
    // A user has no Actions section: told an admin must change them.
    expect(summaryFormProblems(form)).toEqual(['summaryActionsByAdmin'])
    expect(ruleFormProblems(form)).toContain('summaryActionsByAdmin')
    expect(ruleFormProblems(form)).not.toContain('summaryActions')
  })

  it('refuses a summary on alarm kinds, and a send time with no day', () => {
    const alarm: NcRuleFormState = {
      ...inputToForm(summaryRule()),
      conditions: { systemEvent: { kinds: ['alarm-triggered'] } },
    }
    expect(summaryFormProblems(alarm)).toEqual(['summaryFamily'])
    const degenerate: NcRuleFormState = {
      ...inputToForm(summaryRule()),
      systemEventDelivery: {
        mode: 'summary',
        schedule: { windows: [{ days: [1], startMinute: 480, endMinute: 480 }] },
      },
    }
    expect(summaryFormProblems(degenerate)).toEqual(['summaryDegenerateWindow'])
    const noDay: NcRuleFormState = {
      ...inputToForm(summaryRule()),
      systemEventDelivery: { mode: 'summary', schedule: { windows: [{ days: [], startMinute: 479, endMinute: 480 }] } },
    }
    expect(summaryFormProblems(noDay)).toEqual(['summaryDegenerateWindow'])
    const empty: NcRuleFormState = {
      ...inputToForm(summaryRule()),
      systemEventDelivery: { mode: 'summary', schedule: { windows: [] } },
    }
    expect(summaryFormProblems(empty)).toEqual(['summaryNoSendTime'])
  })

  it('an instant rule is never judged', () => {
    const form: NcRuleFormState = { ...inputToForm(summaryRule()), systemEventDelivery: { mode: 'instant' } }
    expect(summaryFormProblems(form)).toEqual([])
  })

  it('warns when a custom body names none of the summary', () => {
    const form = inputToForm(summaryRule())
    expect(summaryBodyWarning({ ...form, templateBody: '' })).toBe(false)
    expect(summaryBodyWarning({ ...form, templateBody: 'Good morning' })).toBe(true)
    expect(summaryBodyWarning({ ...form, templateBody: 'Good morning\n{{summaryText}}' })).toBe(false)
    expect(summaryBodyWarning({ ...form, templateBody: '{{ summaryBattery }}' })).toBe(false)
    expect(summaryBodyWarning({ ...form, systemEventDelivery: { mode: 'instant' }, templateBody: 'x' })).toBe(false)
  })

  it('the Conditions section claims the delivery', () => {
    expect(NC_VIEWER_SECTION_FIELDS.conditions).toContain('systemEventDelivery')
  })
})

describe('send times ⇄ schedule (Hermes-safe copies of the published pair)', () => {
  const cases: readonly (readonly NcSummarySendTime[])[] = [
    [{ days: [0, 1, 2, 3, 4, 5, 6], minute: 480 }],
    [{ days: [5, 1, 3], minute: 0 }],
    [
      { days: [1, 2, 3, 4, 5], minute: 450 },
      { days: [6, 0], minute: 1439 },
    ],
    [{ days: [0], minute: 1 }],
  ]

  it('builds the SAME schedule the hub reads, and reads it back', () => {
    for (const times of cases) {
      expect(scheduleForSendTimes(times, 'Europe/Rome')).toEqual(publishedScheduleForSendTimes(times, 'Europe/Rome'))
      const schedule = scheduleForSendTimes(times)
      expect(sendTimesOfSchedule(schedule)).toEqual(publishedSendTimesOfSchedule(schedule))
    }
  })

  it('midnight starts the window at 23:59 of the day before', () => {
    expect(scheduleForSendTimes([{ days: [1], minute: 0 }]).windows).toEqual([
      { days: [0], startMinute: 1439, endMinute: 0 },
    ])
    expect(sendTimesOfSchedule(scheduleForSendTimes([{ days: [1], minute: 0 }]))).toEqual([{ days: [1], minute: 0 }])
  })

  it('a schedule that is not one-minute windows is custom (null)', () => {
    expect(sendTimesOfSchedule({ windows: [{ days: [1], startMinute: 540, endMinute: 1080 }] })).toBeNull()
    expect(sendTimesOfSchedule({ ...DAILY_8, invert: true })).toBeNull()
  })

  it('a typed time is read only when it IS a time', () => {
    expect(minuteOfHhmm('08:00')).toBe(480)
    expect(minuteOfHhmm('7:05')).toBe(425)
    expect(minuteOfHhmm('23:59')).toBe(1439)
    expect(minuteOfHhmm('24:00')).toBeNull()
    expect(minuteOfHhmm('8')).toBeNull()
    expect(minuteOfHhmm('ab:cd')).toBeNull()
  })

  it('the default is every day at 08:00', () => {
    expect(defaultSummaryDelivery()).toEqual({ mode: 'summary', schedule: DAILY_8 })
  })
})

describe('the words — "Summary · daily 08:00"', () => {
  const t = (key: string, params?: Readonly<Record<string, string>>): string => {
    const words: Record<string, string> = {
      'v2.nc.rules.summaryDelivery.daily': 'daily',
      'v2.nc.rules.summaryDelivery.weekdays': 'weekdays',
      'v2.nc.rules.summaryDelivery.weekends': 'weekends',
      'v2.nc.rules.summaryDelivery.custom': 'Summary · custom schedule',
      'v2.nc.rules.editor.weekday.mon': 'Mon',
      'v2.nc.rules.editor.weekday.thu': 'Thu',
      'v2.nc.rules.editor.weekday.sun': 'Sun',
    }
    if (key === 'v2.nc.rules.summaryDelivery.label') return `Summary · ${params?.['when'] ?? ''}`
    return words[key] ?? key
  }

  it('says when, grouped by days', () => {
    expect(summaryDeliveryLabel(DAILY_8, t)).toBe('Summary · daily 08:00')
    expect(
      summaryDeliveryLabel(
        scheduleForSendTimes([
          { days: [1, 2, 3, 4, 5], minute: 1140 },
          { days: [1, 2, 3, 4, 5], minute: 450 },
          { days: [0, 6], minute: 600 },
        ]),
        t,
      ),
    ).toBe('Summary · weekdays 07:30, 19:00; weekends 10:00')
    expect(summaryDeliveryLabel(scheduleForSendTimes([{ days: [4, 1, 0], minute: 0 }]), t)).toBe(
      'Summary · Mon, Thu, Sun 00:00',
    )
  })

  it('a custom schedule is named as one', () => {
    expect(summaryDeliveryLabel({ windows: [{ days: [1], startMinute: 540, endMinute: 1080 }] }, t)).toBe(
      'Summary · custom schedule',
    )
  })

  it('every problem the editor can name has its sentence in en and it', () => {
    const lookup = (tree: unknown, key: string): unknown =>
      key.split('.').reduce<unknown>((node, part) => (typeof node === 'object' && node !== null ? Reflect.get(node, part) : undefined), tree)
    for (const problem of NC_SUMMARY_FORM_PROBLEMS) {
      const key = `v2.nc.rules.editor.problem.${problem}`
      expect(typeof lookup(enLocale, key), `en:${key}`).toBe('string')
      expect(typeof lookup(itLocale, key), `it:${key}`).toBe('string')
    }
  })

  it('every key exists in en and it', () => {
    const lookup = (tree: unknown, key: string): unknown =>
      key.split('.').reduce<unknown>((node, part) => (typeof node === 'object' && node !== null ? Reflect.get(node, part) : undefined), tree)
    for (const key of NC_SUMMARY_DELIVERY_LABEL_KEYS) {
      expect(typeof lookup(enLocale, key), `en:${key}`).toBe('string')
      expect(typeof lookup(itLocale, key), `it:${key}`).toBe('string')
    }
  })
})

describe('the rule list and the history name a summary for what it is', () => {
  it('the row of a summary rule carries its send times; an instant row does not', () => {
    const summary = buildRuleRowModel(summaryRule(), [])
    expect(summary.header.meta.map((chip) => chip.id)).toEqual(['kind', 'delivery', 'owner'])
    expect(summary.header.meta[1]?.summarySchedule).toEqual(DAILY_8)
    const instant = buildRuleRowModel(summaryRule({ systemEventDelivery: { mode: 'instant' } }), [])
    expect(instant.header.meta.map((chip) => chip.id)).toEqual(['kind', 'owner'])
  })

  it('a history row of a state summary is named as one, never "Device #0"', () => {
    expect(
      isStateSummaryHistoryRow({
        recordId: 'state-summary:r1:1700000000000',
        subject: { systemEvent: { data: { stateSummary: true } } },
      }),
    ).toBe(true)
    expect(isStateSummaryHistoryRow({ recordId: 'evt-1', subject: { systemEvent: { data: {} } } })).toBe(false)
    expect(isStateSummaryHistoryRow({ recordId: 'evt-1', subject: {} })).toBe(false)
  })
})

describe('a hub older than D647 (it strips the key and says success)', () => {
  it('is reported, never read as a saved summary', () => {
    const sent = { systemEventDelivery: defaultSummaryDelivery() }
    const stripped = summaryRule({ systemEventDelivery: undefined })
    expect(() => assertSummaryDeliveryLanded(sent, stripped)).toThrow(NcSummaryNotKeptError)
    expect(() => assertSummaryDeliveryLanded(sent, summaryRule({ systemEventDelivery: { mode: 'instant' } }))).toThrow(
      NcSummaryNotKeptError,
    )
    expect(() => assertSummaryDeliveryLanded(sent, summaryRule())).not.toThrow()
    expect(() => assertSummaryDeliveryLanded({}, stripped)).not.toThrow()
    try {
      assertSummaryDeliveryLanded(sent, stripped)
    } catch (error) {
      // …and it carries the rule the hub STORED, for the editor to adopt.
      expect(error instanceof NcSummaryNotKeptError ? error.rule.id : null).toBe('r1')
    }
  })
})
