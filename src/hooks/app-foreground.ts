/**
 * "Can anybody see this app right now?" — the one place that question is
 * answered from an `AppState` status.
 *
 * ## Why it is a module and not three characters inside a hook
 *
 * The app asks this in four places and got it right in three of them. React
 * Query's focus manager (`src/app/query-focus.ts`), the resume reconciler
 * (`src/data/resume-reconcile.ts`) and the phase tracer
 * (`src/connection/AppPhaseTracer.tsx`) all handle `inactive` explicitly and
 * document why. `useAppForeground` did not: it asked `status === 'active'`, and
 * that single comparison produced both snapshot faults reported on 2026-08-18.
 *
 * ## What the platform actually reports
 *
 * `RCTAppState.mm` maps `UIApplicationWillResignActiveNotification` to
 * `inactive`, and that notification is raised by a notification-shade pull, a
 * Control Centre swipe, the app switcher and an incoming call. **None of them
 * is a backgrounding** — the app stays on screen, the operator keeps looking at
 * it, and the process keeps running. Treating `inactive` as hidden is the
 * classic iOS mistake, and here it blanked every camera tile for as long as the
 * shade was down.
 *
 * The same module reads its `initialAppState` from
 * `UIApplication.applicationState` at bridge setup — which during launch is
 * `inactive` (or `unknown`, its documented fallback), because
 * `applicationDidBecomeActive:` has not run yet. `AppState.currentState` is
 * additionally `null` until those native constants are read. A surface whose
 * FIRST render asks `=== 'active'` therefore starts disabled on a cold start
 * and stays disabled until an AppState *change* event arrives — so the snapshot
 * demand that mints the tiles' links was registered late on every app open.
 *
 * ## The rule
 *
 * Stated as an exclusion. Only `background` — and `extension`, where this
 * process is not drawing the app at all — mean nobody is looking. Everything
 * else does, including statuses that do not exist yet: an unrecognised status
 * must degrade to "keep working", never to "go dark", because the cost of the
 * two is not symmetric. A wrong `true` costs a few polls nobody reads; a wrong
 * `false` empties the screen the operator is holding.
 *
 * Pure and react-native-free, so it is unit-tested by value rather than
 * asserted on with a source guard.
 */

/** Every status React Native's `AppStateStatus` union can carry. */
export const APP_STATE_STATUSES = [
  'active',
  'inactive',
  'unknown',
  'background',
  'extension',
] as const

export type AppForegroundStatus = (typeof APP_STATE_STATUSES)[number]

/** Statuses in which the app is NOT on screen. The whole rule. */
const HIDDEN_STATUSES: readonly string[] = ['background', 'extension']

/**
 * True while the app is on screen — including the iOS `inactive` limbo and the
 * pre-`active` launch window.
 *
 * Accepts `null`/`undefined` because `AppState.currentState` is typed `?string`
 * and really is null before the native constants land.
 */
export function isAppForeground(status: string | null | undefined): boolean {
  if (status === null || status === undefined) return true
  return !HIDDEN_STATUSES.includes(status)
}
