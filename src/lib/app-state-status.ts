import type { AppStateStatus } from 'react-native'

/**
 * `AppState.currentState` is typed `string | null | undefined` by React
 * Native; the app reasons over the closed `AppStateStatus` set. Anything the
 * platform does not name is `unknown`, which no caller treats as foreground.
 */
export function toAppStateStatus(state: string | null | undefined): AppStateStatus {
  return state === 'active' || state === 'inactive' || state === 'background' || state === 'extension'
    ? state
    : 'unknown'
}
