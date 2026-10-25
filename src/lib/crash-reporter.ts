/**
 * crash-reporter — make the next crash diagnosable.
 *
 * `crash-record.ts` states the problem and owns the rules; `exit-marker.ts`
 * owns the storage. This file wires the three things that were missing on
 * 2026-08-20, when the app restarted itself four times in an hour and the hub
 * logs could not say once whether it had crashed or applied an update:
 *
 *  1. **A global JS handler.** `ErrorUtils.setGlobalHandler` is React Native's
 *     last stop before a fatal reaches the native side. Nothing was installed,
 *     so an error that killed the app produced no line anywhere.
 *  2. **An immediate flush.** The shipper batches on a 4 s interval
 *     (`lib/logger.ts`), so the lines describing a crash were still sitting in
 *     the queue when the process died. A fatal now POSTs at once and only then
 *     hands over to whatever was going to kill us.
 *  3. **A marker that outlives the process.** Both of the above need the
 *     runtime to survive long enough to be heard. A marker written to storage
 *     does not, which is the only way an OS memory kill or a NATIVE crash —
 *     the causes most likely behind "it crashes when I open it" — can ever be
 *     reported at all. It arrives one launch late, and that is fine.
 *
 * ## Chaining, not replacing
 *
 * The previous handler is always called. Ours adds evidence; it must not change
 * what the app DOES on a fatal — swallowing it would turn a visible crash into
 * a frozen screen, which is strictly harder to diagnose than the crash.
 */
import { flushLogsNow, log } from './logger.js'
import { describeThrown, classifyPreviousExit, isCrashExit, type ExitKind } from './crash-record.js'
import { getExitMarkerRecorder, type ExitMarkerRecorder } from './exit-marker.js'

/** React Native's `AppState`, declared structurally for the same reason
 *  `ErrorUtilsLike` is: this module must stay loadable in a node test runner. */
export interface AppStateLike {
  readonly currentState: string
  addEventListener: (
    type: 'change',
    handler: (state: string) => void,
  ) => { remove: () => void }
}

/** Scope for every line here — one grep away in Loki. */
export const CRASH_SCOPE = 'crash'

/**
 * Which bundle is running, carried on every crash line.
 *
 * "Since the last OTA it crashes" is the shape these reports always arrive in,
 * and the app publishes several updates a day — so a crash line that does not
 * name the bundle cannot confirm or refute the operator's attribution. On
 * 2026-08-20 the attribution was in fact off by one release: the changes
 * suspected of causing the crash had shipped in v1.0.352, while the named
 * v1.0.353 carried an events-skeleton change that could not produce it.
 */
export interface RunningBundle {
  /** `Constants.expoConfig.version` — the `1.0.x` the operator quotes. */
  readonly version: string | null
  /** `embedded`, `dev`, or the short update id — see `app/version-info.ts`. */
  readonly bundle: string
}

let runningBundle: RunningBundle | null = null

/** Declare the running bundle once at launch. Native reads live at the call
 *  site (`app/running-bundle.ts`) so this module stays node-loadable. */
export function setRunningBundle(next: RunningBundle): void {
  runningBundle = next
}

/** React Native's global error hook. Declared structurally rather than imported:
 *  it is a bare global with no module to import it from, and this module must
 *  stay loadable in the node-env vitest suite where it does not exist. */
export interface ErrorUtilsLike {
  getGlobalHandler?: () => GlobalErrorHandler | undefined
  setGlobalHandler: (handler: GlobalErrorHandler) => void
}

export type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void

function isErrorUtils(value: unknown): value is ErrorUtilsLike {
  if (typeof value !== 'object' || value === null) return false
  const setter: unknown = Reflect.get(value, 'setGlobalHandler')
  return typeof setter === 'function'
}

/** The host's `ErrorUtils`, or null where there is none (web, node, tests). */
export function readErrorUtils(): ErrorUtilsLike | null {
  const value: unknown = Reflect.get(globalThis, 'ErrorUtils')
  return isErrorUtils(value) ? value : null
}

/**
 * Record a fatal and get it off the device.
 *
 * Exported so the root error boundary reports through exactly this path — one
 * shape of crash line, whichever way the error arrived.
 */
