/**
 * The pure half of the Rule / Advanced / Notification / Conditions controls
 * that author the parity fields: what each control OFFERS, pinned against the
 * mirror's own schema so the phone never offers a value the hub refuses.
 */
import { describe, expect, it } from 'vitest'
import {
  NcConfirmExpectSchema,
  NcMediaPolicySchema,
  NcRuleInputSchema,
  NcThrottleSchema,
} from '../../../data/notification-center.js'
import { NC_CLIP_SPEED_DEFAULT } from '../rule-editor.js'
import { NC_ALARM_SYSTEM_EVENT_KINDS } from '@camstack/types/client'
import type { NcRuleAction } from '../../../data/notification-center.js'
import {
  NC_CLIP_SPEED_CHOICES,
  NC_CONFIRM_OPS,
  NC_COOLDOWN_UI_MAX_SEC,
  NC_GROUPING_STEPPER,
  isSnoozeExempt,
  sequenceResolver,
  isValidTimeZone,
  linkedCamerasApplies,
  parseConfirmOp,
  timeZoneChoices,
} from '../rule-field-choices.js'

describe('isValidTimeZone', () => {
  it('accepts an IANA zone and refuses one that does not exist', () => {
    expect(isValidTimeZone('Europe/Rome')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Mars/Base')).toBe(false)
  })

  it('refuses blank — blank is "the hub’s zone", which is ABSENT, not a zone', () => {
    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone('   ')).toBe(false)
  })
})

describe('timeZoneChoices', () => {
  it('lists only zones the validator accepts, when the runtime can list them', () => {
    const zones = timeZoneChoices()
    // Node ships `Intl.supportedValuesOf`; Hermes may not, and then the screen
    // falls back to the validated text box.
    expect(zones).not.toBeNull()
    expect(zones).toContain('Europe/Rome')
    for (const zone of zones ?? []) expect(isValidTimeZone(zone)).toBe(true)
  })
})

describe('clip speed chips', () => {
  it('every chip is a speed the media schema accepts, and the default is one of them', () => {
    for (const speed of NC_CLIP_SPEED_CHOICES) {
      expect(NcMediaPolicySchema.safeParse({ attach: 'best', clip: true, clipSpeed: speed }).success).toBe(true)
    }
    expect(NC_CLIP_SPEED_CHOICES).toContain(NC_CLIP_SPEED_DEFAULT)
  })
})

describe('linked cameras mode', () => {
  it('is offered for a SENSOR rule only', () => {
    expect(linkedCamerasApplies('sensor')).toBe(true)
    for (const kind of ['detection', 'occupancy', 'sound', 'system'] as const) {
      expect(linkedCamerasApplies(kind)).toBe(false)
    }
  })
})

describe('bounds the steppers use', () => {
  it('the cooldown ceiling is inside what the hub accepts', () => {
    expect(NcThrottleSchema.safeParse({ cooldownSec: NC_COOLDOWN_UI_MAX_SEC, scope: 'rule-device' }).success).toBe(true)
  })

  it('the grouping stepper is the cap’s own 5..60, and every step it can land on parses', () => {
    expect(NC_GROUPING_STEPPER.min).toBe(5)
    expect(NC_GROUPING_STEPPER.max).toBe(60)
    const base = { name: 'r', delivery: 'immediate', conditions: {}, targets: [], media: { attach: 'best' } }
    for (let sec = NC_GROUPING_STEPPER.min; sec <= NC_GROUPING_STEPPER.max; sec += NC_GROUPING_STEPPER.step) {
      expect(NcRuleInputSchema.safeParse({ ...base, groupingSec: sec }).success, `${sec} s`).toBe(true)
    }
    expect(NcRuleInputSchema.safeParse({ ...base, groupingSec: NC_GROUPING_STEPPER.min - 1 }).success).toBe(false)
    expect(NcRuleInputSchema.safeParse({ ...base, groupingSec: NC_GROUPING_STEPPER.max + 1 }).success).toBe(false)
  })
})

describe('confirm expectation operator', () => {
  it('offers exactly the schema’s operators', () => {
    expect([...NC_CONFIRM_OPS].sort()).toEqual([...NcConfirmExpectSchema.shape.op.options].sort())
  })

  it('parses a picked value back to an operator, and anything else to undefined', () => {
    expect(parseConfirmOp('>=')).toBe('>=')
    expect(parseConfirmOp('')).toBeUndefined()
    expect(parseConfirmOp('gte')).toBeUndefined()
  })
})

describe('isSnoozeExempt — the admin’s isRuleSnoozeExempt, on the viewer form', () => {
  const steps = (caps: readonly string[]): readonly NcRuleAction[] =>
    caps.map((cap) => ({ kind: 'cap', deviceId: 7, cap, method: 'arm' }))

  it('every published alarm kind makes a system rule exempt', () => {
    expect(NC_ALARM_SYSTEM_EVENT_KINDS.length).toBeGreaterThan(0)
    for (const kind of NC_ALARM_SYSTEM_EVENT_KINDS) {
      expect(isSnoozeExempt({ systemEvent: { kinds: ['device-offline', kind] } }, [])).toBe(true)
    }
  })

  it('a non-alarm system rule is not exempt', () => {
    expect(isSnoozeExempt({ systemEvent: { kinds: ['device-offline'] } }, [])).toBe(false)
    expect(isSnoozeExempt({}, [])).toBe(false)
  })

  it('a rule that ACTUATES the panel is exempt — any step its bindings or buttons run', () => {
    expect(isSnoozeExempt({}, steps(['light', 'alarm-panel']))).toBe(true)
    expect(isSnoozeExempt({}, steps(['light', 'siren']))).toBe(false)
  })

  it('resolves a shared sequence by id, and nothing for one the list lacks', () => {
    const of = sequenceResolver([{ id: 'a', name: 'A', actions: [{ kind: 'wait', seconds: 1 }] }])
    expect(of('a')).toEqual([{ kind: 'wait', seconds: 1 }])
    expect(of('b')).toBeUndefined()
  })
})
