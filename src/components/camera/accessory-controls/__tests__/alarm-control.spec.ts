/**
 * The alarm control's decisions, without React Native: which modes it offers,
 * which path an arm and a disarm take, what a refused arm leaves on screen,
 * and what an UNREADABLE panel looks like.
 *
 * The control used to arm `availableModes[0]` and swallow every failure, so a
 * refused arm looked exactly like a press that did nothing (D630).
 */
import { describe, expect, it } from 'vitest'
import {
  alarmControlModel,
  alarmRefusalLine,
  capRefusalDevices,
  type AlarmControlModelInput,
} from '../alarm-control-model.js'
import type { AlarmStatus } from '../../../../data/use-accessory-controls.js'
import type { NcAlarmArmOutcome, NcAlarmLive, NcPanelLookup } from '../../../../data/nc-alarm.js'

const PANEL = 1201

const disarmed: AlarmStatus = { state: 'disarmed', availableModes: ['home', 'away', 'night'], requiresCode: false }
const known: NcPanelLookup = { kind: 'known', panelId: PANEL }

function input(over: Partial<AlarmControlModelInput> = {}): AlarmControlModelInput {
  return {
    status: disarmed,
    ncLive: null,
    ncLiveAt: null,
    ncPanel: known,
    verdict: 'admin',
    deviceId: PANEL,
    lastOutcome: null,
    lastOutcomeAt: null,
    ...over,
  }
}

function live(over: Partial<NcAlarmLive> = {}): NcAlarmLive {
  return {
    state: 'triggered',
    targetMode: 'away',
    availableModes: ['home', 'away', 'night'],
    openings: [],
    exclusions: [],
    bypassedInputs: [],
    ...over,
  }
}

const refused: NcAlarmArmOutcome = {
  outcome: 'refused',
  refusalId: 'refusal-1',
  blocking: [
    { deviceId: 42, name: 'Porch', state: 'open' },
    { deviceId: 50, name: 'Garage', state: 'unlocked' },
  ],
}

describe('alarmControlModel — modes', () => {
  it('offers EVERY available mode, not the first one', () => {
    expect(alarmControlModel(input()).modes).toEqual(['home', 'away', 'night'])
  })

  it('a coded panel offers no modes (there is no PIN entry inline)', () => {
    const coded: AlarmStatus = { ...disarmed, requiresCode: true }
    expect(alarmControlModel(input({ status: coded })).modes).toEqual([])
  })
})

describe('alarmControlModel — which path an ARM takes', () => {
  it('the Notification Center panel, for a confirmed admin, uses nc.*', () => {
    expect(alarmControlModel(input()).armPath).toBe('nc')
  })

  it('any other panel uses the device cap', () => {
    expect(alarmControlModel(input({ deviceId: 77 })).armPath).toBe('cap')
  })

  it('a hub that refused the read BY NAME (no nc panel) uses the device cap', () => {
    expect(alarmControlModel(input({ ncPanel: { kind: 'known', panelId: null } })).armPath).toBe('cap')
  })

  it('a non-admin uses the device cap even on the NC panel (nc.* refuses them)', () => {
    expect(alarmControlModel(input({ verdict: 'not-admin' })).armPath).toBe('cap')
    expect(alarmControlModel(input({ verdict: 'unknown' })).armPath).toBe('cap')
  })

  it('cannot arm while the role, or an admin\'s panel lookup, is undecided', () => {
    expect(alarmControlModel(input({ verdict: 'pending' })).canArm).toBe(false)
    expect(alarmControlModel(input({ ncPanel: { kind: 'pending' } })).canArm).toBe(false)
    // A non-admin never asks nc.*, so a pending lookup gates nothing.
    expect(alarmControlModel(input({ verdict: 'not-admin', ncPanel: { kind: 'pending' } })).canArm).toBe(true)
    expect(alarmControlModel(input()).canArm).toBe(true)
  })

  it('a lookup that failed for any other reason is UNKNOWN — no arm, and it says so', () => {
    const model = alarmControlModel(input({ ncPanel: { kind: 'unknown' } }))
    expect(model.armPath).toBeNull()
    expect(model.canArm).toBe(false)
    expect(model.lookupUnknown).toBe(true)
  })
})

