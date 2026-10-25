/**
 * worklet-guard — a gesture worklet that throws drops the gesture, not the app.
 *
 * A worklet attached to a gesture runs SYNCHRONOUSLY on the UI runtime. There
 * is no JS frame above it to catch anything, so an uncaught error is not an
 * error: it is `hermesvm ... throwPendingError` → `__cxa_throw` → `abort`, a
 * terminated process. Three TestFlight reports on build 1.0.454 land in that
 * layer — see `__tests__/worklet-guard.spec.ts` for the stacks and for what
 * was ruled out before writing this.
 *
 * The native crash log does not carry the JS message and the app dies before
 * its logger can ship one, so the hub has nothing. This closes both halves:
 * the throw is contained, and the message travels the normal log path
 * (`app:error:worklet:<scope>` on the hub) so the NEXT occurrence explains
 * itself instead of arriving as another hex stack.
 *
 * Reports are throttled per guard. A gesture worklet runs on every frame of a
 * passage, so an error that repeats is an unbounded emitter — the same shape
 * that made 1473 zone-refusal events out of one stationary parcel.
 */
import { runOnJS } from 'react-native-reanimated'
import { log } from './logger.js'

/** Reports after the first are dropped inside this window. */
const REPORT_THROTTLE_MS = 10_000
/** Always report this many, so a one-off is never swallowed by the throttle. */
const REPORT_ALWAYS_FIRST = 3

/** Runs on the JS thread, hopped to from inside the worklet. */
function reportWorkletError(scope: string, message: string, seen: number): void {
  log.error(`worklet:${scope}`, 'worklet threw — the gesture was dropped instead of the app', {
    message,
    seen,
  })
}

/**
 * Wrap a gesture worklet body. The returned function is itself a worklet and
 * may be handed straight to `.onBegin` / `.onUpdate` / `.onFinalize`.
 *
 * **`body` MUST open with `'worklet'`.** The plugin workletizes a function
 * only for that directive or as the DIRECT argument of a builder method it
 * knows (`.onStart`, `.onUpdate`, …); an argument of `guardWorklet` is
 * neither. A body without the directive is captured here as a plain JS
 * function, reaches the UI runtime as a Remote Function and throws on every
 * call — which this guard then dutifully catches and reports, so the gesture
 * is dropped on every frame. That shipped in 1.0.479 and killed the pinch,
 * the pan and the joystick until 1.0.484 (97 `app:error:worklet:zoom.*` lines
 * on the hub, not one crash). `__tests__/worklet-guard-callsites.spec.ts`
 * runs the real plugin over every call site so it cannot ship again.
 *
 * `scope` names the surface in the log (`joystick`, `zoom`, `pan`), so a crash
 * report points at a gesture rather than at the app.
 */
export function guardWorklet<A extends readonly unknown[]>(
  scope: string,
  body: (...args: A) => void,
): (...args: A) => void {
  // Worklet-shared mutable state must live in the captured closure object, not
  // in loose `let`s: a worklet copies its captures by value per call site.
  const state = { count: 0, lastReportAt: 0 }
  return (...args: A): void => {
    'worklet'
    try {
      body(...args)
    } catch (err) {
      // Stringify HERE: an Error instance does not survive the hop to JS, and
      // a non-Error throw (Hermes can surface one) must not throw in turn.
      let message: string
      try {
        message = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      } catch {
        message = 'unstringifiable throw'
      }
      state.count += 1
      const now = Date.now()
      if (state.count > REPORT_ALWAYS_FIRST && now - state.lastReportAt < REPORT_THROTTLE_MS) return
      state.lastReportAt = now
      runOnJS(reportWorkletError)(scope, message, state.count)
    }
  }
}
