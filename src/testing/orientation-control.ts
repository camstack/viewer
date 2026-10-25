/**
 * The recorded `expo-screen-orientation`, kept OUT of the native stub.
 *
 * `ScreenOrientation.lockAsync` is APP-WIDE: it is the one native call in this
 * app whose effect outlives the component that made it, which is exactly why a
 * grid could strand the theater in portrait. A claim about that can only be
 * proven by looking at the CALLS — "did the screen that imposed the lock
 * release it, and did the screen underneath re-assert its own?" is a question
 * about a sequence, not about rendered output.
 *
 * Same split as `app-state-control.ts`: the controls are a plain fully-typed
 * module (a spec may import it), the stub beside `react-native-web` is only the
 * adapter (a spec importing THAT drags an untyped dependency into `tsc`).
 */

/** Every orientation call this app makes, in the order it made them. */
export type OrientationCall =
  | { readonly kind: 'lock'; readonly lock: number }
  | { readonly kind: 'unlock' }

let calls: OrientationCall[] = []

export function orientationCalls(): readonly OrientationCall[] {
  return calls
}

export function resetOrientationCalls(): void {
  calls = []
}

/** Called by the `expo-screen-orientation` stub, once per call. */
export function recordOrientationCall(call: OrientationCall): void {
  calls.push(call)
}
