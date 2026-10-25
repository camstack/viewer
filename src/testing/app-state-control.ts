/**
 * The simulated `AppState`, kept OUT of the react-native stub.
 *
 * react-native-web derives `AppState` from the Page Visibility API, so it can
 * only ever report `active` or `background`. The two statuses that matter on a
 * phone are the two it cannot produce:
 *
 *  - **`inactive`** — `RCTAppState` maps
 *    `UIApplicationWillResignActiveNotification` to it, and a notification-shade
 *    pull, a Control Centre swipe, an app-switcher peek and an incoming call all
 *    raise that notification. NONE of them is a backgrounding.
 *  - **the launch window** — `initialAppState` is
 *    `UIApplication.applicationState` read at bridge setup, which is `inactive`
 *    (or its `unknown` fallback) until `applicationDidBecomeActive:` runs.
 *
 * The state lives here rather than in `native-stubs/react-native.tsx` for a
 * mechanical reason: that file imports `react-native-web`, which ships no
 * types, and anything the type-checked graph reaches through it turns into a
 * `ts-check` failure. A spec and `mount.tsx` need the CONTROLS, not the stub —
 * so the controls are a plain, fully-typed module and the stub is the adapter.
 */

/** Every status React Native's `AppStateStatus` union can carry. */
export type TestAppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension'

export type TestAppStateHandler = (status: TestAppStateStatus) => void

let status: TestAppStateStatus = 'active'
const handlers = new Set<TestAppStateHandler>()

/** What `AppState.currentState` reports. */
export function currentTestAppState(): TestAppStateStatus {
  return status
}

/** Wire one `AppState.addEventListener('change', …)`; returns the remover. */
export function subscribeTestAppState(handler: TestAppStateHandler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

/**
 * The status a freshly-mounted tree observes. Emits NO transition — this is
 * "what the OS already was", not "what it just became", which is precisely the
 * launch-window case a change event cannot reproduce.
 */
export function setTestAppState(next: TestAppStateStatus): void {
  status = next
}

/**
 * Drive a transition the way `RCTAppState` does: move `currentState` first,
 * then notify. Wrap the call in `act()`.
 */
export function emitAppState(next: TestAppStateStatus): void {
  status = next
  for (const handler of [...handlers]) handler(next)
}
