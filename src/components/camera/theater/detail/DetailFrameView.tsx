/**
 * DetailFrameView — one frame in the detail pager: the full-frame image (via
 * useEventMedia) rendered "contain", with the detections' bounding boxes drawn
 * on top, projected from the inference-frame coords the server now provides
 * (`bbox` + `frameWidth`/`frameHeight` on the `full` projection).
 */

import React, { memo } from 'react'
import { View, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { ImageOff } from '../../../../lib/icons.js'
import { useServer } from '../../../../app/ServerProvider.js'
import { useEventMedia, type MediaAddress } from '../../../../data/use-event-media.js'
import { useTheme } from '../../../../theme/theme-provider.js'
import { BoundingBoxOverlay } from './BoundingBoxOverlay.js'
import type { DetailFrame } from './cluster-detail.js'

export interface DetailFrameViewProps {
  readonly frame: DetailFrame
  /** Owning device — kept so the HTTP plane stays scoped to this camera. */
  readonly deviceId: number
  readonly width: number
  readonly height: number
  /** Draw the detection bounding boxes over the clean full frame. Default true;
   *  the detail's "show bounding box" checkbox passes false for the clean view. */
  readonly showBoxes?: boolean
}

export const DetailFrameView = memo(function DetailFrameView({
  frame,
  deviceId,
  width,
  height,
  showBoxes = true,
}: DetailFrameViewProps) {
  const { token } = useServer()
  const { colors } = useTheme()
  // Request the unboxed `fullFrame` (the React BoundingBoxOverlay draws the box
  // on top). Passing `preferKind` also bypasses the kind-agnostic `mediaUrl`
  // fast-path, which points at a crop/thumbnail — not the full scene — and was
  // the cause of the black/broken main frame.
  //
  // `frame.imageDetectionId` is a real OBJECT event id (`getObjectEvents`,
  // `projection: 'full'`) — an explicit `object`-owned address (D482), never a
  // guessed owner type. No importer reaches this component (see
  // `TrackMediaGallery.tsx`'s docblock); kept type-correct for a green build.
  const address: MediaAddress | null =
    frame.imageDetectionId !== undefined
      ? { kind: 'owner', ownerType: 'object', ownerId: frame.imageDetectionId }
      : null
  const { uri, isData, failed, onError } = useEventMedia(
    address,
    frame.imageMediaUrl,
    'fullFrame',
    { deviceId },
  )

  const headers: Record<string, string> | undefined =
    token && uri && !isData ? { Authorization: `Bearer ${token}` } : undefined

  const hasImage = uri !== null && !failed

  return (
    <View style={[styles.container, { width, height }]}>
      {hasImage ? (
        <Image
          source={headers ? { uri, headers } : { uri }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          cachePolicy="memory-disk"
          onError={onError}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
          <ImageOff size={40} color={colors.foregroundSubtle} />
        </View>
      )}

      {/* Detection bounding boxes, projected onto the contain-rendered image.
          Hidden when the detail's "show bounding box" checkbox is off. */}
      {showBoxes ? (
        <BoundingBoxOverlay detections={frame.detections} width={width} height={height} />
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  container: { backgroundColor: '#000', overflow: 'hidden' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
})
