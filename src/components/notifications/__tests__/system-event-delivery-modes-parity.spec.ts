/**
 * The viewer's `systemEventDelivery` mirror against the hub's shape (D1019).
 * The hub's source of truth is `NcSystemEventDeliverySchema` and
 * `systemEventDeliveryModesOf` in `@camstack/types`; the published copy may
 * predate `modes`, so the hub's expected answers are pinned here by value and,
 * when the installed `@camstack/types` already ships the reader, compared to it.
 */
import * as hubTypes from '@camstack/types'
import { describe, expect, it } from 'vitest'
import { NcSystemEventDeliverySchema, type NcSystemEventDelivery } from '../../../data/notification-center.js'
import { scheduleForSendTimes, systemEventDeliveryModesOf } from '../system-event-delivery.js'

const SCHEDULE = scheduleForSendTimes([{ days: [1, 2, 3, 4, 5], minute: 450 }])

const CASES: readonly (readonly [string, NcSystemEventDelivery | undefined])[] = [
  ['absent', undefined],
  ['instant', { mode: 'instant' }],
  ['summary', { mode: 'summary', schedule: SCHEDULE }],
  ['summary section', { mode: 'summary', schedule: SCHEDULE, split: 'section' }],
  ['modes none', { mode: 'modes', onActivation: false, onDeactivation: false }],
  ['modes start only', { mode: 'modes', onActivation: true, onDeactivation: false }],
  ['modes clear + schedule', { mode: 'modes', onActivation: false, onDeactivation: true, onSchedule: { schedule: SCHEDULE, grouping: 'rule' } }],
  ['modes all', { mode: 'modes', onActivation: true, onDeactivation: true, onSchedule: { schedule: SCHEDULE, grouping: 'section' } }],
]

describe('systemEventDelivery mirror vs the hub', () => {
  it('parses every hub variant, unchanged', () => {
    for (const [, value] of CASES) {
      if (value !== undefined) expect(NcSystemEventDeliverySchema.parse(value)).toEqual(value)
    }
  })
  it('the discriminator is exactly instant | summary | modes', () => {
    expect(NcSystemEventDeliverySchema.options.map((option) => option.shape.mode.value).sort()).toEqual([
      'instant',
      'modes',
      'summary',
    ])
  })
  it('the modes variant carries exactly the hub keys', () => {
    const modes = NcSystemEventDeliverySchema.options.find((option) => option.shape.mode.value === 'modes')
    expect(Object.keys(modes?.shape ?? {}).sort()).toEqual(['mode', 'onActivation', 'onDeactivation', 'onSchedule'])
  })
  it('reads like the hub reader where the installed types ship it', () => {
    const hub: unknown = Reflect.get(hubTypes, 'systemEventDeliveryModesOf')
    if (typeof hub !== 'function') return // the published types predate D1019
    for (const [, value] of CASES) {
      expect(systemEventDeliveryModesOf({ systemEventDelivery: value })).toEqual(
        hub({ ...(value !== undefined ? { systemEventDelivery: value } : {}) }),
      )
    }
  })
})
