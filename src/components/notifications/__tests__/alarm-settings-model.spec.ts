/**
 * The admin alarm screen's pure model (Task 12). What the phone offers, warns
 * and sends — the decisions a mount test cannot pin cheaply.
 */
import { describe, expect, it } from 'vitest'
import type { NcAlarmModeCoverage, NcAlarmSettings } from '@camstack/types'
import type { NcAlarmLive } from '../../../data/nc-alarm.js'
import { resolveSelectedDevices } from '../device-selection.js'
import {
  ALARM_DELAY_MAX,
  alarmDeviceLabel,
  alarmSettingsPatch,
  alarmEditsEmpty,
  alarmSettingsChanged,
  alarmCoverageIds,
  clampDelay,
  commitDelay,
  commitModeDelay,
  modeDelayView,
  setModeDelayDefault,
  typeModeDelay,
  draftVisiblyDiffers,
  EMPTY_ALARM_EDITS,
  effectiveAlarmSettings,
  nonBlockingEmptyLine,
  typeDelay,
  nonBlockingFor,
  nonBlockingOptions,
  openingsSummary,
  parseDelayDraft,
} from '../alarm-settings-model.js'

const SETTINGS: NcAlarmSettings = {
  exitDelaySec: 30,
  entryDelaySec: 20,
  triggeredDurationSec: 0,
  announceTargets: ['push-1'],
  modeDelays: [],
  nonBlocking: [
    { mode: 'home', deviceIds: [7] },
    { mode: 'night', deviceIds: [9, 11] },
  ],
  blocking: [],
  secureOnArmOff: [],
}

const LIVE: NcAlarmLive = {
  state: 'disarmed',
  targetMode: null,
  availableModes: ['home', 'away', 'night'],
  openings: [
    {
      mode: 'away',
      devices: [{ deviceId: 42, name: 'Porch', state: 'open', blocking: true }],
      unknown: [60],
    },
  ],
  exclusions: [],
  bypassedInputs: [],
}

describe('nonBlockingFor', () => {
  it('reads one mode, empty when it has no list', () => {
    expect(nonBlockingFor(SETTINGS.nonBlocking, 'night')).toEqual([9, 11])
    expect(nonBlockingFor(SETTINGS.nonBlocking, 'away')).toEqual([])
  })
})

describe('nonBlockingOptions — every opening of the household (D636)', () => {
  it('offers an opening NO rule of the mode covers — never hidden (the table mutes it)', () => {
    const view = nonBlockingOptions({
      live: LIVE,
      listed: [],
      openingIds: new Set([42, 43, 77]),
    })
    // 42 read open under away, 60 unreadable under away (an opening by
    // construction), 43 and 77 openings of the household.
    expect(view.ids).toEqual([42, 43, 60, 77])
  })

  it('offers only OPENINGS — a covered camera is never offered', () => {
    const view = nonBlockingOptions({
      live: undefined,
      listed: [],
      // 5 is a camera: no contact / cover / lock binding.
      openingIds: new Set([43]),
    })
    expect(view.ids).toEqual([43])
  })

  it('what the hub READ (open or unreadable) is an opening without asking', () => {
    const view = nonBlockingOptions({ live: LIVE, listed: [], openingIds: null })
    expect(view.ids).toEqual([42, 60])
    expect(view.unresolved).toBe(true)
  })

  it('an already-listed id is always offered, so it can be removed', () => {
    const view = nonBlockingOptions({ live: undefined, listed: [99], openingIds: new Set() })
    expect(view.ids).toEqual([99])
  })
})

describe('openingsSummary', () => {
  it('counts blocking, non-blocking and unreadable; null when the hub gave no row', () => {
    expect(openingsSummary(LIVE, 'away')).toEqual({ blocking: 1, nonBlocking: 0, unknown: 1 })
    expect(openingsSummary(LIVE, 'home')).toBeNull()
    expect(openingsSummary(undefined, 'away')).toBeNull()
  })
})

