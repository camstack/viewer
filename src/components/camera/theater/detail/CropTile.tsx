/**
 * CropTile — a small square thumbnail showing ONLY the detection `crop` for an
 * event (via `useEventMedia(..., 'crop')`). Falls back to a class-tinted icon
 * when no crop exists. Supports a selected border and an onPress, so it serves
 * both the track selector chips and the per-scene crop strip.
 *
 * Never throws; all media error paths are handled by `useEventMedia`.
 */

import React, { memo } from 'react'
import { View, Pressable, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { User, Car, Dog, Bird, HelpCircle } from '../../../../lib/icons.js'

import { useServer } from '../../../../app/ServerProvider.js'
import { useEventMedia, type MediaAddress } from '../../../../data/use-event-media.js'
import { colorForEventType } from '../event-highlights.js'
import { RADIUS } from '../../../../theme/tokens.js'

type IconComponent = React.ComponentType<{ size: number; color: string }>

function iconForClass(className: string): IconComponent {
  const lower = className.toLowerCase()
  if (lower === 'person' || lower === 'face') return User
  if (['car', 'truck', 'bus', 'vehicle', 'motorcycle', 'bicycle'].includes(lower)) return Car
  if (lower === 'dog' || lower === 'cat' || lower === 'animal') return Dog
  if (lower === 'bird') return Bird
  return HelpCircle
}

export interface CropTileProps {
  readonly eventId: string
  /** Owning device — kept so the HTTP plane stays scoped to this camera. */
  readonly deviceId: number
  readonly mediaUrl?: string
  readonly className: string
  readonly size: number
  readonly selected?: boolean
  readonly onPress?: () => void
}

export const CropTile = memo(function CropTile({
  eventId,
  deviceId,
  mediaUrl,
  className,
  size,
  selected = false,
  onPress,
}: CropTileProps) {
  const { token } = useServer()
  // No importer reaches this component (see `TrackMediaGallery.tsx`'s
  // docblock). Kept type-correct for a green build: `eventId` is treated as a
  // track owner id, the same address every live crop tile resolves against.
  const address: MediaAddress | null =
    eventId.length > 0 ? { kind: 'owner', ownerType: 'track', ownerId: eventId } : null
  const { uri, isData, failed, onError } = useEventMedia(address, mediaUrl, 'crop', { deviceId })

  const accent = colorForEventType(className)
  const Icon = iconForClass(className)
  const headers: Record<string, string> | undefined =
    token && uri && !isData ? { Authorization: `Bearer ${token}` } : undefined

  const frame = {
    width: size,
    height: size,
    borderRadius: RADIUS.sm,
    borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
    borderColor: selected ? accent : 'rgba(255,255,255,0.15)',
  }

  const body =
    failed || uri === null ? (
      <View style={[styles.tile, frame, styles.center, { backgroundColor: accent + '1A' }]}>
        <Icon size={size * 0.42} color={accent} />
      </View>
    ) : (
      <View style={[styles.tile, frame]}>
        <Image
          source={headers ? { uri, headers } : { uri }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          cachePolicy="memory-disk"
          onError={onError}
        />
      </View>
    )

  if (!onPress) return body
  return (
    <Pressable onPress={onPress} hitSlop={4}>
      {body}
    </Pressable>
  )
})

const styles = StyleSheet.create({
  tile: { overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.3)' },
  center: { alignItems: 'center', justifyContent: 'center' },
})
