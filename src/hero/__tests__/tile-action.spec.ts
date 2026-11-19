/**
 * The scene tile's resolver: model + type + reach in, the call out or null.
 */
import { describe, expect, it } from 'vitest'
import type { HeroAction, HeroControl, HeroRowModel, HeroState } from '@camstack/types'
import { LOCK_OPEN_ACTION, armCaptionKey, lockOpenAvailable, resolveTileAction } from '../tile-action.js'

const act = (id: string, cap = 'x', method = id, confirm: HeroAction['confirm'] = null): HeroAction => ({
  id,
  label: { en: id, it: id },
  icon: 'power',
  call: { cap, method, args: {} },
  emphasis: 'normal',
  confirm,
})

const toggle = (id: string, on: boolean | null, on_: string, off_: string): HeroControl => ({
  kind: 'toggle',
  id,
  label: { en: id, it: id },
  on,
  turnOn: act(on_),
  turnOff: act(off_),
})

function model(type: string, state: HeroState, primary: HeroControl | null, extras: HeroControl[] = []): HeroRowModel {
  return {
    deviceId: 1,
    name: 'd',
    type,
    state,
    stateAssumed: false,
    look: { icon: 'power', tone: 'muted', background: 'plain', animation: 'none' },
    scene: { id: 'generic', mode: null, level: null },
    statusLine: [],
    primary,
    extras,
    timedRun: null,
    trailing: null,
  }
}

const resolve = (m: HeroRowModel, over: { online?: boolean; canActuate?: boolean } = {}) =>
  resolveTileAction({ type: m.type, online: over.online ?? true, canActuate: over.canActuate ?? true, model: m })

const ownPower = (on: boolean | null): HeroControl => toggle('own-power', on, 'own-power.on', 'own-power.off')

describe('power types flip on and off', () => {
  for (const type of ['light', 'switch', 'siren', 'humidifier', 'water-heater', 'fan', 'media-player', 'dishwasher', 'washer', 'dryer', 'workload']) {
    it(`${type}: on -> off, off -> on`, () => {
      expect(resolve(model(type, 'on', ownPower(true)))?.id).toBe('own-power.off')
      expect(resolve(model(type, 'off', ownPower(false)))?.id).toBe('own-power.on')
    })
  }
  it('has no tile when the model carries no power toggle', () => {
    expect(resolve(model('media-player', 'on', null))).toBeNull()
  })
  it('does nothing while the toggle state is unknown', () => {
    expect(resolve(model('light', 'on', ownPower(null)))).toBeNull()
  })
})

describe('lock', () => {
  const unlock = (confirm: HeroAction['confirm']): HeroControl => ({ kind: 'action', action: act('lock.unlock', 'lock-control', 'unlock', confirm) })
  const lock: HeroControl = { kind: 'action', action: act('lock.lock', 'lock-control', 'lock') }
  it('locked -> unlock, and the unlock asks for a confirm', () => {
    const a = resolve(model('lock', 'on', unlock('unlock')))
    expect(a?.id).toBe('lock.unlock')
    expect(a?.confirm).toBe('unlock')
  })
  it('unlocked -> lock, with no confirm', () => {
    const a = resolve(model('lock', 'standby', lock))
    expect(a?.id).toBe('lock.lock')
    expect(a?.confirm).toBeNull()
  })
  it('jammed, moving, door-open and unknown give no action', () => {
    expect(resolve(model('lock', 'alert', null))).toBeNull()
    expect(resolve(model('lock', 'running', null))).toBeNull()
    expect(resolve(model('lock', 'standby', null))).toBeNull()
    expect(resolve(model('lock', 'unknown', unlock('unlock')))).toBeNull()
  })
})