describe('delays', () => {
  it('the delay bounds are clamped to 600, 600 and 3600', () => {
    expect(ALARM_DELAY_MAX).toEqual({ exitDelaySec: 600, entryDelaySec: 600, triggeredDurationSec: 3600 })
    expect(clampDelay('exitDelaySec', 9999)).toBe(600)
    expect(clampDelay('entryDelaySec', 601)).toBe(600)
    expect(clampDelay('triggeredDurationSec', 5000)).toBe(3600)
    expect(clampDelay('triggeredDurationSec', 3600)).toBe(3600)
    expect(clampDelay('exitDelaySec', -5)).toBe(0)
    expect(clampDelay('exitDelaySec', 12.6)).toBe(13)
  })

  it('an emptied or unreadable box is not 0 — it leaves the value alone', () => {
    expect(parseDelayDraft('entryDelaySec', '')).toBeNull()
    expect(parseDelayDraft('entryDelaySec', '  ')).toBeNull()
    expect(parseDelayDraft('entryDelaySec', 'abc')).toBeNull()
    expect(parseDelayDraft('entryDelaySec', '45')).toBe(45)
    expect(parseDelayDraft('entryDelaySec', '900')).toBe(600)
  })

  it('a TYPED delay is part of the draft at once — no blur needed — and clamped', () => {
    const edits = typeDelay(EMPTY_ALARM_EDITS, 'triggeredDurationSec', '4000')
    expect(edits.delays.triggeredDurationSec).toBe('3600')
    expect(effectiveAlarmSettings(SETTINGS, edits).triggeredDurationSec).toBe(3600)
    expect(alarmSettingsPatch(SETTINGS, edits)).toEqual({ triggeredDurationSec: 3600 })
    // A box being retyped (empty) keeps the stored value and sends nothing.
    const cleared = typeDelay(EMPTY_ALARM_EDITS, 'exitDelaySec', '')
    expect(effectiveAlarmSettings(SETTINGS, cleared).exitDelaySec).toBe(30)
    expect(alarmSettingsPatch(SETTINGS, cleared)).toBeNull()
  })
})

describe('alarmSettingsPatch — a save sends only what changed', () => {
  it('nothing edited is nothing to send', () => {
    expect(alarmSettingsPatch(SETTINGS, EMPTY_ALARM_EDITS)).toBeNull()
    expect(alarmEditsEmpty(EMPTY_ALARM_EDITS)).toBe(true)
  })

  it('an edit back to the stored value is nothing to send', () => {
    let edits = typeDelay(EMPTY_ALARM_EDITS, 'exitDelaySec', '30')
    edits = typeDelay(edits, 'entryDelaySec', '20')
    edits = typeDelay(edits, 'triggeredDurationSec', '0')
    expect(alarmSettingsPatch(SETTINGS, edits)).toBeNull()
  })

  it('carries only the changed fields', () => {
    const edits = typeDelay(typeDelay(EMPTY_ALARM_EDITS, 'entryDelaySec', '45'), 'exitDelaySec', '30')
    expect(alarmSettingsPatch(SETTINGS, edits)).toEqual({ entryDelaySec: 45 })
  })


  it('never carries nonBlocking: the switch writes it directly, not the draft', () => {
    const edits = typeDelay(EMPTY_ALARM_EDITS, 'entryDelaySec', '45')
    const patch = alarmSettingsPatch(SETTINGS, edits)
    expect(patch).toEqual({ entryDelaySec: 45 })
    expect(Object.keys(patch ?? {})).not.toContain('nonBlocking')
    expect(Object.keys(effectiveAlarmSettings(SETTINGS, edits))).not.toContain('nonBlocking')
  })
})

describe('edits are applied to the LATEST config (a concurrent edit is never reverted)', () => {
  // Another admin, after this draft began: changed the entry delay and
  // removed 11 from night.
  const LATEST: NcAlarmSettings = {
    ...SETTINGS,
    entryDelaySec: 25,
    nonBlocking: [{ mode: 'night', deviceIds: [9] }],
  }

  it('says when the config moved since the first edit', () => {
    expect(alarmSettingsChanged(SETTINGS, LATEST)).toBe(true)
  })

  it("a switch another admin flipped is not 'the config changed under your draft'", () => {
    // The draft holds delays only; a membership edit is written directly.
    expect(alarmSettingsChanged(SETTINGS, { ...SETTINGS, nonBlocking: [] })).toBe(false)
  })
})

describe('nonBlockingEmptyLine', () => {
  it('says the household has no opening — only once the scan ANSWERED', () => {
    expect(nonBlockingEmptyLine({ ids: [], unresolved: false })).toBe('no-opening')
    expect(nonBlockingEmptyLine({ ids: [], unresolved: true })).toBeNull()
    expect(nonBlockingEmptyLine({ ids: [5], unresolved: false })).toBeNull()
  })
})

describe('alarmDeviceLabel', () => {
  const rows = resolveSelectedDevices([1, 2], [{ id: 1, name: 'Front door' }], 'answered')
  const byId = new Map(rows.map((row) => [row.id, row]))

  it('names a known device, and a removed one as removed', () => {
    expect(alarmDeviceLabel(1, byId, new Map())).toEqual({ kind: 'named', name: 'Front door' })
    expect(alarmDeviceLabel(2, byId, new Map())).toEqual({ kind: 'removed' })
  })

  it('a device the lookup has not answered for is unnamed (Device #id), never removed', () => {
    const pending = new Map(resolveSelectedDevices([3], undefined, 'pending').map((row) => [row.id, row]))
    expect(alarmDeviceLabel(3, pending, new Map())).toEqual({ kind: 'unnamed' })
    expect(alarmDeviceLabel(4, new Map(), new Map())).toEqual({ kind: 'unnamed' })
  })

  it('the name the hub gave with an opening wins', () => {
    expect(alarmDeviceLabel(2, byId, new Map([[2, 'Porch']]))).toEqual({ kind: 'named', name: 'Porch' })
  })
})

