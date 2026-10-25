/**
 * What the next launch is able to say about the previous one.
 *
 * The case that matters is `vanished`: a marker still reading `running` is the
 * ONLY evidence an OS memory kill or a native crash can ever leave, and it is
 * exactly what a "the app crashes when I open it" report is made of. The rest
 * of these assertions exist to stop that answer being manufactured by accident
 * — a corrupt marker, or an OTA reload, must never read as a crash.
 */
import { describe, it, expect } from 'vitest'
import {
  classifyPreviousExit,
  CRASH_STACK_MAX_CHARS,
  describeThrown,
  isCrashExit,
  parseExitMarker,
  serializeExitMarker,
  type ExitMarker,
} from '../crash-record.js'

describe('classifyPreviousExit', () => {
  it('reads a marker still saying "running" as vanished', () => {
    // The runtime was alive and never wrote its reason: jetsam, a native crash,
    // or a force-quit. No JS handler can observe any of the three.
    expect(classifyPreviousExit({ kind: 'running', at: 1 })).toBe('vanished')
  })

  it('does not call a deliberate OTA reload a crash', () => {
    // `OtaUpdateGate` restarts the runtime on purpose at launch. It produces a
    // second `transportReady` that looks identical to a crash in the hub logs.
    expect(classifyPreviousExit({ kind: 'ota-reload', at: 1 })).toBe('ota-reload')
    expect(isCrashExit('ota-reload')).toBe(false)
  })

  it('reports no marker as a first launch, never as a crash', () => {
    expect(classifyPreviousExit(null)).toBe('first-launch')
    expect(isCrashExit('first-launch')).toBe(false)
  })

  it('counts the three real failures as crashes', () => {
    expect(isCrashExit('js-fatal')).toBe(true)
    expect(isCrashExit('render-error')).toBe(true)
    expect(isCrashExit('vanished')).toBe(true)
  })
})

describe('parseExitMarker', () => {
  it('round-trips a fatal with its message and stack', () => {
    const marker: ExitMarker = {
      kind: 'js-fatal',
      at: 1_787_203_352_472,
      message: 'TypeError: x.toSorted is not a function',
      stack: 'at rule-editor.ts:12',
    }
    expect(parseExitMarker(serializeExitMarker(marker))).toEqual(marker)
  })

  it('refuses corrupt or unknown content rather than inventing a crash', () => {
    expect(parseExitMarker(null)).toBeNull()
    expect(parseExitMarker('')).toBeNull()
    expect(parseExitMarker('{ not json')).toBeNull()
    expect(parseExitMarker('[]')).toBeNull()
    expect(parseExitMarker('"running"')).toBeNull()
    expect(parseExitMarker('{"kind":"exploded","at":1}')).toBeNull()
  })

  it('keeps a marker whose timestamp is missing — the KIND is the finding', () => {
    expect(parseExitMarker('{"kind":"running"}')).toEqual({
      kind: 'running',
      at: 0,
      message: undefined,
      stack: undefined,
    })
  })
})

describe('describeThrown', () => {
  it('names the error type, which is what identifies a Hermes built-in fault', () => {
    const described = describeThrown(new TypeError('a.toSorted is not a function'))
    expect(described.message).toBe('TypeError: a.toSorted is not a function')
  })

  it('bounds the stack — the marker is stored and re-shipped', () => {
    const error = new Error('deep')
    error.stack = 'x'.repeat(CRASH_STACK_MAX_CHARS * 2)
    expect(describeThrown(error).stack).toHaveLength(CRASH_STACK_MAX_CHARS)
  })

  it('survives a thrown non-Error', () => {
    // A rejected string and `throw undefined` are both real and were both
    // invisible before this module existed.
    expect(describeThrown('boom').message).toBe('boom')
    expect(describeThrown(undefined).message).toBe('undefined')
    expect(describeThrown(undefined).stack).toBeNull()
  })
})

describe('a normal close is not a crash', () => {
  /*
   * The defect this pins, reported 2026-08-26: "muore dopo alcune ore di scrub",
   * then narrowed by the operator to "subito dopo un OTA, o quando chiudo subito
   * dopo che l'applicazione parte".
   *
   * There were 57 `vanished` verdicts in 72 hours across TWELVE app versions —
   * a rate no real crash sustains across that many builds. The cause was here:
   * the marker had no state for a normal close, so the only writers were a JS
   * fatal and the OTA gate. Swipe the app away and the marker is still
   * `running`, so the next launch classifies `vanished` and `isCrashExit` calls
   * it a crash. `PreviousExit`'s own doc comment admitted it — "an OS memory
   * kill, a native crash, OR THE OPERATOR FORCE-QUITTING" — and counted all
   * three as one.
   *
   * The cost was not the false alarm. It was that a REAL foreground kill, the
   * thing the operator was actually reporting, was indistinguishable from
   * closing the app, so it could never be found.
   */
  it('a runtime that went to background reports backgrounded, not a crash', () => {
    expect(classifyPreviousExit({ kind: 'backgrounded', at: 1 })).toBe('backgrounded')
    expect(isCrashExit('backgrounded')).toBe(false)
  })

  it('vanished now means the runtime died IN THE FOREGROUND — still a crash', () => {
    // The marker only reads `running` while the app is frontmost: going to
    // background overwrites it, and coming back re-arms. So what survives here
    // is the case worth waking someone for.
    expect(classifyPreviousExit({ kind: 'running', at: 1 })).toBe('vanished')
    expect(isCrashExit('vanished')).toBe(true)
  })

  it('accepts a stored backgrounded marker — an unknown kind would read as a crash', () => {
    // parseExitMarker rejecting the new kind would classify every normal close
    // as `first-launch`… and any later `running` as `vanished` again. The
    // round-trip is the guard.
    const parsed = parseExitMarker(serializeExitMarker({ kind: 'backgrounded', at: 42 }))
    expect(parsed?.kind).toBe('backgrounded')
  })
})
