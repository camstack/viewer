/**
 * The simulated `Platform.OS`, kept OUT of the react-native stub — same
 * reasoning as `app-state-control.ts`, and the same shape.
 *
 * react-native-web hard-codes `OS: 'web'`, so `native-stubs/react-native.tsx`
 * replaces `Platform` to let a mount test pick the branch the phone takes. That
 * stub imports `react-native-web`, which ships no types: anything the
 * type-checked graph reaches THROUGH it becomes a `ts-check` failure
 * (`TS7016`). A spec needs the CONTROL, not the stub — so the control is a
 * plain, fully-typed module and the stub is only the adapter.
 *
 * The harness default is `ios`, because that is the platform the operator runs
 * and the one whose branches are worth exercising by default. Set `web` when
 * the claim under test is about the browser or the PWA — the confirmation
 * dialog is one (`Alert.alert` is an empty function there).
 */
export type TestPlatformOS = 'ios' | 'android' | 'web'

let currentOS: TestPlatformOS = 'ios'

export function currentTestPlatform(): TestPlatformOS {
  return currentOS
}

/**
 * Pick the platform branch for the specs in this file. Vitest isolates each
 * spec file into its own module graph, so this never leaks between files —
 * but it DOES persist between the `it`s of one file, so restore it in
 * `afterEach` when only some of them want a non-default platform.
 */
export function setTestPlatform(os: TestPlatformOS): void {
  currentOS = os
}