describe('alarmControlModel — DISARM never waits on a read (C1)', () => {
  const triggered: AlarmStatus = { ...disarmed, state: 'triggered' }

  it('triggered + role pending → Disarm enabled, through the cap', () => {
    const model = alarmControlModel(input({ status: triggered, verdict: 'pending' }))
    expect(model.canDisarm).toBe(true)
    expect(model.disarmPath).toBe('cap')
  })

  it('triggered + panel lookup pending or unknown → Disarm enabled, through the cap', () => {
    for (const ncPanel of [{ kind: 'pending' }, { kind: 'unknown' }] as const) {
      const model = alarmControlModel(input({ status: triggered, ncPanel }))
      expect(model.canDisarm).toBe(true)
      expect(model.disarmPath).toBe('cap')
    }
  })

  it('the decided NC path disarms through nc.*', () => {
    expect(alarmControlModel(input({ status: triggered })).disarmPath).toBe('nc')
  })

  it('a disarmed panel offers no Disarm', () => {
    expect(alarmControlModel(input()).canDisarm).toBe(false)
  })

  it('a disarming panel cannot be armed, and CAN be disarmed again (disarm is idempotent)', () => {
    // An HA panel can sit in `disarming`; a Disarm that stays dead there is a
    // panel nobody can finish disarming from the row.
    const disarming = alarmControlModel(input({ status: { ...disarmed, state: 'disarming' } }))
    expect(disarming.canArm).toBe(false)
    expect(disarming.canDisarm).toBe(true)
  })
})

describe('alarmControlModel — on the NC row, the two sources disagree (R1)', () => {
  it('a cached "disarmed" does not hide a live armed panel: Disarm is enabled, state is the live one', () => {
    const model = alarmControlModel(input({ status: disarmed, ncLive: live({ state: 'triggered' }) }))
    expect(model.state).toBe('triggered')
    expect(model.canDisarm).toBe(true)
    expect(model.canArm).toBe(false)
  })

  it('a live "disarmed" does not hide a cached armed panel either', () => {
    const model = alarmControlModel(
      input({ status: { ...disarmed, state: 'armed_home' }, ncLive: live({ state: 'disarmed', targetMode: null }) }),
    )
    expect(model.state).toBe('armed_home')
    expect(model.canDisarm).toBe(true)
  })

  it('the more alarming state is shown', () => {
    expect(alarmControlModel(input({ status: { ...disarmed, state: 'arming' }, ncLive: live({ state: 'pending' }) })).state).toBe(
      'pending',
    )
    expect(alarmControlModel(input({ status: { ...disarmed, state: 'triggered' }, ncLive: live({ state: 'armed_away' }) })).state).toBe(
      'triggered',
    )
    expect(
      alarmControlModel(input({ status: disarmed, ncLive: live({ state: 'disarming', targetMode: null }) })).canDisarm,
    ).toBe(true)
  })

  it('another panel\'s row never reads the nc live view', () => {
    const model = alarmControlModel(input({ deviceId: 77, status: disarmed, ncLive: live({ state: 'triggered' }) }))
    expect(model.state).toBe('disarmed')
  })
})

describe('alarmControlModel — an unreadable panel is never "disarmed" (I2)', () => {
  it('a failed cap read on another panel is unknown: no arm, Disarm enabled', () => {
    const model = alarmControlModel(input({ deviceId: 77, status: null }))
    expect(model.state).toBeNull()
    expect(model.canArm).toBe(false)
    expect(model.canDisarm).toBe(true)
  })

  it('on the NC path a failed cap read falls back to the nc live state', () => {
    const model = alarmControlModel(input({ status: null, ncLive: live({ state: 'triggered' }) }))
    expect(model.state).toBe('triggered')
    expect(model.armed).toBe(true)
    expect(model.canDisarm).toBe(true)
  })

  it('a live disarmed state offers the live modes', () => {
    const model = alarmControlModel(input({ status: null, ncLive: live({ state: 'disarmed', targetMode: null }) }))
    expect(model.modes).toEqual(['home', 'away', 'night'])
    expect(model.canArm).toBe(true)
  })
})

