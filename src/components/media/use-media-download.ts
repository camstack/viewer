/**
 * use-media-download — "get this file off the hub and into the operator's
 * hands", once.
 *
 * The recipe (fetch to the cache dir + `Sharing.shareAsync` on native, open the
 * URL on web) was written out three times: the snapshot path, `ExportsScreen`
 * and `ArtifactDetailModal`. They had already drifted — the export copy sent the
 * session Bearer and hardcoded `video/mp4`, the artifact copy sent the artifact
 * plane's headers and the record's own mime. One of them was going to be wrong
 * for the merged gallery, where both kinds of file sit in one list.
 *
 * Returns whether the file was DELIVERED, so the caller can say so: a download
 * that silently did nothing is the failure mode this replaces.
 */
import { useCallback } from 'react'
import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { log } from '../../lib/logger.js'

/** One file to hand over. */
export interface MediaDownloadRequest {
  /** Absolute URL on the hub's data plane. */
  readonly url: string
  /** Cache file name, extension included (`export-e1.mp4`). */
  readonly fileName: string
  /** Mime for the share sheet. */
  readonly mime: string
  /** Auth headers the plane requires, if any. */
  readonly headers?: Record<string, string>
}

/** Deliver one file. `false` means the operator got nothing. */
export type MediaDownloader = (request: MediaDownloadRequest) => Promise<boolean>

export function useMediaDownload(): MediaDownloader {
  return useCallback(async ({ url, fileName, mime, headers }: MediaDownloadRequest): Promise<boolean> => {
    if (Platform.OS === 'web') {
      try {
        window.open(url, '_blank')
        return true
      } catch (e) {
        log.warn('media-download', 'web download open failed', {
          error: e instanceof Error ? e.message : String(e),
        })
        return false
      }
    }
    try {
      const target = `${FileSystem.cacheDirectory}${fileName}`
      const { uri } = await FileSystem.downloadAsync(url, target, { headers: headers ?? {} })
      // No share sheet on this platform is not a failure — the bytes are on the
      // device either way, and reporting it as one would send the operator back
      // to repeat a download that worked.
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: mime })
      return true
    } catch (e) {
      log.warn('media-download', 'download failed', {
        error: e instanceof Error ? e.message : String(e),
      })
      return false
    }
  }, [])
}
