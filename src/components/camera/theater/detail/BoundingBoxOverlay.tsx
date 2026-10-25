/**
 * BoundingBoxOverlay — draws each detection's bounding box over the frame image
 * in the detail modal. Boxes are projected from inference-frame pixel coords
 * (`bbox` + `frameWidth`/`frameHeight`) onto the `contain`-rendered image rect,
 * so they line up with the displayed frame regardless of its render size. Each
 * box is colored by detection class (matching DetectionMetaList) and tagged with
 * the class, confidence and — for tracking — a short track id + state.
 *
 * Presentational + pointer-transparent; renders nothing until the frame carries
 * bbox geometry (server `projection:'full'`).
 */

import React, { memo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colorForEventType } from '../event-highlights.js'
import { RADIUS } from '../../../../theme/tokens.js'
import { useEventKindResolver } from '../../../../data/use-event-kind-resolver.js'
import { containRect, bboxToScreen, type DetailDetection } from './cluster-detail.js'

export interface BoundingBoxOverlayProps {
  readonly detections: readonly DetailDetection[]
  readonly width: number
  readonly height: number
}

export const BoundingBoxOverlay = memo(function BoundingBoxOverlay({
  detections,
  width,
  height,
}: BoundingBoxOverlayProps) {
  // `d.className` and the tier-1 `d.label` (a sub-class like `van`) are
  // TAXONOMY, not an identity — `DetailDetection` carries no tier-2 field —
  // so both go through the resolver, same as `DetectionMetaList`.
  const resolver = useEventKindResolver()
  // All detections on a frame share the inference-frame dimensions; take them
  // from the first detection that carries both a bbox and frame size.
  const sized = detections.find(
    (d) => d.bbox && typeof d.frameWidth === 'number' && typeof d.frameHeight === 'number',
  )
  if (!sized?.frameWidth || !sized?.frameHeight || width <= 0 || height <= 0) return null

  const image = containRect(sized.frameWidth, sized.frameHeight, width, height)

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {detections.map((d) => {
        if (!d.bbox || !d.frameWidth || !d.frameHeight) return null
        const r = bboxToScreen(d.bbox, d.frameWidth, d.frameHeight, image)
        if (r.width <= 0 || r.height <= 0) return null
        const color = colorForEventType(d.className)
        const pct = typeof d.confidence === 'number' ? ` ${Math.round(d.confidence * 100)}%` : ''
        // Class/label + score only (matches the live-view overlay). Prefer the
        // tier-1 sub-class over the raw class when present — both resolved.
        const caption = `${resolver.resolveLabel(d.label ?? d.className)}${pct}`
        return (
          <View
            key={d.id}
            style={[styles.box, { left: r.left, top: r.top, width: r.width, height: r.height, borderColor: color }]}
          >
            <View style={[styles.tag, { backgroundColor: color }]}>
              <Text
                style={styles.tagText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {caption}
              </Text>
            </View>
          </View>
        )
      })}
    </View>
  )
})

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: RADIUS.sm,
  },
  tag: {
    position: 'absolute',
    top: -16,
    left: -2,
    maxWidth: 160,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: RADIUS.sm,
  },
  tagText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
})
