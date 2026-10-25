/**
 * ExportDetailModal — the export half of the Library's viewer.
 *
 * Exports could not be PLAYED before the merge: `ExportsScreen` offered a
 * download and nothing else, so checking whether an export had caught the right
 * minute meant pulling a file onto the phone and opening it in another app. They
 * are mp4s on the same hub with the same retention shape as an artifact, so they
 * now open in the same `MediaViewerModal`.
 *
 * The URL is RESOLVED, not derived: `recordingExport.getDownloadUrl` picks the
 * endpoint (the file may live on a footage node that is not the hub), which is
 * why the stage waits for an answer instead of guessing a path. A refused answer
 * is reported as a refusal — never as a stage that stays black.
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native'
import { Download, Trash2 } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { useServer } from '../../app/ServerProvider.js'
import { useNotice } from '../ui/confirm.js'
import { log } from '../../lib/logger.js'
import {
  expiryLabel,
  formatBytes,
  rangeLabel,
  stateLabel,
  variantLabel,
  type Translate,
} from '../../data/export-format.js'
import { useResolveDownloadUrl, type ExportRecord } from '../../data/use-exports.js'
import { MediaViewerModal, type ViewerMedia, type ViewerMetaRow } from '../media/MediaViewerModal.js'
import { useMediaDownload } from '../media/use-media-download.js'
import { exportItem, libraryItemActions } from '../../screens/artifacts/library-items.js'

export interface ExportDetailModalProps {
  /** The row the gallery was showing. `null` closes the modal. */
  readonly record: ExportRecord | null
  readonly cameraName: string
  readonly nowMs: number
  readonly t: Translate
  readonly onDelete: (rec: ExportRecord) => void
  readonly onClose: () => void
}

export const ExportDetailModal = memo(function ExportDetailModal(props: ExportDetailModalProps) {
  const { record } = props
  return record !== null ? <ExportDetailBody {...props} record={record} /> : null
})

interface ExportDetailBodyProps extends Omit<ExportDetailModalProps, 'record'> {
  readonly record: ExportRecord
}

function ExportDetailBody({ record, cameraName, nowMs, t, onDelete, onClose }: ExportDetailBodyProps) {
  const { colors } = useTheme()
  const notice = useNotice()
  const resolveDownloadUrl = useResolveDownloadUrl()
  const { token } = useServer()
  // The export plane is authenticated exactly like the artifact one: a URL
  // rendered without the session Bearer comes back 401 and the stage stays
  // black, which is the failure `ExportsScreen`'s download already guarded
  // against and its (absent) player never had to.
  const headers = useMemo<Record<string, string> | undefined>(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  )
  const download = useMediaDownload()
  const actions = libraryItemActions(exportItem(record), nowMs)

  const [url, setUrl] = useState<string | null>(null)
  // `null` is "not asked yet" on `url`, which is also what a REFUSAL looks like.
  // The two must not share a rendering: one is a spinner, the other a sentence.
  const [resolved, setResolved] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [mediaBroken, setMediaBroken] = useState(false)
  const onMediaError = useCallback((): void => setMediaBroken(true), [])

  useEffect(() => {
    if (!actions.playback) {
      setResolved(true)
      return
    }
    let live = true
    void (async () => {
      try {
        const next = await resolveDownloadUrl(record.id)
        if (live) setUrl(next)
      } catch (e) {
        log.warn('exports', 'download url resolve failed', {
          exportId: record.id,
          error: e instanceof Error ? e.message : String(e),
        })
      } finally {
        if (live) setResolved(true)
      }
    })()
    return () => {
      live = false
    }
  }, [record.id, actions.playback, resolveDownloadUrl])

  const media = useMemo<ViewerMedia>(() => {
    if (!actions.playback) {
      return {
        kind: 'unavailable',
        message:
          record.state === 'queued' || record.state === 'rendering'
            ? t('v2.exports.stillRendering')
            : t('v2.exports.noFile'),
        severity: record.state === 'failed' ? 'danger' : 'muted',
      }
    }
    if (!resolved) return { kind: 'unavailable', message: t('v2.common.connecting'), severity: 'muted' }
    if (url === null || mediaBroken) {
      return { kind: 'unavailable', message: t('v2.exports.downloadUnavailable'), severity: 'danger' }
    }
    return { kind: 'video', url, headers }
  }, [actions.playback, record.state, resolved, url, mediaBroken, headers, t])

  const rows = useMemo<readonly ViewerMetaRow[]>(
    () => [
      { key: 'kind', label: t('v2.artifacts.detail.kind'), value: t('v2.artifacts.kind.export') },
      { key: 'camera', label: t('v2.artifacts.detail.cameras'), value: cameraName },
      { key: 'range', label: t('v2.exports.range'), value: rangeLabel(record.fromMs, record.toMs) },
      { key: 'variant', label: t('v2.exports.variant'), value: variantLabel(record.options, t) },
      { key: 'state', label: t('v2.exports.stateLabel'), value: stateLabel(record.state, t) },
      { key: 'size', label: t('v2.artifacts.detail.size'), value: formatBytes(record.fileBytes) },
      {
        key: 'expiry',
        label: t('v2.artifacts.detail.expiry'),
        value:
          record.state === 'deleted'
            ? t('v2.exports.state.deleted')
            : expiryLabel(record.expiresAt, nowMs, t),
      },
      ...(record.error !== null
        ? [{ key: 'error', label: t('v2.common.loadError'), value: record.error }]
        : []),
    ],
    [record, cameraName, nowMs, t],
  )

  const onDownload = useCallback(async (): Promise<void> => {
    if (url === null) {
      notice({ title: t('v2.exports.title'), message: t('v2.exports.downloadUnavailable') })
      return
    }
    setDownloading(true)
    const ok = await download({ url, fileName: `export-${record.id}.mp4`, mime: 'video/mp4', headers })
    setDownloading(false)
    if (!ok) notice({ title: t('v2.exports.title'), message: t('v2.exports.downloadFailed') })
  }, [url, record.id, headers, t, notice, download])

  return (
    <MediaViewerModal
      visible
      title={cameraName}
      media={media}
      metaRows={rows}
      accent={colors.success}
      mediaId={record.id}
      onMediaError={onMediaError}
      closeLabel={t('v2.artifacts.close')}
      onClose={onClose}
      actions={
        <>
          {actions.download ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('v2.exports.downloadAction')}
              onPress={() => void onDownload()}
              hitSlop={8}
              disabled={downloading}
              style={styles.barBtn}
            >
              {downloading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Download size={20} color={colors.primary} />
              )}
            </Pressable>
          ) : null}
          {actions.delete ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('v2.exports.deleteAction')}
              onPress={() => {
                // The confirm and the mutation belong to the screen that owns
                // the list; closing here keeps the viewer from surviving the row
                // it is showing.
                onClose()
                onDelete(record)
              }}
              hitSlop={8}
              style={styles.barBtn}
            >
              <Trash2 size={20} color={colors.danger} />
            </Pressable>
          ) : null}
        </>
      }
    />
  )
}

const styles = StyleSheet.create({
  barBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
})
