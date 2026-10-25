/**
 * save-snapshot — put a captured frame where an Activity item can point at it.
 *
 * Native: a JPEG in the app cache dir (`expo-file-system`, lazy). Web: a blob
 * URL, which lives as long as the page — `parseActivity` drops those on the
 * next load rather than keep a dead pointer.
 */
import { Platform } from 'react-native'

export interface SavedSnapshot {
  readonly uri: string
  readonly mime: string
  readonly fileName: string
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** Resolves to where the frame now lives, or `null` when it could not be kept. */
export async function saveSnapshot(
  base64Jpeg: string,
  fileStem: string,
): Promise<SavedSnapshot | null> {
  const mime = 'image/jpeg'
  const fileName = `${fileStem}.jpg`
  try {
    if (Platform.OS === 'web') {
      return { uri: URL.createObjectURL(base64ToBlob(base64Jpeg, mime)), mime, fileName }
    }
    const FileSystem = await import('expo-file-system/legacy')
    const uri = `${FileSystem.cacheDirectory}${fileName}`
    await FileSystem.writeAsStringAsync(uri, base64Jpeg, {
      encoding: FileSystem.EncodingType.Base64,
    })
    return { uri, mime, fileName }
  } catch {
    return null
  }
}
