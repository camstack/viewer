/**
 * ArtifactCard — one artifact in the Library's gallery, drawn as the shared
 * `LibraryTile` (2026-10-21; it was a full-width row of its own): the picture,
 * when it was captured and the camera on it, the kind on its corner, and the
 * row's title with the delete action.
 *
 * `image` / `gif` artifacts render THEMSELVES; a `video` renders its
 * `posterArtifactId` companion still (`resolveArtifactThumb`). When neither
 * exists, or the fetch fails, the tile is the placeholder with the kind glyph —
 * never a grey box that reads as "still loading" forever. The data plane is
 * AUTHENTICATED: `headers` carries the Bearer, attached to every URL source.
 *
 * Everything textual comes from `nc-artifact-format.ts` through the injected
 * `t` — this component holds no literal a user reads. Which buttons it draws is
 * NOT decided here: `libraryItemActions` answers that for both halves of the
 * gallery (D62), exactly as `ExportCard` asks it. The delete confirm and the
 * mutation belong to the screen that owns the list.
 */
import React, { memo, useMemo } from 'react'
import { Play, Trash2 } from '../../lib/icons.js'
import { Badge } from '../ui/Badge.js'
import { LibraryTile, type LibraryTileAction } from '../ui/LibraryTile.js'
import { formatBytes, type Translate } from '../../data/export-format.js'
import type { ArtifactThumbSource, NcArtifactRecord } from '../../data/nc-artifacts.js'
import {
  artifactCameraLabel,
  artifactKindLabel,
  artifactTitle,
  capturedLabel,
  isArtifactExpired,
  type NamedCamera,
} from '../../data/nc-artifact-format.js'
import { artifactItem, libraryItemActions } from '../../screens/artifacts/library-items.js'
import { artifactKindIcon } from './artifact-kind-icons.js'

export interface ArtifactCardProps {
  readonly record: NcArtifactRecord
  /** Fixed tile width (pt) from the Library column rule. */
  readonly width: number
  readonly thumb: ArtifactThumbSource
  readonly headers: Record<string, string> | undefined
  readonly cameras: readonly NamedCamera[]
  readonly nowMs: number
  readonly t: Translate
  readonly onPress: () => void
  readonly onDelete: () => void
}

export const ArtifactCard = memo(function ArtifactCard({
  record,
  width,
  thumb,
  headers,
  cameras,
  nowMs,
  t,
  onPress,
  onDelete,
}: ArtifactCardProps) {
  const expired = isArtifactExpired(record, nowMs)
  const actions = libraryItemActions(artifactItem(record), nowMs)
  const thumbUrl = thumb.kind === 'image' ? thumb.url : null
  // One source object per (url, headers): a new object per render blanks the image.
  const source = useMemo(
    () => (thumbUrl === null ? null : headers === undefined ? { uri: thumbUrl } : { uri: thumbUrl, headers }),
    [thumbUrl, headers],
  )
  const title = artifactTitle(record, t)
  const camera = artifactCameraLabel(record, cameras, t)
  const when = capturedLabel(record.capturedAt, nowMs, t)
  const tileActions: readonly LibraryTileAction[] = actions.delete
    ? [{ id: 'delete', icon: Trash2, label: t('v2.artifacts.deleteAction'), tone: 'muted', onPress: onDelete }]
    : []

  return (
    <LibraryTile
      width={width}
      source={source}
      placeholderIcon={artifactKindIcon(record.kind)}
      when={when}
      where={camera}
      imageBadges={
        // A play glyph on a video's kind: the poster is a still, and nothing
        // else on the tile says the bytes move.
        record.mediaType === 'video' ? (
          <Badge label={artifactKindLabel(record.kind, t)} size="sm" renderIcon={(color, size) => <Play size={size} color={color} />} />
        ) : (
          <Badge label={artifactKindLabel(record.kind, t)} size="sm" />
        )
      }
      title={title}
      actions={tileActions}
      faded={expired}
      onPress={onPress}
      accessibilityLabel={`${title} · ${camera} · ${when} · ${formatBytes(record.sizeBytes)}`}
      testID={`artifact-tile-${record.id}`}
    />
  )
})