describe('alarmControlModel — a refused arm stays visible', () => {
  it('names the open devices, bound to the refusal id', () => {
    const model = alarmControlModel(input({ lastOutcome: refused }))
    expect(model.refusal?.blocking.map((d) => d.name)).toEqual(['Porch', 'Garage'])
    expect(model.refusal?.refusalId).toBe('refusal-1')
  })

  it('no refusal after an arm that went ahead', () => {
    const armed: NcAlarmArmOutcome = { outcome: 'armed', excluded: [] }
    expect(alarmControlModel(input({ lastOutcome: armed })).refusal).toBeNull()
  })

  it('a refusal is dropped once the panel is armed anyway (from anywhere)', () => {
    const armedAway: AlarmStatus = { ...disarmed, state: 'armed_away' }
    expect(alarmControlModel(input({ status: armedAway, lastOutcome: refused })).refusal).toBeNull()
  })

  it('a rejected Arm anyway names its reason — until the panel reads armed', () => {
    const rejected: NcAlarmArmOutcome = { outcome: 'rejected', reason: 'expired' }
    expect(alarmControlModel(input({ lastOutcome: rejected })).rejected).toBe('expired')
    const armedAway: AlarmStatus = { ...disarmed, state: 'armed_away' }
    expect(alarmControlModel(input({ status: armedAway, lastOutcome: rejected })).rejected).toBeNull()
  })
})

describe('alarmControlModel — what an armed panel is NOT watching (I3)', () => {
  const armedAway: AlarmStatus = { ...disarmed, state: 'armed_away' }

  it('an arm that excluded devices names them', () => {
    const outcome: NcAlarmArmOutcome = { outcome: 'armed', excluded: [{ deviceId: 42, name: 'Porch', state: 'open' }] }
    expect(alarmControlModel(input({ status: armedAway, lastOutcome: outcome })).excluded).toEqual([
      { deviceId: 42, name: 'Porch' },
    ])
  })

  it('without an outcome, the NC panel\'s live exclusions are named', () => {
    const model = alarmControlModel(
      input({ status: armedAway, ncLive: live({ state: 'armed_away', exclusions: [{ deviceId: 9, name: '', phase: 'open' }] }) }),
    )
    expect(model.excluded).toEqual([{ deviceId: 9, name: '' }])
  })

  it('on the NC panel the LIVE exclusions win over a stale outcome (N3)', () => {
    // Disarmed and re-armed elsewhere: this row's last outcome is history.
    const stale: NcAlarmArmOutcome = { outcome: 'armed', excluded: [{ deviceId: 42, name: 'Porch', state: 'open' }] }
    const model = alarmControlModel(
      input({
        status: armedAway,
        lastOutcome: stale,
        lastOutcomeAt: 1_000,
        ncLive: live({ state: 'armed_away', exclusions: [{ deviceId: 50, name: 'Garage', phase: 'closed' }] }),
        ncLiveAt: 9_000,
      }),
    )
    expect(model.excluded).toEqual([{ deviceId: 50, name: 'Garage' }])
  })

  describe('right after Arm anyway, while the live view LAGS', () => {
    const outcome: NcAlarmArmOutcome = { outcome: 'armed', excluded: [{ deviceId: 42, name: 'Porch', state: 'open' }] }

    it('a live snapshot OLDER than the outcome is not the answer yet', () => {
      const model = alarmControlModel(
        input({
          status: armedAway,
          lastOutcome: outcome,
          lastOutcomeAt: 5_000,
          ncLive: live({ state: 'armed_away', exclusions: [] }),
          ncLiveAt: 4_000,
        }),
      )
      expect(model.excluded).toEqual([{ deviceId: 42, name: 'Porch' }])
    })

    it('a NEWER snapshot that still reads pre-arm (a fetch that started before the arm) is not either', () => {
      const model = alarmControlModel(
        input({
          status: armedAway,
          lastOutcome: outcome,
          lastOutcomeAt: 5_000,
          ncLive: live({ state: 'disarmed', targetMode: null, exclusions: [] }),
          ncLiveAt: 6_000,
        }),
      )
      expect(model.excluded).toEqual([{ deviceId: 42, name: 'Porch' }])
    })

    it('once live has caught up (newer AND armed), live wins', () => {
      const model = alarmControlModel(
        input({
          status: armedAway,
          lastOutcome: outcome,
          lastOutcomeAt: 5_000,
          ncLive: live({ state: 'armed_away', exclusions: [{ deviceId: 42, name: 'Porch', phase: 'open' }] }),
          ncLiveAt: 6_000,
        }),
      )
      expect(model.excluded).toEqual([{ deviceId: 42, name: 'Porch' }])
      const closedSince = alarmControlModel(
        input({
          status: armedAway,
          lastOutcome: outcome,
          lastOutcomeAt: 5_000,
          ncLive: live({ state: 'armed_away', exclusions: [] }),
          ncLiveAt: 6_000,
        }),
      )
      expect(closedSince.excluded).toEqual([])
    })
  })

  it('a disarmed panel excludes nothing, whatever the last outcome said', () => {
    const outcome: NcAlarmArmOutcome = { outcome: 'arming', excluded: [{ deviceId: 42, name: 'Porch', state: 'open' }] }
    expect(alarmControlModel(input({ lastOutcome: outcome })).excluded).toEqual([])
  })
})

