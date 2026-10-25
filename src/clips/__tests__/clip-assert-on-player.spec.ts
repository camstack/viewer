/**
 * A clip on the stage is a STATE, not an event that happened once.
 *
 * The operator: *"faccio partire una clip → parte la live"*, and *"i pulsanti
 * avanti/dietro clips non fanno nulla"*. One cause for both: the command fired
 * at the tap and was dropped when `liveRef.current` was null — and the player
 * is born BECAUSE of that tap, 690 ms later, on the live edge.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { assertionAfterPlayerChange, shouldAssertClip } from '../clip-assert-on-player.js'

const input = (patch: Partial<Parameters<typeof shouldAssertClip>[0]> = {}) => ({
  heldClipId: 'native:reolink:onboard:0:abc',
  playerPresent: true,
  playerState: 'playing',
  assertedClipId: null,
  ...patch,
})

describe('shouldAssertClip', () => {
  it('sends the held clip once a player is there and listening', () => {
    expect(shouldAssertClip(input())).toBe(true)
  })

  it('does NOT send twice for the same clip on the same player', () => {
    // Idempotent, or every render would restart the file from its first frame.
    expect(shouldAssertClip(input({ assertedClipId: 'native:reolink:onboard:0:abc' }))).toBe(false)
  })

  it('sends the NEXT clip after prev/next moved the stage', () => {
    expect(shouldAssertClip(input({ assertedClipId: 'some-older-clip' }))).toBe(true)
  })

  it('waits while the player is connecting — a ref is not a channel', () => {
    // This is the hole the trace fell into: `liveRef.current` is non-null the
    // render the component mounts, and a command sent then is dropped just as
    // silently as one sent with no player at all.
    expect(shouldAssertClip(input({ playerState: 'connecting' }))).toBe(false)
  })

  it('does not shout at a failed player', () => {
    expect(shouldAssertClip(input({ playerState: 'error' }))).toBe(false)
  })

  it('does nothing when there is no player', () => {
    expect(shouldAssertClip(input({ playerPresent: false }))).toBe(false)
  })

  it('does nothing when the session owns the frame', () => {
    expect(shouldAssertClip(input({ heldClipId: null }))).toBe(false)
  })
})

describe('assertionAfterPlayerChange — a reconnect forgets', () => {
  it('clears the record when the player goes away', () => {
    // Measured: `playing → connecting` at 08:13:59, and the clip was gone from
    // the server too. Keeping the record would make the rule above decide the
    // clip was still playing on a session that no longer exists.
    expect(assertionAfterPlayerChange('clip-1', false, 'playing')).toBeNull()
  })

  it('clears it on a reconnect and on an error', () => {
    expect(assertionAfterPlayerChange('clip-1', true, 'connecting')).toBeNull()
    expect(assertionAfterPlayerChange('clip-1', true, 'error')).toBeNull()
  })

  it('keeps it while the same player keeps playing', () => {
    expect(assertionAfterPlayerChange('clip-1', true, 'playing')).toBe('clip-1')
  })

  it('composes with the rule: cleared ⟹ the clip is asserted again', () => {
    const after = assertionAfterPlayerChange('clip-1', true, 'connecting')
    expect(shouldAssertClip(input({ heldClipId: 'clip-1', assertedClipId: after }))).toBe(true)
  })
})

/**
 * …and the screen must actually RUN it.
 *
 * A rule nothing executes is the failure this whole area keeps producing — six
 * times in three days. The pure cases above would stay green with the screen
 * unwired, which is exactly how `resolveClipsSurface` came to be computed and
 * read for one field out of five.
 */
describe('CameraDetailScreen runs the re-assertion', () => {
  const src = readFileSync(
    new URL('../../screens/CameraDetailScreen.tsx', import.meta.url).pathname,
    'utf8',
  )

  it('asks the rule rather than re-deriving the condition', () => {
    expect(src).toContain('shouldAssertClip({')
    expect(src).toContain('assertionAfterPlayerChange(')
  })

  it('re-sends through the hook, which is the only thing that knows the provider', () => {
    // Not `clipStagePorts.playClip(...)` with arguments rebuilt at the call
    // site: the file id is not the row's clipId for a twin, and a second place
    // deciding the provider is what D554 exists to prevent.
    expect(src).toContain('clipStage.replay()')
  })

  it('records a send from the PORT, so the tap is not re-sent by the effect', () => {
    // The record had one writer and two senders. The effect wrote it; the tap,
    // which reaches the same player through the same port, did not — so every
    // tap produced two injections and a Hikvision's single replay slot
    // contended with itself (`use-clip-stage-asserted-once.spec.ts`, and the
    // provider's own `replay-busy` lines). The port is where a send is known
    // to have landed, so the port is what writes it.
    expect(src).toContain('noteAsserted:')
    const at = src.indexOf('noteAsserted:')
    expect(src.slice(at, at + 200)).toContain('assertedClipRef.current = stageClipId')
    // And it must be able to REFUSE: a port that always answers `true` would
    // record a command carried into the mount and suppress the recovery.
    expect(src).toContain('return false')
  })

  it('watches the PLAYER STATE, not only the stage', () => {
    // The clip is dropped at the moment the player is absent or still
    // connecting; an effect that only watches the stage never fires again.
    const at = src.indexOf('shouldAssertClip({')
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(at, at + 600)).toContain('playerStatus.state')
  })
})
