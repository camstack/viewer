/**
 * use-activity-collect — Download / Share for an Activity item.
 *
 * A snapshot is a local file: both go straight to `share-file`. An export is a
 * file on the hub: its download URL is RESOLVED (the cap picks the node that
 * holds it), then fetched with the session Bearer — the same recipe the Library
 * detail uses — and handed over.
 */
import { useCallback, useMemo } from 'react'
import { Platform } from 'react-native'

import { useServer } from '../app/ServerProvider.js'
import { useMediaDownload } from '../components/media/use-media-download.js'
import { useResolveDownloadUrl } from '../data/use-exports.js'
import { saveFile, shareFile } from '../lib/share-file.js'
import type { ActivityItem } from './activity-model.js'

export interface ActivityCollect {
  /** Both resolve `true` when the file reached the operator. */
  readonly download: (item: ActivityItem) => Promise<boolean>
  readonly share: (item: ActivityItem) => Promise<boolean>
}

export function useActivityCollect(): ActivityCollect {
  const { token } = useServer()
  const resolveDownloadUrl = useResolveDownloadUrl()
  const downloadMedia = useMediaDownload()

  const headers = useMemo<Record<string, string> | undefined>(
    () => (token === null ? undefined : { Authorization: `Bearer ${token}` }),
    [token],
  )

  const downloadExport = useCallback(
    async (exportId: string): Promise<boolean> => {
      const url = await resolveDownloadUrl(exportId)
      if (url === null) return false
      return downloadMedia({
        url,
        fileName: `export-${exportId}.mp4`,
        mime: 'video/mp4',
        ...(headers === undefined ? {} : { headers }),
      })
    },
    [downloadMedia, headers, resolveDownloadUrl],
  )

  // Native: the downloader already ends in the share sheet, so sharing IS
  // downloading there. On the web the downloader opens the URL; sharing needs
  // the bytes (the session Bearer cannot ride a share), so they are fetched
  // first and offered to the browser's share sheet as a file.
  const shareExport = useCallback(
    async (exportId: string): Promise<boolean> => {
      if (Platform.OS !== 'web') return downloadExport(exportId)
      const url = await resolveDownloadUrl(exportId)
      if (url === null) return false
      try {
        const response = await fetch(url, { ...(headers === undefined ? {} : { headers }) })
        if (!response.ok) return false
        const uri = URL.createObjectURL(await response.blob())
        return await shareFile({ uri, mime: 'video/mp4', fileName: `export-${exportId}.mp4` })
      } catch {
        return false
      }
    },
    [downloadExport, headers, resolveDownloadUrl],
  )

  const download = useCallback(
    async (item: ActivityItem): Promise<boolean> => {
      if (item.kind === 'job') return false
      if (item.kind === 'export') return downloadExport(item.exportId)
      return saveFile({ uri: item.fileUri, mime: item.mime, fileName: `snapshot-${item.createdAt}.jpg` })
    },
    [downloadExport],
  )

  const share = useCallback(
    async (item: ActivityItem): Promise<boolean> => {
      if (item.kind === 'job') return false
      if (item.kind === 'export') return shareExport(item.exportId)
      return shareFile({ uri: item.fileUri, mime: item.mime, fileName: `snapshot-${item.createdAt}.jpg` })
    },
    [shareExport],
  )

  return useMemo(() => ({ download, share }), [download, share])
}
