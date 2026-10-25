import { describe, it, expect } from 'vitest'
import { createGridEmbedPlaybackSink } from '../use-grid-embed-playback.js'
import { gridCommandScript, type GridCommand } from '../embed-messages.js'

describe('createGridEmbedPlaybackSink', () => {
  it('maps every bus verb onto a grid command', () => {
    const sent: GridCommand[] = []
    const sink = createGridEmbedPlaybackSink((cmd) => void sent.push(cmd))

    sink.scrubStart()
    sink.scrubTo(1_000)
    sink.scrubCommit(2_000)
    sink.seek(3_000)
    sink.setRate(0)
    sink.goLive()

    expect(sent).toEqual([
      { kind: 'scrubStart' },
      { kind: 'scrubTo', value: 1_000 },
      { kind: 'scrubCommit', value: 2_000 },
      { kind: 'seek', value: 3_000 },
      { kind: 'setRate', value: 0 },
      { kind: 'goLive' },
    ])
  })

  it('every command it emits serializes to a callable page method', () => {
    const sent: GridCommand[] = []
    const sink = createGridEmbedPlaybackSink((cmd) => void sent.push(cmd))
    sink.scrubStart()
    sink.scrubTo(1_000)
    sink.seek(3_000)
    sink.setRate(1)
    sink.goLive()

    for (const cmd of sent) {
      const script = gridCommandScript(cmd)
      expect(script).toContain('window.__camstackGrid')
      // The METHOD guard, not just the object one: an embed build without the
      // playback verbs must no-op rather than throw on every drag frame.
      expect(script).toContain(`typeof window.__camstackGrid.${cmd.kind} === 'function'`)
      expect(script.trim().endsWith('true;')).toBe(true)
    }
  })

  it('serializes the argument-less verbs with EMPTY parens (not `undefined`)', () => {
    expect(gridCommandScript({ kind: 'scrubStart' })).toContain('.scrubStart()')
    expect(gridCommandScript({ kind: 'goLive' })).toContain('.goLive()')
    expect(gridCommandScript({ kind: 'reconnect' })).toContain('.reconnect()')
    expect(gridCommandScript({ kind: 'seek', value: 1_700_000_000_000 })).toContain('.seek(1700000000000)')
    expect(gridCommandScript({ kind: 'setRate', value: 0 })).toContain('.setRate(0)')
    expect(gridCommandScript({ kind: 'fit', w: 800, h: 600 })).toContain('.fit(800, 600)')
  })
})
