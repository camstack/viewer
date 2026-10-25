import { describe, it, expect } from 'vitest'
import { playbackCommandToMessage, playbackCommandToScript } from '../live-control-map'

describe('playbackCommandToScript', () => {
  it('emits playRecorded with deviceId, epoch, quoted profile', () => {
    expect(playbackCommandToScript({ kind: 'playRecorded', deviceId: 99, epochMs: 6000, profile: 'mid' }))
      .toContain('window.__camstackEmbed.playRecorded(99,6000,"mid")')
  })
  it('emits playClip with the clip id and offset, on BOTH serialisations', () => {
    // D575: a clip is another position of the recorded pointer, so it rides
    // the same bridge the seek and the scrub already ride. Two serialisations
    // exist — injected JS for the native WebView, an object for the web
    // postMessage — and a command added to one and not the other is a feature
    // that works on exactly one platform.
    expect(
      playbackCommandToScript({ kind: 'playClip', deviceId: 107, clipId: 'c:1', provider: 'provider-reolink', offsetMs: 0 }),
    ).toContain('window.__camstackEmbed.playClip(107,"c:1","provider-reolink",0)')
    expect(
      playbackCommandToMessage({ kind: 'playClip', deviceId: 107, clipId: 'c:1', provider: 'provider-reolink', offsetMs: 0 }),
    ).toEqual({ kind: 'playClip', deviceId: 107, clipId: 'c:1', provider: 'provider-reolink', offsetMs: 0 })
  })

  it('carries the profile on playClip only when one was picked', () => {
    // A stored file has no session to resolve an adaptive tier against;
    // absent means the provider's default, never a tier this side invented.
    expect(
      playbackCommandToScript({
        kind: 'playClip',
        deviceId: 107,
        clipId: 'c:1',
        provider: 'provider-reolink',
        offsetMs: 250,
        profile: 'high',
      }),
    ).toContain('window.__camstackEmbed.playClip(107,"c:1","provider-reolink",250,"high")')
    expect(
      playbackCommandToMessage({ kind: 'playClip', deviceId: 107, clipId: 'c:1', provider: 'provider-reolink', offsetMs: 250 }),
    ).not.toHaveProperty('profile')
  })

  it('QUOTES the clip id, which carries colons and base64 padding', () => {
    // A real one: `native:reolink:onboard:0:L21udC9zZGEv…`. Unquoted it is a
    // syntax error in the injected script and the tap dies silently.
    const script = playbackCommandToScript({
      kind: 'playClip',
      deviceId: 107,
      clipId: 'native:reolink:onboard:0:L21u+dGE=',
      provider: 'provider-reolink',
      offsetMs: 0,
    })
    expect(script).toContain('"native:reolink:onboard:0:L21u+dGE="')
  })

  it('emits seek and scrubCommit', () => {
    expect(playbackCommandToScript({ kind: 'seek', epochMs: 6000 })).toContain('window.__camstackEmbed.seek(6000)')
    expect(playbackCommandToScript({ kind: 'scrubCommit', epochMs: 6000 })).toContain('window.__camstackEmbed.scrubCommit(6000)')
  })
  it('emits drag commands', () => {
    expect(playbackCommandToScript({ kind: 'scrubStart' })).toContain('window.__camstackEmbed.scrubStart()')
    expect(playbackCommandToScript({ kind: 'scrubTo', epochMs: 6000 })).toContain('window.__camstackEmbed.scrubTo(6000)')
    expect(playbackCommandToScript({ kind: 'scrubEnd', epochMs: 6000 })).toContain('window.__camstackEmbed.scrubEnd(6000)')
  })
  it('emits setRate and goLive', () => {
    expect(playbackCommandToScript({ kind: 'setRate', rate: 0 })).toContain('window.__camstackEmbed.setRate(0)')
    expect(playbackCommandToScript({ kind: 'goLive' })).toContain('window.__camstackEmbed.goLive()')
  })
  it('emits startLiveCapture and stopLiveCapture', () => {
    expect(playbackCommandToScript({ kind: 'startLiveCapture' }))
      .toContain('window.__camstackEmbed.startLiveCapture()')
    expect(playbackCommandToScript({ kind: 'stopLiveCapture' }))
      .toContain('window.__camstackEmbed.stopLiveCapture()')
  })
  it('ends with the trailing true; injection contract', () => {
    expect(playbackCommandToScript({ kind: 'goLive' }).trim().endsWith('true;')).toBe(true)
  })
})