describe('a typed delay above its bound shows the bound', () => {
  it('is stored as the clamped value, so the box reads what will be sent', () => {
    expect(typeDelay(EMPTY_ALARM_EDITS, 'exitDelaySec', '900').delays.exitDelaySec).toBe('600')
    expect(typeDelay(EMPTY_ALARM_EDITS, 'triggeredDurationSec', '4000').delays.triggeredDurationSec).toBe('3600')
    // Below the bound, and a box being cleared, stay as typed.
    expect(typeDelay(EMPTY_ALARM_EDITS, 'exitDelaySec', '90').delays.exitDelaySec).toBe('90')
    expect(typeDelay(EMPTY_ALARM_EDITS, 'exitDelaySec', '').delays.exitDelaySec).toBe('')
  })
})

describe('fix round 3', () => {
  it('a committed delay box shows exactly what Save will send', () => {
    const at = (raw: string): string | undefined =>
      commitDelay(typeDelay(EMPTY_ALARM_EDITS, 'exitDelaySec', raw), 'exitDelaySec').delays.exitDelaySec
    expect(at('-5')).toBe('0')
    expect(at('12.5')).toBe('13')
    expect(at('45')).toBe('45')
    // Nothing readable: the box goes back to the stored value.
    expect(at('')).toBeUndefined()
    expect(at('abc')).toBeUndefined()
    // An untouched field stays untouched.
    expect(commitDelay(EMPTY_ALARM_EDITS, 'entryDelaySec')).toEqual(EMPTY_ALARM_EDITS)
  })

  it('a draft differs visibly when a box shows something other than the stored value', () => {
    expect(draftVisiblyDiffers(SETTINGS, EMPTY_ALARM_EDITS)).toBe(false)
    // Emptied box: nothing to send, but something to discard.
    expect(draftVisiblyDiffers(SETTINGS, typeDelay(EMPTY_ALARM_EDITS, 'exitDelaySec', ''))).toBe(true)
    // Typed back to the stored value: nothing visible.
    expect(draftVisiblyDiffers(SETTINGS, typeDelay(EMPTY_ALARM_EDITS, 'exitDelaySec', '30'))).toBe(false)
    // A real change.
    expect(draftVisiblyDiffers(SETTINGS, typeDelay(EMPTY_ALARM_EDITS, 'exitDelaySec', '45'))).toBe(true)
  })
})

describe('coverage "all devices except N" (D641)', () => {
  const allExcept: NcAlarmModeCoverage = {
    mode: 'away',
    ruleCount: 2,
    allDevices: true,
    deviceIds: [],
    allDevicesExcept: [77, 78],
    skippedDevices: [],
  }

  it('an excluded id is named through the same lookup as every other id', () => {
    expect(alarmCoverageIds(allExcept)).toEqual(expect.arrayContaining([77, 78]))
  })

  it('an excluded id reads "Device #id" until the lookup answers — never "removed" (D315)', () => {
    const pending = new Map(resolveSelectedDevices([77], undefined, 'pending').map((row) => [row.id, row]))
    expect(alarmDeviceLabel(77, pending, new Map())).toEqual({ kind: 'unnamed' })
  })
})

