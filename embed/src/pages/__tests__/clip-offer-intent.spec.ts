import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClipOfferIntent, opensInRecorded } from '../clip-offer-intent'

const HINTS = { viewportWidth: 1290, downlinkMbps: 24 }

describe('createClipOfferIntent', () => {
  it('marks only the first offer of a clip-opened page', () => {
    const gate = createClipOfferIntent(true)
    expect(gate.forOffer(HINTS)).toEqual({ ...HINTS, intent: 'clip' })
    expect(gate.forOffer(HINTS)).toEqual(HINTS)
    expect(gate.forOffer(undefined)).toBeUndefined()
  })

  it('carries the intent even when the first offer has no hints', () => {
    expect(createClipOfferIntent(true).forOffer(undefined)).toEqual({ intent: 'clip' })
  })

  it('never marks a live-opened page', () => {
    const gate = createClipOfferIntent(false)
    expect(gate.forOffer(HINTS)).toEqual(HINTS)
    expect(gate.forOffer(HINTS)).toEqual(HINTS)
  })
})

describe('opensInRecorded', () => {
  it('a config-carried seek without a clip opens recorded (planning#566)', () => {
    expect(opensInRecorded({ initialSeekMs: 1_763_000_000_000 })).toBe(true)
  })

  it('a config-carried clip opens recorded', () => {
    expect(opensInRecorded({ initialClipId: 'clip-1' })).toBe(true)
  })

  it('a plain live open carries no clip intent', () => {
    expect(opensInRecorded({})).toBe(false)
    const gate = createClipOfferIntent(opensInRecorded({}))
    expect(gate.forOffer(HINTS)).toEqual(HINTS)
  })

  it('the first offer of a seek-opened page carries the clip intent, once', () => {
    const gate = createClipOfferIntent(opensInRecorded({ initialSeekMs: 1_763_000_000_000 }))
    expect(gate.forOffer(HINTS)).toEqual({ ...HINTS, intent: 'clip' })
    expect(gate.forOffer(HINTS)).toEqual(HINTS)
  })
})

describe('EmbedPlayerPage wiring', () => {
  const src = readFileSync(resolve(__dirname, '../EmbedPlayerPage.tsx'), 'utf8')

  it('seeds the gate from the recorded open (clip or seek), on the first offer only, never the re-offer', () => {
    expect(src).toContain('createClipOfferIntent(opensInRecorded({ initialClipId, initialSeekMs }))')
    expect(src).toMatch(
      /handleOffer\(\s*webrtcTarget,\s*sdpOffer,\s*sessionId,\s*clipOfferIntentRef\.current\.forOffer\(hints\)/,
    )
    expect(src).toContain('handleOffer(reofferTarget, sdpOffer, sessionId, hints)')
  })
})
