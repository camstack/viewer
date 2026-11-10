import { describe, expect, it } from 'vitest'

import {
  parsePowerSourceActionResult,
  parsePowerSourceStatus,
  powerSwitchState,
} from '../power-source.js'

const LINKED = {
  linked: true,
  switchDeviceId: 9,
  switchName: 'Plug',
  switchOn: true,
  switchOnline: true,
  restartInProgress: false,
  offSeconds: 10,
}

describe('parsePowerSourceStatus', () => {
  it('reads a linked source', () => {
    expect(parsePowerSourceStatus(LINKED)).toEqual({
      linked: true,
      switchName: 'Plug',
      switchOn: true,
      switchOnline: true,
      restartInProgress: false,
    })
  })

  it('keeps an unreported switch as null, never false', () => {
    const status = parsePowerSourceStatus({ ...LINKED, switchOn: null, switchOnline: null })
    expect(status?.switchOn).toBeNull()
    expect(status === null ? null : powerSwitchState(status)).toBe('unknown')
  })

  it('an unreadable payload is null (unknown), not "not linked"', () => {
    expect(parsePowerSourceStatus(null)).toBeNull()
    expect(parsePowerSourceStatus({ switchOn: true })).toBeNull()
    expect(parsePowerSourceStatus({ ...LINKED, switchOn: 'yes' })).toBeNull()
  })

  it('a well-formed unlinked answer is linked:false', () => {
    const status = parsePowerSourceStatus({ ...LINKED, linked: false, switchOn: null, switchOnline: null })
    expect(status?.linked).toBe(false)
  })
})

describe('parsePowerSourceActionResult', () => {
  it('reads an acceptance and a typed refusal', () => {
    expect(parsePowerSourceActionResult({ accepted: true })).toEqual({ accepted: true })
    expect(
      parsePowerSourceActionResult({ accepted: false, reason: 'switch-offline', message: 'Plug is offline' }),
    ).toEqual({ accepted: false, reason: 'switch-offline', message: 'Plug is offline' })
  })

  it('rejects a shape it does not know', () => {
    expect(parsePowerSourceActionResult({ accepted: false })).toBeNull()
    expect(parsePowerSourceActionResult('ok')).toBeNull()
  })
})
