import { describe, it, expect } from 'vitest'
import {
  decideForeground,
  needsReconnectAfterPipExit,
  PIP_EXIT_SCRIPT,
} from '../pip-foreground.js'

describe('foreground return while the video may be in PiP', () => {
  it('does nothing when the app was not backgrounded', () => {
    expect(decideForeground({ backgrounded: false, lastPipMode: 'picture-in-picture' })).toBe('none')
  })

  it('never rebuilds the peer while the page is presenting PiP', () => {
    expect(decideForeground({ backgrounded: true, lastPipMode: 'picture-in-picture' })).toBe(
      'exit-pip-then-reconnect',
    )
  })

  it('rebuilds at once when PiP is not up', () => {
    expect(decideForeground({ backgrounded: true, lastPipMode: null })).toBe('reconnect')
    expect(decideForeground({ backgrounded: true, lastPipMode: 'inline' })).toBe('reconnect')
  })

  it('skips the rebuild after PiP exit when the stream kept playing', () => {
    expect(needsReconnectAfterPipExit('playing')).toBe(false)
    expect(needsReconnectAfterPipExit('error')).toBe(true)
    expect(needsReconnectAfterPipExit('connecting')).toBe(true)
  })

  it('the exit script only leaves PiP through the guarded WebKit call', () => {
    expect(PIP_EXIT_SCRIPT).toContain("webkitSetPresentationMode('inline')")
    expect(PIP_EXIT_SCRIPT).toContain("webkitPresentationMode==='picture-in-picture'")
  })
})
