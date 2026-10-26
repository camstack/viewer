/**
 * TrackCropImage — the representative CROP for a track (its best detection),
 * resolved by `bestEventId` via `useEventMedia(..., 'crop')`. Falls back to a
 * class-tinted icon when no crop exists. Reuses the exact media DNA of the rest
 * of the events UI (CropTile / EventCard): the base-64 `data:` fast-path plus the
 * bearer-header path for a direct `mediaUrl`.
 *
 * Fills its parent (absolute) — the caller sizes the frame and picks `contentFit`.
 */
import React, { memo } from 'react'
import { View, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { useServer } from '../../../app/ServerProvider.js'
import { useEventMedia, type MediaAddress } from '../../../data/use-event-media.js'
import { SkeletonBox } from '../../ui/SkeletonBox.js'
import { useKindPaint } from '../../../../shared/palette.js'
import { iconForClass } from './track-icons.js'

export interface TrackCropImageProps {
  /** The event id to resolve the crop against (a track's bestEventId, or a
   *  scored-result thumbId). */
  readonly eventId: string
  /** Owning device — the authorization subject of the base64 media fallback. */
  readonly deviceId: number
  readonly className: string
  /** Optional direct media URL fast-path (bearer-authed). */
  readonly mediaUrl?: string
  readonly contentFit?: 'cover' | 'contain'
  readonly iconSize?: number
  /** Square thumbnail edge (px) requested from the server. The list/reel tiles
   *  are small squares, so we pull a tiny server-cropped square (~6 KB) instead
   *  of the full 640×360 crop (~34 KB). Default 192 (retina-crisp on tiles). */
  readonly thumbSize?: number
}

export const TrackCropImage = memo(function TrackCropImage({
  eventId,
  deviceId,
  className,
  mediaUrl,
  contentFit = 'cover',
  iconSize = 34,
  thumbSize = 192,
}: TrackCropImageProps) {
  const { token } = useServer()
  // `directDefaultKind` omits `?kind=crop` so the server's DEFAULT resolver
  // serves the SUBJECT crop — a per-event `crop`, else the track's native
  // `thumbnail` (the reel representative). Forcing `?kind=crop` wrongly skips the
  // track thumbnail for the ~70% of tiles whose id is a track id. `preferKind`
  // still biases the base64 <Image onError> fallback toward a clean crop.
  //
  // No importer reaches this component. Kept type-correct for a green build:
  // `eventId` is treated as a track owner id (D482), the address every live
  // crop tile resolves against.
  const address: MediaAddress | null =
    eventId.length > 0 ? { kind: 'owner', ownerType: 'track', ownerId: eventId } : null
  const { uri, isData, failed, onError } = useEventMedia(address, mediaUrl, 'crop', {
    variant: 'thumb',
    size: thumbSize,
    directDefaultKind: true,
    deviceId,
  })
  const paint = useKindPaint()
  const accent = paint(className)
  const Icon = iconForClass(className)
  const headers: Record<string, string> | undefined =
    token && uri && !isData ? { Authorization: `Bearer ${token}` } : undefined

  if (failed) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: accent + '1A' }]}>
        <Icon size={iconSize} color={accent} />
      </View>
    )
  }
  // Media URL still resolving → shadow box (never an empty dark hole).
  if (uri === null) {
    return <SkeletonBox />
  }
  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Skeleton UNDER the image: visible until the bytes paint, and — via
          recyclingKey — whenever FlashList reuses this cell for another event
          (without it the recycled cell kept showing the PREVIOUS row's image
          until the new one loaded). */}
      <SkeletonBox />
      <Image
        source={headers ? { uri, headers } : { uri }}
        recyclingKey={eventId}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        cachePolicy="memory-disk"
        transition={100}
        onError={onError}
      />
    </View>
  )
})

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
})
