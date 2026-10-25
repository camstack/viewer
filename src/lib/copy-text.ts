/**
 * copy-text — one cross-platform "copy to clipboard" used by the metadata copy
 * buttons (event id, plate text, device id, timestamps, …) and the web share
 * path.
 *
 * Native (iOS/Android) uses `expo-clipboard`'s async `setStringAsync`. The old
 * implementation reached for react-native core's `Clipboard`, but that module
 * was extracted from core and, under the New Architecture (`newArchEnabled`),
 * its TurboModule spec resolves via `TurboModuleRegistry.getEnforcing('Clipboard')`
 * — which THROWS when the native module isn't linked, so copy was broken on iOS.
 *
 * `expo-clipboard` is imported LAZILY (dynamic `import()` inside the try): it
 * resolves its native module eagerly at module-eval, so a static import would
 * crash the whole screen's module graph on a binary that predates the dependency
 * (an OTA landing on an older build). Loading it on demand — and only on native
 * — keeps it out of the web bundle and lets a missing native module fail SOFT
 * (the require throws, we catch, we return `false`) instead of crashing.
 *
 * Best-effort: resolves `true` on success, `false` on any failure (callers show
 * a transient "copied" state only on success). Never throws; guards nullish input.
 *
 * NOTE: because `expo-clipboard` is a NATIVE module, this only becomes functional
 * on an installed binary after a NATIVE release (`npm run release:ios:*` /
 * `release:android:*`) that bundles it. A JS-only OTA (`npm run update:*`) ships
 * the safe fall-through but cannot add the native module to an existing binary.
 */
import { Platform } from 'react-native'

export async function copyText(text: string | null | undefined): Promise<boolean> {
  if (text === null || text === undefined) return false
  const value = typeof text === 'string' ? text : String(text)
  try {
    if (Platform.OS === 'web') {
      // Async Clipboard API — undefined on insecure origins / older webviews,
      // so guard and fail soft rather than throw.
      const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
      if (!clip?.writeText) return false
      await clip.writeText(value)
      return true
    }
    // Native: lazy so the web bundle never pulls the native module and an OTA
    // onto a binary without `expo-clipboard` catches here instead of crashing.
    const clipboard = await import('expo-clipboard')
    await clipboard.setStringAsync(value)
    return true
  } catch {
    return false
  }
}
