import { describe, it, expect } from 'vitest'
import { coercePlayerHostMessage } from '../embed-player-messages.js'

describe('coercePlayerHostMessage', () => {
  it('parses a player state message object', () => {
    expect(coercePlayerHostMessage({ type: 'state', state: 'playing' })).toEqual({ type: 'state', state: 'playing' })
    expect(coercePlayerHostMessage({ type: 'state', state: 'connecting' })).toEqual({ type: 'state', state: 'connecting' })
  })
  it('parses a micState message object', () => {
    expect(coercePlayerHostMessage({ type: 'micState', state: 'talking' })).toEqual({ type: 'micState', state: 'talking' })
  })
  it('returns null for junk / unknown', () => {
    expect(coercePlayerHostMessage({ type: 'state', state: 'bogus' })).toBeNull()
    expect(coercePlayerHostMessage({ type: 'nope' })).toBeNull()
    expect(coercePlayerHostMessage(null)).toBeNull()
  })
})
