/**
 * What the row's left icon does (type -> action), how it is tinted (state ->
 * tone) and when it moves (transitional), as pure functions.
 */
import { describe, expect, it } from 'vitest'
import {
  coverPlan, coverState, lockPlan, lockState, switchPlan, switchState,
  tilePulsing, tileQuickKind, tileTint,
} from '../tile-quick-action.js'

describe('tileQuickKind', () => {
  it('maps the type to its primary action', () => {
    expect(tileQuickKind('switch', false, true)).toBe('switch')
    expect(tileQuickKind('brightness', false, true)).toBe('switch')
    expect(tileQuickKind('fan', false, true)).toBe('switch')
    expect(tileQuickKind('cover', false, true)).toBe('cover')
    expect(tileQuickKind('valve', false, true)).toBe('cover')
    expect(tileQuickKind('lock', false, true)).toBe('lock')
  })
  it('media and climate use the hub row power toggle, and have none without it', () => {
    expect(tileQuickKind('media-player', true, true)).toBe('hero-power')
    expect(tileQuickKind('climate', true, true)).toBe('hero-power')
    expect(tileQuickKind('media-player', false, true)).toBe('none')
  })
  it('types without a primary action stay plain', () => {
    expect(tileQuickKind('sensor', false, true)).toBe('none')
    expect(tileQuickKind('alarm', false, true)).toBe('none')
    expect(tileQuickKind('none', false, true)).toBe('none')
  })
  it('a hub power toggle never promotes a kind that is not whitelisted', () => {
    expect(tileQuickKind('sensor', true, true)).toBe('none')
    expect(tileQuickKind('alarm', true, true)).toBe('none')
    expect(tileQuickKind('vacuum', true, true)).toBe('none')
    expect(tileQuickKind('none', true, true)).toBe('none')
  })
  it('a read-only session gets no action for any type', () => {
    expect(tileQuickKind('switch', true, false)).toBe('none')
    expect(tileQuickKind('lock', true, false)).toBe('none')
    expect(tileQuickKind('cover', true, false)).toBe('none')
  })
})

describe('plans', () => {
  it('a switch flips; unknown asks for on', () => {
    expect(switchPlan(true)?.call.args).toEqual({ on: false })
    expect(switchPlan(true)?.label).toBe('powerOff')
    expect(switchPlan(false)?.call.args).toEqual({ on: true })
    expect(switchPlan(null)).toBeNull()
  })
  it('a cover stops while moving, closes when open, otherwise opens', () => {
    expect(coverPlan('cover', 'opening')?.call.method).toBe('stop')
    expect(coverPlan('cover', 'closing')?.call.method).toBe('stop')
    expect(coverPlan('cover', 'open')?.call.method).toBe('close')
    expect(coverPlan('cover', 'closed')?.call.method).toBe('open')
    expect(coverPlan('valve', 'stopped')?.call).toMatchObject({ cap: 'valve', method: 'open' })
  })
  it('an unread or unrecognised cover state offers nothing', () => {
    expect(coverPlan('cover', null)).toBeNull()
    expect(coverPlan('cover', 'jammed')).toBeNull()
  })
  it('a lock locks at once and unlocks only armed; mid-travel or unread offers nothing', () => {
    expect(lockPlan('unlocked')?.call).toMatchObject({ method: 'lock', armId: null })
    expect(lockPlan('locked')?.call).toMatchObject({ method: 'unlock', armId: 'lock.unlock' })
    expect(lockPlan('locking')).toBeNull()
    expect(lockPlan('unlocking')).toBeNull()
    expect(lockPlan(null)).toBeNull()
  })
})

describe('device state', () => {
  it('reads the settled and the moving states', () => {
    expect(switchState(true)).toBe('on')
    expect(switchState(false)).toBe('off')
    expect(switchState(null)).toBe('unknown')
    expect(coverState('opening')).toBe('transitional')
    expect(coverState('open')).toBe('on')
    expect(coverState('closed')).toBe('off')
    expect(lockState('unlocking')).toBe('transitional')
    expect(lockState('locked')).toBe('on')
    expect(lockState('unlocked')).toBe('off')
  })
})

describe('tileTint', () => {
  const base = { online: true, failed: false, activeTone: 'warning', restingTone: 'muted' } as const
  it('active wears the accent, off and unknown are muted', () => {
    expect(tileTint({ ...base, state: 'on' })).toEqual({ tone: 'warning', disabled: false })
    expect(tileTint({ ...base, state: 'off' }).tone).toBe('muted')
    expect(tileTint({ ...base, state: 'unknown' }).tone).toBe('muted')
  })
  it('a muted active tone falls back to primary', () => {
    expect(tileTint({ ...base, activeTone: 'muted', state: 'on' }).tone).toBe('primary')
  })
  it('offline is disabled and beats a failure; a failure is danger', () => {
    expect(tileTint({ ...base, online: false, failed: true, state: 'on' })).toEqual({ tone: 'muted', disabled: true })
    expect(tileTint({ ...base, failed: true, state: 'on' }).tone).toBe('danger')
  })
  it('before the state is read the hub look stands', () => {
    expect(tileTint({ ...base, state: 'loading' }).tone).toBe('muted')
  })
})

describe('tilePulsing', () => {
  it('pulses while sending or moving', () => {
    expect(tilePulsing('off', true, false)).toBe(true)
    expect(tilePulsing('transitional', false, false)).toBe(true)
  })
  it('stops when settled or after the timeout', () => {
    expect(tilePulsing('on', false, false)).toBe(false)
    expect(tilePulsing('transitional', true, true)).toBe(false)
  })
})
