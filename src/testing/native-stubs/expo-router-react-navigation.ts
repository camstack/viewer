/**
 * `expo-router/react-navigation` re-exports React Navigation, whose sources
 * do not parse under vitest. A mount reaches it through a screen that guards
 * leaving with an unsaved draft (`usePreventRemove`) — the Notification
 * Center's Alarm section mounts one inside a TAB. No navigator exists here, so
 * the guard is inert; a spec that needs to drive it `vi.mock`s this module.
 */
export function usePreventRemove(_enabled: boolean, _callback: (event: unknown) => void): void {
  // Nothing can be removed without a navigator.
}
