/**
 * Load a native-backed module only when the installed binary has it.
 *
 * A module that calls `requireNativeModule` at import throws at app launch on
 * a binary built without it. An OTA can reach such a binary only by mistake
 * (the ship script refuses it), but the cost of that mistake is a crash on
 * every start, so everything this feature adds natively is reached through here.
 */
export function optionalModule<T>(load: () => T): T | null {
  try {
    return load()
  } catch {
    return null
  }
}
