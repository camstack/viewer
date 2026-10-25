/**
 * Teach React Query when this app is actually in front of the operator.
 *
 * ── The bug this closes ───────────────────────────────────────────────────
 * `refetchInterval` does not run while a query is considered unfocused, and
 * `refetchOnWindowFocus` is off for the whole app (RN has no window focus, so
 * the default listener — `document.visibilitychange` — is either absent or
 * wrong). With neither signal wired, a list that reconciles "every 5 minutes"
 * reconciles only while the app happens to be foregrounded AND React Query
 * happens to believe it.
 *
 * Measured 2026-08-11: nine Terminal cameras were deleted on the hub and the
 * Cameras tab kept listing them long afterwards. `deviceManager.listAll`
 * answered in 0.2 s and returned none of them; pull-to-refresh cleared the list
 * instantly — because `refetch()` bypasses both `enabled` and the focus gate.
 * The data layer was never wrong; it was never asked.
 *
 * `AppState` is the RN-native answer to "is the user looking at this", so the
 * focus manager is driven from it directly. On web, `AppState` reports
 * `active` / `background` off the Page Visibility API, so the same wiring
 * covers the PWA.
 */
import { AppState, type AppStateStatus } from 'react-native'
import { focusManager } from '@tanstack/react-query'

/**
 * Bind React Query's focus manager to `AppState`. Returns the unsubscribe.
 *
 * Idempotent enough to call once at module scope from the provider tree: the
 * subscription is cheap and the focus value is derived, never accumulated.
 */
export function bindQueryFocusToAppState(): () => void {
  const apply = (status: AppStateStatus): void => {
    // `inactive` is the iOS multitasking-switcher / incoming-call limbo. It is
    // NOT background — treating it as unfocused would pause every interval
    // during a notification-shade pull and resume it a moment later, which is
    // churn without a reader.
    focusManager.setFocused(status === 'active' || status === 'inactive')
  }
  apply(AppState.currentState)
  const subscription = AppState.addEventListener('change', apply)
  return () => {
    subscription.remove()
  }
}
