/**
 * One corpus frame tile — the frame's `thumbnailUrl` over the authed data plane;
 * the deprecated base64 `getRetrainFrameImage` only when the hub sent no URL.
 *
 * Drawn as the shared `LibraryTile` (2026-10-21): when and the camera on the
 * image, the review chips on its corner, and the row says where the frame came
 * from (a track or a recording) and how many collections hold it.
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { RetrainFrame } from '@camstack/types'
import { useServer } from '../../app/ServerProvider.js'
import { useConnection } from '../../connection/ConnectionProvider.js'
import { hubImageSource } from '../../components/camera/theater/hub-image-source.js'
import { Badge } from '../../components/ui/Badge.js'
import { LibraryTile } from '../../components/ui/LibraryTile.js'
import { RetrainFrameChips } from './RetrainFrameChips.js'
import { useDateLocale } from '../../lib/date-locale.js'
import { frameDateLabel, frameTimeOf } from '../../retrain/corpus-list.js'
import { useRetrainFrameImage } from '../../data/use-retrain.js'

function absoluteUrl(serverUrl: string | null, url: string): string {
  if (/^(https?:|data:)/.test(url) || serverUrl === null || serverUrl === '') return url
  const base = serverUrl.replace(/\/+$/, '')
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`
}

interface RetrainFrameThumbProps {
  readonly frame: RetrainFrame
  /** Fixed tile width (pt) from the Library column rule. */
  readonly width: number
  readonly selected: boolean
  /** Some frame is selected: a tap toggles instead of opening. */
  readonly selectionMode: boolean
  readonly cameraName: string
  readonly onPress: () => void
  readonly onLongPress: () => void
}

export function RetrainFrameThumb({
  frame,
  width,
  selected,
  selectionMode,
  cameraName,
  onPress,
  onLongPress,
}: RetrainFrameThumbProps) {
  const { t } = useTranslation()
  const locale = useDateLocale()
  const captured = frameTimeOf(frame)
  const when = useMemo(
    () =>
      frameDateLabel(captured, Date.now(), locale, {
        today: (time) => t('v2.retrain.date.today', { time }),
        yesterday: (time) => t('v2.retrain.date.yesterday', { time }),
      }),
    [captured, locale, t],
  )
  const { token } = useServer()
  const { controller } = useConnection()
  const serverUrl = controller.getSystem()?.serverUrl ?? null
  const thumbUrl = frame.thumbnailUrl
  // Older hub: no URL on the frame, so fall back to the base64 answer.
  const legacy = useRetrainFrameImage(frame.frameId, thumbUrl === undefined)
  const legacyBase64 = legacy.data?.base64
  const source = useMemo(
    () =>
      thumbUrl !== undefined
        ? hubImageSource(absoluteUrl(serverUrl, thumbUrl), token)
        : legacyBase64 !== undefined
          ? { uri: `data:image/jpeg;base64,${legacyBase64}` }
          : null,
    [thumbUrl, serverUrl, token, legacyBase64],
  )
  const collections = frame.collectionIds?.length ?? 0
  const origin = frame.origin === 'recording' ? t('v2.retrain.origin.recording') : t('v2.retrain.origin.track')

  return (
    <LibraryTile
      width={width}
      source={source}
      loading={thumbUrl === undefined && legacy.isPending}
      when={when}
      where={cameraName}
      imageBadges={<RetrainFrameChips review={frame.review} />}
      title={origin}
      titleMuted
      badge={
        collections > 0 ? <Badge label={t('v2.retrain.inCollections', { count: collections })} size="sm" look="tint" /> : undefined
      }
      selectionMode={selectionMode}
      selected={selected}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityLabel={`${cameraName} · ${when}`}
      testID={`retrain-frame-${frame.frameId}`}
    />
  )
}
