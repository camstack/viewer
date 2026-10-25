import { describe, expect, it } from 'vitest'
import { createRenewalCooldown, RENEWAL_COOLDOWN_MS } from '../renewal-cooldown.js'

describe('renewal cool-down', () => {
  it('a renewal that could not settle is answered again, for that server only, until the window ends', () => {
    let now = 1_000
    const cooldown = createRenewalCooldown(() => now)
    cooldown.record('a', { status: 'failed', message: 'HTTP 503' })
    expect(cooldown.active('a')).toEqual({ status: 'failed', message: 'HTTP 503' })
    expect(cooldown.active('b')).toBeNull()
    now += RENEWAL_COOLDOWN_MS
    expect(cooldown.active('a')).toBeNull()
  })

  it('unavailable cools down too; renewed and refused never do', () => {
    const cooldown = createRenewalCooldown(() => 0)
    cooldown.record('a', { status: 'unavailable' })
    expect(cooldown.active('a')).not.toBeNull()
    cooldown.record('a', { status: 'refused' })
    expect(cooldown.active('a')).toBeNull()
    cooldown.record('a', { status: 'renewed', token: 't', refreshToken: 'r', supersededToken: null })
    expect(cooldown.active('a')).toBeNull()
  })
})