describe('capRefusalDevices — a non-admin\'s refusal, in our own words (m4)', () => {
  it('reads the devices out of the cap refusal', () => {
    expect(capRefusalDevices('arm refused — open: Porch, Garage. Use "Arm anyway" to arm with them excluded.')).toBe(
      'Porch, Garage',
    )
  })

  it('survives a transport prefix', () => {
    expect(capRefusalDevices('TRPCClientError: arm refused — open: Porch. Use "Arm anyway" to arm')).toBe('Porch')
  })

  it('any other text is not a refusal', () => {
    expect(capRefusalDevices('panel offline')).toBeNull()
  })
})

describe('alarmRefusalLine — a refusal that names no device still reads as a refusal', () => {
  it('names the open devices with their state', () => {
    expect(
      alarmRefusalLine([
        { deviceId: 42, name: 'Porch', state: 'open' },
        { deviceId: 43, name: '', state: 'unlocked' },
      ]),
    ).toEqual({
      key: 'v2.accessories.alarmRefused',
      devices: [
        { deviceId: 42, name: 'Porch', state: 'open' },
        { deviceId: 43, name: '', state: 'unlocked' },
      ],
    })
  })

  it('an EMPTY blocking list has its own line, never "open: " with nothing after it', () => {
    expect(alarmRefusalLine([])).toEqual({ key: 'v2.accessories.alarmRefusedNone' })
  })
})

describe('alarmControlModel — inputs bypassed until disarm (D62)', () => {
  const door = { ruleId: 'r-door', ruleName: 'Door alarm', deviceId: 7, name: 'Back door', since: 1, dropped: 2 }

  it('an armed NC panel names the inputs it is ignoring, with what was dropped', () => {
    const model = alarmControlModel(input({ ncLive: live({ state: 'armed_away', bypassedInputs: [door] }) }))
    expect(model.bypassed).toEqual([{ ruleId: 'r-door', deviceId: 7, name: 'Back door', dropped: 2 }])
  })

  it('says nothing once the panel reads disarmed — the hub clears them on disarm', () => {
    const model = alarmControlModel(
      input({ status: disarmed, ncLive: live({ state: 'disarmed', targetMode: null, bypassedInputs: [door] }) }),
    )
    expect(model.bypassed).toEqual([])
  })

  it('another panel never borrows the NC panel\'s list', () => {
    const model = alarmControlModel(
      input({ deviceId: PANEL + 1, ncLive: live({ state: 'armed_away', bypassedInputs: [door] }) }),
    )
    expect(model.bypassed).toEqual([])
  })
})