describe('cover and valve', () => {
  it('closed -> open, open -> close, moving -> stop', () => {
    expect(resolve(model('cover', 'off', null))?.call).toMatchObject({ cap: 'cover', method: 'open' })
    expect(resolve(model('cover', 'on', null))?.call).toMatchObject({ cap: 'cover', method: 'close' })
    expect(resolve(model('cover', 'running', null))?.call).toMatchObject({ cap: 'cover', method: 'stop' })
    expect(resolve(model('valve', 'off', null))?.call).toMatchObject({ cap: 'valve', method: 'open' })
  })
  it('a shutter stopped half way has no obvious flip', () => {
    expect(resolve(model('cover', 'idle', null))).toBeNull()
  })
})

describe('vacuum and lawn mower', () => {
  it('running -> pause, paused -> resume, docked -> start', () => {
    expect(resolve(model('vacuum', 'running', null))?.id).toBe('vacuum.pause')
    expect(resolve(model('vacuum', 'standby', null))?.id).toBe('vacuum.resume')
    expect(resolve(model('vacuum', 'idle', null))?.id).toBe('vacuum.start')
    expect(resolve(model('lawn-mower', 'idle', null))?.call).toMatchObject({ cap: 'lawn-mower-control', method: 'startMowing' })
  })
})

describe('automation, script, pet fountain', () => {
  it('automation enables and disables', () => {
    expect(resolve(model('automation', 'on', toggle('automation.enabled', true, 'automation.enable', 'automation.disable')))?.id).toBe('automation.disable')
    expect(resolve(model('automation', 'off', toggle('automation.enabled', false, 'automation.enable', 'automation.disable')))?.id).toBe('automation.enable')
  })
  it('script runs and stops through its primary', () => {
    expect(resolve(model('script', 'idle', { kind: 'action', action: act('script.run') }))?.id).toBe('script.run')
    expect(resolve(model('script', 'running', { kind: 'action', action: act('script.stop') }))?.id).toBe('script.stop')
    expect(resolve(model('script', 'idle', { kind: 'action', action: act('something.else') }))).toBeNull()
  })
  it('pet fountain flips its pump, found among the extras too', () => {
    const pump = toggle('fountain.pump', true, 'fountain.pump.on', 'fountain.pump.off')
    expect(resolve(model('pet-fountain', 'on', null, [pump]))).toBeNull()
    expect(resolve(model('pet-fountain', 'on', pump))?.id).toBe('fountain.pump.off')
  })
})

describe('no tile', () => {
  it('climate, alarm panel, button, feeder, update, heat pump, control and read-only types are not pressable', () => {
    for (const type of ['climate', 'alarm-panel', 'button', 'pet-feeder', 'update', 'heat-pump', 'control', 'sensor', 'weather']) {
      expect(resolve(model(type, 'on', ownPower(true)))).toBeNull()
    }
  })
  it('offline device, no write scope, gated primary and unknown or offline state: not pressable', () => {
    const on = model('light', 'on', ownPower(true))
    expect(resolve(on, { online: false })).toBeNull()
    expect(resolve(on, { canActuate: false })).toBeNull()
    expect(resolve({ ...on, primaryGated: true })).toBeNull()
    expect(resolve(model('light', 'unknown', ownPower(true)))).toBeNull()
    expect(resolve(model('light', 'offline', ownPower(true)))).toBeNull()
  })
})

describe('lock.open', () => {
  it('is offered only to a lock with the feature that is at rest', () => {
    expect(lockOpenAvailable(['lock-open', 'lock'], 'locked')).toBe(true)
    expect(lockOpenAvailable(['lock-open'], 'unlocked')).toBe(true)
    expect(lockOpenAvailable(['lock'], 'locked')).toBe(false)
    expect(lockOpenAvailable(['lock-open'], 'jammed')).toBe(false)
    expect(lockOpenAvailable(['lock-open'], null)).toBe(false)
  })
  it('is double-tap confirmed and says so in its caption', () => {
    expect(LOCK_OPEN_ACTION.confirm).toBe('unlock')
    expect(armCaptionKey('lock.open')).toBe('v2.hero.tapAgain.open')
    expect(armCaptionKey('lock.unlock')).toBe('v2.hero.tapAgain.unlock')
  })
})
