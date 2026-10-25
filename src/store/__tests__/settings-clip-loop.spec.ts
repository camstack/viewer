/**
 * The loop switch's default, and what an OLD settings document does to it.
 *
 * > *"un pulsante di loop nella playback bar, default true"* — the operator,
 * > 2026-09-23.
 *
 * It lives in `settings.stream` rather than in a store of its own because it
 * is the same kind of answer as `audioOnOpen` and `toolbarDensity`: one
 * per-operator preference about how a camera plays, already hydrated once at
 * launch and already persisted by the one writer. A new zustand store would
 * be a second hydration path for one boolean.
 *
 * The ABSENT case is the one that matters. Every install that exists today has
 * a persisted document written before this field, and `bool(…, DEFAULT)` is
 * what gives those installs the operator's ON rather than a silent `false` —
 * the discipline `haptics.uiFeedback` was written with for exactly this
 * reason.
 */
import { describe, it, expect } from 'vitest'
import { DEFAULTS, parseSettings, setStreamDefaultEntry } from '../settings-store.js'

describe('settings.stream.clipLoop', () => {
  it('is ON out of the box — the operator asked for that default by name', () => {
    expect(DEFAULTS.stream.clipLoop).toBe(true)
  })

  it('reads ON from a document persisted before the field existed', () => {
    const before = JSON.stringify({ stream: { audioOnOpen: 'off' } })
    expect(parseSettings(before).stream.clipLoop).toBe(true)
    // …and the rest of that document is still honoured, so this is a default
    // filling a gap and not a document being thrown away.
    expect(parseSettings(before).stream.audioOnOpen).toBe('off')
  })

  it('keeps a stored OFF — a decision is not a gap', () => {
    const stored = JSON.stringify({ stream: { clipLoop: false } })
    expect(parseSettings(stored).stream.clipLoop).toBe(false)
  })

  it('is switched immutably, like every other stream default', () => {
    const next = setStreamDefaultEntry(DEFAULTS, 'clipLoop', false)
    expect(next.stream.clipLoop).toBe(false)
    expect(DEFAULTS.stream.clipLoop).toBe(true)
  })
})
