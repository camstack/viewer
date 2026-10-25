/**
 * TrackMediaGallery — the hero of the cluster detail: ALL media for the selected
 * track in one horizontally-scrollable, time-ordered strip, with the active image
 * shown large and zoomable (pinch on mobile, wheel / double-click on web).
 *
 * Item kinds (see {@link GalleryItem}):
 *   • 'scene' — a full inference frame, rendered via {@link DetailFrameView} so
 *     the per-object bounding boxes overlay it (and scale with the zoom).
 *   • 'media' — a stand-alone `listTrackMedia` file (crop / snapshot / bestFrame /
 *     …), rendered as a plain contained image over HTTP.
 *
 * A missing image never breaks the strip: scene frames fall back to their own
 * ImageOff placeholder, media tiles to a placeholder tile.
 */

import React, { memo, useCallback } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { ImageOff } from '../../../../lib/icons.js'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../../theme/theme-provider.js'
import { useServer } from '../../../../app/ServerProvider.js'
import { useConnection } from '../../../../connection/ConnectionProvider.js'
import { RADIUS, SPACING } from '../../../../theme/tokens.js'
import { mediaFileUri, mediaImageSource } from '../../../../data/track-media-uri.js'
import { DetailFrameView } from './DetailFrameView.js'
import { CropTile } from './CropTile.js'
import { ZoomableImage } from './ZoomableImage.js'
import type { GalleryItem } from './track-media.js'
import type { DetailFrame } from './cluster-detail.js'

const THUMB = 54

export interface TrackMediaGalleryProps {
  /** Owning device — the authorization subject of every media fallback. */
  readonly deviceId: number
  readonly items: readonly GalleryItem[]
  /** Scene frames keyed by their `key`, for 'scene' items. */
  readonly sceneByKey: ReadonlyMap<string, DetailFrame>
  readonly activeIndex: number
  readonly onActiveIndexChange: (index: number) => void
  readonly width: number
  readonly height: number
  /** Draw bounding boxes over scene frames. Default true; the detail's "show
   *  bounding box" checkbox passes false for the clean full-frame view. */
  readonly showBoxes?: boolean
}

/** A stand-alone HTTP media image, contained, with an error placeholder. */
const MediaHero = memo(function MediaHero({
  uri, headers, width, height, recyclingKey,
}: {
  readonly uri: string
  readonly headers: Record<string, string> | undefined
  readonly width: number
  readonly height: number
  readonly recyclingKey: string
}) {
  const { colors } = useTheme()
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => setFailed(false), [uri])
  if (failed) {
    return (
      <View style={[{ width, height }, styles.center, styles.heroBg]}>
        <ImageOff size={40} color={colors.foregroundSubtle} />
      </View>
    )
  }
  return (
    <Image
      source={mediaImageSource(uri, headers)}
      style={{ width, height }}
      contentFit="contain"
      cachePolicy="memory-disk"
      allowDownscaling
      recyclingKey={recyclingKey}
      onError={() => setFailed(true)}
    />
  )
})

/** A media strip tile, own failed state → placeholder, selectable. */
const MediaThumb = memo(function MediaThumb({
  uri, headers, selected, onPress,
}: {
  readonly uri: string
  readonly headers: Record<string, string> | undefined
  readonly selected: boolean
  readonly onPress: () => void
}) {
  const { colors } = useTheme()
  const [failed, setFailed] = React.useState(false)
  const border = { borderColor: selected ? colors.primary : colors.border, borderWidth: selected ? 2 : StyleSheet.hairlineWidth }
  return (
    <Pressable onPress={onPress} hitSlop={4} style={[styles.thumb, border, { backgroundColor: colors.surface }]}>
      {failed ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <ImageOff size={18} color={colors.foregroundSubtle} />
        </View>
      ) : (
        <Image
          source={mediaImageSource(uri, headers)}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          onError={() => setFailed(true)}
        />
      )}
    </Pressable>
  )
})

export const TrackMediaGallery = memo(function TrackMediaGallery({
  deviceId, items, sceneByKey, activeIndex, onActiveIndexChange, width, height, showBoxes = true,
}: TrackMediaGalleryProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const { token } = useServer()
  const { controller, state } = useConnection()
  const serverUrl = state === 'connected' ? (controller.getSystem()?.serverUrl ?? null) : null
  const headers: Record<string, string> | undefined = token
    ? { Authorization: `Bearer ${token}` }
    : undefined

  const active = items[activeIndex]
  const activeScene = active?.kind === 'scene' ? sceneByKey.get(active.sceneKey) : undefined
  const activeMediaUri =
    active?.kind === 'media'
      ? mediaFileUri({ url: active.mediaKey, kind: active.mediaKind, timestamp: active.timestamp }, serverUrl)
      : null

  const renderThumb = useCallback(
    (item: GalleryItem, index: number) => {
      const selected = index === activeIndex
      const onPress = (): void => onActiveIndexChange(index)
      if (item.kind === 'media') {
        const uri = mediaFileUri(
          { url: item.mediaKey, kind: item.mediaKind, timestamp: item.timestamp },
          serverUrl,
          { thumbSize: THUMB * 2 },
        )
        return (
          <MediaThumb
            key={item.id}
            uri={uri ?? ''}
            headers={headers}
            selected={selected}
            onPress={onPress}
          />
        )
      }
      const frame = sceneByKey.get(item.sceneKey)
      const first = frame?.detections[0]
      return (
        <CropTile
          key={item.id}
          eventId={frame?.imageDetectionId ?? item.sceneKey}
          deviceId={deviceId}
          mediaUrl={frame?.imageMediaUrl}
          className={first?.className ?? 'object'}
          size={THUMB}
          selected={selected}
          onPress={onPress}
        />
      )
    },
    [activeIndex, onActiveIndexChange, sceneByKey, serverUrl, headers],
  )

  return (
    <View>
      {/* Hero — zoomable. Scene → full frame + bbox overlay; media → contained image. */}
      <View style={[styles.hero, { height, backgroundColor: '#000' }]}>
        {width > 0 && active ? (
          <ZoomableImage width={width} height={height} resetKey={active.id}>
            {active.kind === 'scene' && activeScene ? (
              <DetailFrameView frame={activeScene} deviceId={deviceId} width={width} height={height} showBoxes={showBoxes} />
            ) : active.kind === 'media' && activeMediaUri !== null ? (
              <MediaHero uri={activeMediaUri} headers={headers} width={width} height={height} recyclingKey={active.id} />
            ) : (
              <View style={[{ width, height }, styles.center]}>
                <ImageOff size={40} color={colors.foregroundSubtle} />
              </View>
            )}
          </ZoomableImage>
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <Text style={{ color: colors.foregroundMuted }}>{t('v2.theater.detailEmpty')}</Text>
          </View>
        )}
      </View>

      {/* Position counter. */}
      {items.length > 1 ? (
        <Text style={[styles.counter, { color: colors.foregroundMuted }]}>
          {activeIndex + 1}/{items.length}
        </Text>
      ) : null}

      {/* Unified media strip. */}
      {items.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {items.map((item, index) => renderThumb(item, index))}
        </ScrollView>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  hero: { borderRadius: RADIUS.md, overflow: 'hidden', marginTop: SPACING.xs },
  heroBg: { backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  counter: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
  },
  strip: { gap: SPACING.sm, paddingVertical: SPACING.sm, paddingRight: SPACING.md },
})
