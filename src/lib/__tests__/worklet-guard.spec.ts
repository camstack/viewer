/**
 * A gesture worklet that throws must not kill the app.
 *
 * ## The three crashes this exists for
 *
 * TestFlight, build 1.0.454 (16), iPhone16,2 / iOS 26.5.2 — three reports from
 * the operator, all in the same layer:
 *
 *  - **"Joystick"** (2026-09-10 09:16:01) — `EXC_CRASH (SIGABRT)`. The stack is
 *    unambiguous: `RNGestureHandler sendEvent` → `REANodesManager
 *    dispatchEvent` → `reanimated::UIEventHandler::process` →
 *    `worklets::runSyncOnRuntime` → `hermesvm ... throwPendingError` →
 *    `__cxa_throw` → `abort`. A JS exception inside a worklet running
 *    SYNCHRONOUSLY on the UI thread. There is no JS frame to catch it, so the
 *    process is aborted.
 *  - **"Boooh"** (09:13:52) — `SIGSEGV` with a pointer-authentication failure
 *    in `Scheduler::uiManagerDidDispatchCommand`.
 *  - **"Zoom"** (2026-09-08 20:31) — `SIGSEGV` at `0x11` inside
 *    `worklets::JSIWorkletsModuleProxy::toOptimizedObject`.
 *
 * Ruled out by inspection, so this is not a guess at the cause: the versions
 * agree (reanimated 4.5.0 / worklets 0.10.0 / gesture-handler 2.32.0), the
 * joystick's maths helpers ARE workletized (`joystickVector`,
 * `joystickThumbPosition` both carry `'worklet'`), and both call sites pass
 * `onVector` and `onRelease`.
 *
 * ## Why a guard and not a fix
 *
 * The native crash log does not carry the JS error message — Hermes does not
 * put it there — and the app dies before its logger can ship anything, so the
 * hub has no `app:error` for either crash. Twelve hours of hub logs and three
 * full crash reports cannot name the throwing line. Guessing at it would be
 * the third guess of one morning.
 *
 * So: catch inside the worklet, report the message through the normal log
 * path, and let the gesture be dropped. A dropped gesture is a missed swipe;
 * an uncaught one is a terminated app. And the next occurrence arrives with
 * the message attached, which is what actually closes the investigation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logger.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { log } = await import('../logger.js')
const { guardWorklet } = await import('../worklet-guard.js')

describe('guardWorklet', () => {
  beforeEach(() => {
    vi.mocked(log.error).mockClear()
  })

  it('passes the arguments through and returns nothing when the body is fine', () => {
    const seen: number[] = []
    const guarded = guardWorklet('test', (a: number, b: number) => {
      seen.push(a + b)
    })

    guarded(2, 3)

    expect(seen).toEqual([5])
    expect(log.error).not.toHaveBeenCalled()
  })

  it('swallows a throw instead of letting it reach the UI runtime', () => {
    const guarded = guardWorklet('joystick', () => {
      throw new Error('undefined is not a function')
    })

    // An uncaught throw here is `abort()` on a device. It must not escape.
    expect(() => guarded()).not.toThrow()
  })

  it('reports the message, so the next crash names its own cause', () => {
    const guarded = guardWorklet('joystick', () => {
      throw new Error('undefined is not a function')
    })

    guarded()

    expect(log.error).toHaveBeenCalledTimes(1)
    const [scope, , data] = vi.mocked(log.error).mock.calls[0] as [string, string, { message: string }]
    expect(scope).toContain('joystick')
    expect(data.message).toContain('undefined is not a function')
  })

  it('survives a thrown value that is not an Error', () => {
    const guarded = guardWorklet('zoom', () => {
      // Hermes can surface a non-Error; stringifying must not throw in turn.
      throw 'raw string'
    })

    expect(() => guarded()).not.toThrow()
    expect(log.error).toHaveBeenCalled()
  })

  it('reports each distinct failure but does not flood on a repeating one', () => {
    const guarded = guardWorklet('pan', () => {
      throw new Error('same every frame')
    })

    // A gesture worklet runs on every frame of a passage: an unthrottled
    // report is a second storm, the same shape as the zone-refusal one.
    for (let i = 0; i < 120; i++) guarded()

    expect(vi.mocked(log.error).mock.calls.length).toBeLessThan(10)
  })
})