export function reportFatal(
  kind: ExitKind,
  thrown: unknown,
  recorder: ExitMarkerRecorder = getExitMarkerRecorder(),
): void {
  const described = describeThrown(thrown)
  log.error(CRASH_SCOPE, `runtime fatal (${kind})`, {
    kind,
    message: described.message,
    stack: described.stack,
    version: runningBundle?.version ?? null,
    bundle: runningBundle?.bundle ?? null,
  })
  void recorder.record(kind, described)
  void flushLogsNow()
}

/** Set once per process: a second install would chain us to ourselves. */
let installed = false

/**
 * Install the global handler. Idempotent, and a no-op where there is no
 * `ErrorUtils` — the marker still covers those hosts.
 */
export function installCrashReporter(
  recorder: ExitMarkerRecorder = getExitMarkerRecorder(),
): boolean {
  if (installed) return false
  const errorUtils = readErrorUtils()
  if (errorUtils === null) return false
  installed = true
  const previous = errorUtils.getGlobalHandler?.()
  errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean): void => {
    // A non-fatal still reaches here (RN reports handled exceptions through the
    // same hook). Both are worth a line; only a fatal claims the marker, so a
    // recoverable error cannot make the next launch report a crash.
    if (isFatal === false) {
      const described = describeThrown(error)
      log.warn(CRASH_SCOPE, 'non-fatal error reached the global handler', {
        message: described.message,
        stack: described.stack,
      })
    } else {
      reportFatal('js-fatal', error, recorder)
    }
    previous?.(error, isFatal)
  })
  return true
}

/**
 * State how the previous runtime ended, then claim the marker for this one.
 *
 * Called once, as early as the app tree mounts. The line ships at `info` (the
 * scope is on the logger's always-ship list) so a normal launch on a normal
 * phone answers the question without the operator turning debug mode on — the
 * report that started this had debug mode OFF.
 */
export async function reportPreviousExit(
  recorder: ExitMarkerRecorder = getExitMarkerRecorder(),
): Promise<void> {
  const marker = await recorder.readPrevious()
  const exit = classifyPreviousExit(marker)
  log.info(CRASH_SCOPE, `previous runtime exit: ${exit}`, {
    exit,
    crash: isCrashExit(exit),
    markedAt: marker?.at ?? null,
    message: marker?.message ?? null,
    stack: marker?.stack ?? null,
    version: runningBundle?.version ?? null,
    bundle: runningBundle?.bundle ?? null,
  })
  await recorder.arm()
}

/**
 * Keep the marker honest about whether the app is in the operator's hands.
 *
 * `arm()` claims the marker as `running` at launch, and until 2026-08-26 nothing
 * ever un-claimed it short of a JS fatal or the OTA gate. So closing the app —
 * the single most common way it stops — left `running` behind, and the next
 * launch reported `vanished`, which `isCrashExit` calls a crash. Fifty-seven of
 * those in seventy-two hours, across twelve versions.
 *
 * The false alarms were the smaller half. The real cost was that a FOREGROUND
 * kill — an OS memory kill during a long scrub, the thing actually being
 * reported — produced exactly the same verdict as swiping the app away, so it
 * could not be isolated from the noise.
 *
 * Two transitions, and the second matters as much as the first: going to
 * background records `backgrounded`, and coming BACK re-arms `running`. Without
 * the re-arm, a session backgrounded once would report `backgrounded` for a kill
 * that happened an hour later with the phone unlocked — trading a false crash
 * for a missed one, which is the worse direction.
 *
 * `inactive` is deliberately NOT treated as background: iOS raises it for the
 * app switcher, a notification banner and a permission sheet, none of which end
 * the runtime. Recording there would let a control-centre swipe mask a real
 * crash seconds later.
 *
 * Best-effort like everything else here: the write is async and the OS does not
 * promise time for it. When it loses, the marker stays `running` and the launch
 * reports `vanished` — the old behaviour, for the shrinking set of closes fast
 * enough to outrun a single AsyncStorage write.
 */
export function bindExitMarkerToAppState(
  appState: AppStateLike,
  recorder: ExitMarkerRecorder = getExitMarkerRecorder(),
): () => void {
  let last: string = appState.currentState
  const sub = appState.addEventListener('change', (next: string): void => {
    // iOS leaves the foreground as active → inactive → background, so the
    // state BEFORE `background` is `inactive` on every real close; only a
    // background → background repeat is not a transition worth recording.
    const wasForeground = last !== 'background'
    last = next
    if (next === 'background' && wasForeground) {
      void recorder.record('backgrounded')
      return
    }
    if (next === 'active') void recorder.arm()
  })
  return (): void => sub.remove()
}
