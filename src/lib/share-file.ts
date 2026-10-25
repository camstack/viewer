/**
 * share-file — hand a local file (or a web blob URL) to the operator.
 *
 * Native: the OS share sheet (`expo-sharing`), loaded lazily so the web bundle
 * never resolves the native module and an OTA onto an older binary fails SOFT.
 * Web: the Web Share API with the file when the browser can, else a download
 * anchor. Resolves `true` when the file reached the operator, `false` on any
 * failure; never throws.
 */
import { Platform } from 'react-native'

export interface ShareFileRequest {
  /** `file://` URI on native, a `blob:` / `data:` / http URL on the web. */
  readonly uri: string
  readonly mime: string
  /** Name offered to the destination, extension included. */
  readonly fileName: string
}

async function shareWeb({ uri, mime, fileName }: ShareFileRequest, preferSheet: boolean): Promise<boolean> {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined
    if (preferSheet && nav?.share !== undefined) {
      const blob = await (await fetch(uri)).blob()
      const file = new File([blob], fileName, { type: mime })
      if (nav.canShare?.({ files: [file] }) === true) {
        await nav.share({ files: [file] })
        return true
      }
    }
    if (typeof document === 'undefined') return false
    const a = document.createElement('a')
    a.href = uri
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    return true
  } catch {
    return false
  }
}

async function shareNative({ uri, mime }: ShareFileRequest): Promise<boolean> {
  try {
    const Sharing = await import('expo-sharing')
    if (!(await Sharing.isAvailableAsync())) return false
    await Sharing.shareAsync(uri, { mimeType: mime })
    return true
  } catch {
    return false
  }
}

/** The system share sheet (native) / Web Share (web). */
export function shareFile(request: ShareFileRequest): Promise<boolean> {
  return Platform.OS === 'web' ? shareWeb(request, true) : shareNative(request)
}

/** Save to the device: on web a plain download; on native the share sheet is
 *  the platform's save path ("Save to Files" / "Save image"). */
export function saveFile(request: ShareFileRequest): Promise<boolean> {
  return Platform.OS === 'web' ? shareWeb(request, false) : shareNative(request)
}
