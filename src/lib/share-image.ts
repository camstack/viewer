/**
 * share-image — one cross-platform "share this JPEG" for the track-detail media
 * share action. Mirrors the lazy-native-import discipline of {@link copy-text.ts}
 * so the web bundle never pulls the native modules and an OTA landing on a binary
 * that predates them fails SOFT (returns false) instead of crashing the screen.
 *
 * Native (iOS/Android): write the base-64 JPEG to the cache dir and hand it to
 * the OS share sheet (`expo-sharing`).
 * Web: prefer the Web Share API with a File; fall back to a download anchor.
 *
 * Best-effort: resolves `true` on success, `false` on any failure. Never throws.
 */
import { Platform } from 'react-native'

/** Turn a base-64 string into a Blob (web only). */
function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function shareImageWeb(base64: string, filenameBase: string): Promise<boolean> {
  try {
    const blob = base64ToBlob(base64, 'image/jpeg')
    const file = new File([blob], `${filenameBase}.jpg`, { type: 'image/jpeg' })
    const nav = typeof navigator !== 'undefined' ? navigator : undefined
    // Web Share API level 2 (files) — guarded by canShare.
    if (nav?.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file] })
      return true
    }
    // Fallback: trigger a download.
    if (typeof document !== 'undefined' && typeof URL !== 'undefined') {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${filenameBase}.jpg`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      return true
    }
    return false
  } catch {
    return false
  }
}

async function shareImageNative(base64: string, filenameBase: string): Promise<boolean> {
  try {
    // Lazy imports so the web bundle never resolves the native modules and an OTA
    // onto a binary without them catches here instead of crashing at module eval.
    const FileSystem = await import('expo-file-system/legacy')
    const Sharing = await import('expo-sharing')
    if (!(await Sharing.isAvailableAsync())) return false
    const uri = `${FileSystem.cacheDirectory}${filenameBase}.jpg`
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 })
    await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', UTI: 'public.jpeg' })
    return true
  } catch {
    return false
  }
}

/**
 * Share a base-64 JPEG via the OS share sheet (native) or the Web Share API /
 * download (web). `filenameBase` is the basename WITHOUT extension. Never throws.
 */
export async function shareImageBase64(
  base64: string | null | undefined,
  filenameBase: string,
): Promise<boolean> {
  if (typeof base64 !== 'string' || base64.length === 0) return false
  return Platform.OS === 'web'
    ? shareImageWeb(base64, filenameBase)
    : shareImageNative(base64, filenameBase)
}
