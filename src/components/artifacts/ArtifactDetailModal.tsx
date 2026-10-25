/**
 * ArtifactDetailModal — the artifact half of the Library's viewer.
 *
 * The CHROME (stage, metadata card, top bar, the black-stage guard) is
 * `MediaViewerModal`; the download recipe is `useMediaDownload`. What is left
 * here is the part that is genuinely about an artifact: which record to trust,
 * what to call it, and what its metadata rows say. The export half
 * (`ExportDetailModal`) is the same shape over the same viewer — one component
 * answers "show me this file" for the whole gallery.
 *
 * The row is RE-READ by id while open (`useNcArtifact`) rather than trusted from
 * the list: the list page may be minutes old and an artifact's whole point is
 * that it EXPIRES — a viewer that plays a 404 because its cached row still says
 * the bytes exist is worse than one that says they are gone.
 */
import React, { memo, useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native'
import { Download, Trash2 } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { useNotice } from '../ui/confirm.js'
import { formatBytes, type Translate } from '../../data/export-format.js'
import type { NcArtifactRecord } from '../../data/nc-artifacts.js'
import { useArtifactMedia, useNcArtifact } from '../../data/use-nc-artifacts.js'
import {
  artifactCameraLabel,
  artifactExpiryLabel,
  artifactFileExtension,
  artifactKindLabel,
  artifactTitle,
  capturedStamp,
  isArtifactExpired,
  type NamedCamera,
} from '../../data/nc-artifact-format.js'
import { artifactItem, libraryItemActions } from '../../screens/artifacts/library-items.js'
import { MediaViewerModal, type ViewerMedia, type ViewerMetaRow } from '../media/MediaViewerModal.js'
import { useMediaDownload } from '../media/use-media-download.js'
import { artifactKindAccent } from './artifact-kind-icons.js'

export interface ArtifactDetailModalProps {
  /** The row the gallery was showing. `null` closes the modal. */
  readonly record: NcArtifactRecord | null
  readonly cameras: readonly NamedCamera[]
  readonly nowMs: number
  readonly t: Translate
  /** Raised with the row on screen. The confirm and the mutation belong to the
   *  screen that owns the list — the same split `ExportDetailModal` uses. */
  readonly onDelete: (record: NcArtifactRecord) => void
  readonly onClose: () => void
}

export const ArtifactDetailModal = memo(function ArtifactDetailModal(props: ArtifactDetailModalProps) {
  const { record, onClose } = props
  return record !== null ? <ArtifactDetailBody {...props} record={record} onClose={onClose} /> : null
})

interface ArtifactDetailBodyProps extends Omit<ArtifactDetailModalProps, 'record'> {
  readonly record: NcArtifactRecord
}

function ArtifactDetailBody({ record, cameras, nowMs, t, onDelete, onClose }: ArtifactDetailBodyProps) {
  const { colors } = useTheme()
  const notice = useNotice()
  const { headers, urlFor } = useArtifactMedia()
  const { data: fresh, isLoading } = useNcArtifact(record.id)
  const download = useMediaDownload()
  const [downloading, setDownloading] = useState(false)
  // The BYTES can 404 while the row is still indexed: retention is bounded by a
  // file count and a byte ceiling as well as by `expiresAt`, so the shelf may
  // have swept the file before its window closed. That is a load error on a
  // perfectly valid record, and it must read as "the file is gone" rather than
  // as a blank stage that looks like a broken app.
  const [mediaBroken, setMediaBroken] = useState(false)
  const onMediaError = useCallback((): void => setMediaBroken(true), [])

  // The hub's answer wins once it lands; until then the list row keeps the
  // screen painted. `null` from the hub means the row is GONE — that is an
  // answer, not a missing one, so it is not folded back onto the stale row.
  const gone = fresh === null && !isLoading
  const current = fresh ?? record
  const url = urlFor(current)
  const expired = isArtifactExpired(current, nowMs)
  const accent = artifactKindAccent(current.kind, colors)
  const actions = libraryItemActions(artifactItem(current), nowMs)

  const rows = useMemo<readonly ViewerMetaRow[]>(
    () => [
      { key: 'kind', label: t('v2.artifacts.detail.kind'), value: artifactKindLabel(current.kind, t) },
      { key: 'cameras', label: t('v2.artifacts.detail.cameras'), value: artifactCameraLabel(current, cameras, t) },
      ...(current.ruleName !== undefined && current.ruleName.length > 0
        ? [{ key: 'rule', label: t('v2.artifacts.detail.rule'), value: current.ruleName }]
        : []),
      { key: 'captured', label: t('v2.artifacts.detail.captured'), value: capturedStamp(current.capturedAt) },
      { key: 'created', label: t('v2.artifacts.detail.created'), value: capturedStamp(current.createdAt) },
      { key: 'size', label: t('v2.artifacts.detail.size'), value: formatBytes(current.sizeBytes) },
      { key: 'mime', label: t('v2.artifacts.detail.format'), value: current.mime },
      {
        key: 'expiry',
        label: t('v2.artifacts.detail.expiry'),
        value: artifactExpiryLabel(current.expiresAt, nowMs, t),
      },
    ],
    [current, cameras, nowMs, t],
  )

  const media = useMemo<ViewerMedia>(() => {
    if (gone) return { kind: 'unavailable', message: t('v2.artifacts.gone'), severity: 'muted' }
    if (url === null) {
      return { kind: 'unavailable', message: t('v2.artifacts.downloadUnavailable'), severity: 'muted' }
    }
    if (expired || mediaBroken) {
      return { kind: 'unavailable', message: t('v2.artifacts.expiredBody'), severity: 'danger' }
    }
    // A GIF is an animated image, so it plays on the image stage exactly as it
    // did before the viewer was shared — `mediaType` is the hub's own answer to
    // "which renderer", and this branch asks nothing else.
    return current.mediaType === 'video'
      ? { kind: 'video', url, headers }
      : { kind: 'image', url, headers }
  }, [gone, url, expired, mediaBroken, current.mediaType, headers, t])

  const onDownload = useCallback(async (): Promise<void> => {
    if (url === null) {
      notice({ title: t('v2.artifacts.title'), message: t('v2.artifacts.downloadUnavailable') })
      return
    }
    setDownloading(true)
    const ok = await download({
      url,
      fileName: `artifact-${current.id}.${artifactFileExtension(current)}`,
      mime: current.mime,
      headers,
    })
    setDownloading(false)
    if (!ok) notice({ title: t('v2.artifacts.title'), message: t('v2.artifacts.downloadFailed') })
  }, [url, headers, current, t, notice, download])

  return (
    <MediaViewerModal
      visible
      title={artifactTitle(current, t)}
      media={media}
      metaRows={rows}
      accent={accent}
      mediaId={current.id}
      onMediaError={onMediaError}
      closeLabel={t('v2.artifacts.close')}
      onClose={onClose}
      footerHint={t('v2.artifacts.retentionHint')}
      actions={
        !gone ? (
          <>
            {actions.download ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('v2.artifacts.downloadAction')}
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
                accessibilityLabel={t('v2.artifacts.deleteAction')}
                onPress={() => {
                  // Close first: the viewer must not survive the row it shows.
                  onClose()
                  onDelete(current)
                }}
                hitSlop={8}
                style={styles.barBtn}
              >
                <Trash2 size={20} color={colors.danger} />
              </Pressable>
            ) : null}
          </>
        ) : null
      }
    />
  )
}

const styles = StyleSheet.create({
  barBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
})
