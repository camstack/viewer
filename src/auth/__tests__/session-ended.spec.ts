/**
 * Recognising "the hub ended this session": the 4401 close (bare, or nested in
 * the closed-error chain a rejected request and the connection state carry) and
 * an UNAUTHORIZED answer. Anything else is NOT a sign-out.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isSessionEndedClose,
  isSessionEndedError,
  reportSessionEnded,
  SESSION_ENDED_CLOSE_CODE,
  watchSessionEndedClose,
} from '../session-ended.js'
import { setUnauthorizedHandler } from '../unauthorized-signal.js'

const unauthorized = Object.assign(new Error('x'), { data: { code: 'UNAUTHORIZED' } })
const closedWith = (code: number) =>
  Object.assign(new Error('WebSocket closed'), { cause: { code, reason: 'session-ended' } })

afterEach(() => setUnauthorizedHandler(null))

describe('isSessionEndedClose', () => {
  it('knows the close code the hub uses', () => {
    expect(SESSION_ENDED_CLOSE_CODE).toBe(4401)
  })

  it('matches the CloseEvent itself, a closed-error wrapping it, and the connection-state error wrapping that', () => {
    expect(isSessionEndedClose({ code: 4401 })).toBe(true)
    expect(isSessionEndedClose(closedWith(4401))).toBe(true)
    expect(isSessionEndedClose(Object.assign(new Error('c'), { cause: closedWith(4401) }))).toBe(true)
  })

  it('does not match an ordinary drop, a different code, or junk', () => {
    expect(isSessionEndedClose(closedWith(1006))).toBe(false)
    expect(isSessionEndedClose(closedWith(1000))).toBe(false)
    expect(isSessionEndedClose(null)).toBe(false)
    expect(isSessionEndedClose('4401')).toBe(false)
  })

  it('terminates on a cyclic cause chain', () => {
    const a: Record<string, unknown> = {}
    a.cause = a
    expect(isSessionEndedClose(a)).toBe(false)
  })
})

describe('reportSessionEnded', () => {
  it('signals the renewal path for UNAUTHORIZED and for a session-ended close', () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    expect(reportSessionEnded(unauthorized)).toBe(true)
    expect(reportSessionEnded(closedWith(4401))).toBe(true)
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('stays silent for FORBIDDEN, a timeout, a plain drop', () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    expect(reportSessionEnded(Object.assign(new Error('no'), { data: { code: 'FORBIDDEN' } }))).toBe(false)
    expect(reportSessionEnded(new Error('deadline'))).toBe(false)
    expect(reportSessionEnded(closedWith(1006))).toBe(false)
    expect(handler).not.toHaveBeenCalled()
    expect(isSessionEndedError(unauthorized)).toBe(true)
  })
})

describe('watchSessionEndedClose', () => {
  function source() {
    const observers: Array<{ next(state: unknown): void }> = []
    const unsubscribe = vi.fn()
    return {
      emit: (state: unknown) => observers.forEach((o) => o.next(state)),
      unsubscribe,
      connectionState: {
        subscribe: (observer: { next(state: unknown): void }) => {
          observers.push(observer)
          return { unsubscribe }
        },
      },
    }
  }

  it('fires when the socket reports the session-ended close, not for another drop', () => {
    const s = source()
    const onEnded = vi.fn()
    watchSessionEndedClose(s, onEnded)
    s.emit({ type: 'state', state: 'connecting', error: closedWith(1006) })
    s.emit({ type: 'state', state: 'pending', error: null })
    expect(onEnded).not.toHaveBeenCalled()
    s.emit({ type: 'state', state: 'connecting', error: Object.assign(new Error('c'), { cause: closedWith(4401) }) })
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('stops watching when told to', () => {
    const s = source()
    watchSessionEndedClose(s, () => undefined)()
    expect(s.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