describe('per-mode delays (D697, plan M6): the PRESENCE of the override decides, never the value', () => {
  const WITH_OVERRIDE: NcAlarmSettings = {
    ...SETTINGS,
    // home overrides exit with a value EQUAL to the global (30); away overrides entry only.
    modeDelays: [
      { mode: 'home', exitDelaySec: 30 },
      { mode: 'away', entryDelaySec: 45 },
    ],
  }

  it('a typed override becomes a number on that mode and field only', () => {
    const edits = typeModeDelay(EMPTY_ALARM_EDITS, 'night', 'exitDelaySec', '10')
    expect(alarmSettingsPatch(SETTINGS, edits)).toEqual({ modeDelays: [{ mode: 'night', exitDelaySec: 10 }] })
  })

  it('"Use default" on an override clears it (null)', () => {
    const edits = setModeDelayDefault(EMPTY_ALARM_EDITS, 'away', 'entryDelaySec')
    expect(alarmSettingsPatch(WITH_OVERRIDE, edits)).toEqual({ modeDelays: [{ mode: 'away', entryDelaySec: null }] })
  })

  it('"Use default" on an override EQUAL to the global still clears it - not dropped', () => {
    const edits = setModeDelayDefault(EMPTY_ALARM_EDITS, 'home', 'exitDelaySec')
    expect(alarmSettingsPatch(WITH_OVERRIDE, edits)).toEqual({ modeDelays: [{ mode: 'home', exitDelaySec: null }] })
  })

  it('"Use default" on a mode that has no override sends nothing', () => {
    const edits = setModeDelayDefault(EMPTY_ALARM_EDITS, 'night', 'exitDelaySec')
    expect(alarmSettingsPatch(SETTINGS, edits)).toBeNull()
  })

  it('typing the GLOBAL value on a mode with no override sets that number', () => {
    const edits = typeModeDelay(EMPTY_ALARM_EDITS, 'night', 'exitDelaySec', '30')
    expect(alarmSettingsPatch(SETTINGS, edits)).toEqual({ modeDelays: [{ mode: 'night', exitDelaySec: 30 }] })
  })

  it('retyping the stored override is nothing to send', () => {
    const edits = typeModeDelay(EMPTY_ALARM_EDITS, 'away', 'entryDelaySec', '45')
    expect(alarmSettingsPatch(WITH_OVERRIDE, edits)).toBeNull()
  })

  it('names ONLY the touched field: another field of the same mode is kept', () => {
    const latest: NcAlarmSettings = { ...SETTINGS, modeDelays: [{ mode: 'away', entryDelaySec: 45, exitDelaySec: 5 }] }
    const edits = typeModeDelay(EMPTY_ALARM_EDITS, 'away', 'triggeredDurationSec', '120')
    expect(alarmSettingsPatch(latest, edits)).toEqual({ modeDelays: [{ mode: 'away', triggeredDurationSec: 120 }] })
  })

  it('a field cleared elsewhere meanwhile is judged on the LATEST entry', () => {
    const edits = setModeDelayDefault(EMPTY_ALARM_EDITS, 'away', 'entryDelaySec')
    // Another admin already cleared it: the latest entry lacks the field.
    expect(alarmSettingsPatch(SETTINGS, edits)).toBeNull()
  })

  it('shows the inherited value from the GLOBAL, and the override as its own', () => {
    expect(modeDelayView(WITH_OVERRIDE, EMPTY_ALARM_EDITS, 'night', 'exitDelaySec')).toMatchObject({
      value: 30,
      inherited: true,
      defaultValue: 30,
    })
    expect(modeDelayView(WITH_OVERRIDE, EMPTY_ALARM_EDITS, 'away', 'entryDelaySec')).toMatchObject({
      value: 45,
      inherited: false,
      defaultValue: 20,
    })
  })

  it('an override equal to the default is still an override (not "inherited")', () => {
    expect(modeDelayView(WITH_OVERRIDE, EMPTY_ALARM_EDITS, 'home', 'exitDelaySec').inherited).toBe(false)
  })

  it('a pending "Use default" shows the default; a typed value makes the mode overridden', () => {
    const cleared = setModeDelayDefault(EMPTY_ALARM_EDITS, 'away', 'entryDelaySec')
    expect(modeDelayView(WITH_OVERRIDE, cleared, 'away', 'entryDelaySec')).toMatchObject({ value: 20, inherited: true })
    const typed = typeModeDelay(EMPTY_ALARM_EDITS, 'night', 'exitDelaySec', '7')
    expect(modeDelayView(SETTINGS, typed, 'night', 'exitDelaySec')).toMatchObject({ value: 7, inherited: false })
  })

  it('an inheriting mode follows an edited global default', () => {
    const edits = typeDelay(EMPTY_ALARM_EDITS, 'exitDelaySec', '50')
    expect(modeDelayView(SETTINGS, edits, 'night', 'exitDelaySec')).toMatchObject({ value: 50, inherited: true })
  })

  it('clamps like the global boxes, and an emptied box leaves the stored value', () => {
    const over = typeModeDelay(EMPTY_ALARM_EDITS, 'night', 'triggeredDurationSec', '99999')
    expect(over.modeDelays.night?.triggeredDurationSec).toBe('3600')
    const emptied = typeModeDelay(EMPTY_ALARM_EDITS, 'away', 'entryDelaySec', '')
    expect(alarmSettingsPatch(WITH_OVERRIDE, emptied)).toBeNull()
    expect(commitModeDelay(emptied, 'away', 'entryDelaySec').modeDelays).toEqual({})
  })

  it('an edit makes the draft non-empty and the changed-elsewhere check sees overrides', () => {
    const edits = typeModeDelay(EMPTY_ALARM_EDITS, 'night', 'exitDelaySec', '10')
    expect(alarmEditsEmpty(edits)).toBe(false)
    expect(alarmSettingsChanged(SETTINGS, WITH_OVERRIDE)).toBe(true)
    expect(draftVisiblyDiffers(SETTINGS, edits)).toBe(true)
  })
})
