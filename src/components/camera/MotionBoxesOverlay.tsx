/**
 * MotionBoxesOverlay — LIVE detection overlay composited ON the video surface.
 *
 * Subscribes to the device's live `detection.result` events (and, when
 * available, enriched `pipeline-analytics.frame-tracked` frames) via
 * `useDetections` and draws each detected object as an absolutely-positioned
 * rect, scaled from its normalized `{x1,y1,x2,y2}` box to the overlay's
 * measured size (`onLayout`). Each box carries a `name score%` tag when an
 * enriched frame supplied a recognized identity/plate name, else `label
 * score%`, colored by the detection class. Detail boxes (face/plate — `kind:
 * 'detail'`) render with a thinner dashed border to read as a nested
 * sub-detection. Boxes auto-clear after a short idle window (handled by the
 * hook) so they fade once detection stops.
 *
 * Draws the LIVE detections only. The PARKED objects were drawn here too until
 * the box overlay became a layer set — they had no switch of their own that way,
 * because this component's gate was the only gate. They now live in
 * `StationaryBoxesOverlay`, behind the `stationary` layer.
 *
 * Fills its (relative) parent and is non-interactive (`pointerEvents="none"`)
 * so it never steals taps from the stream controls beneath it.
 */
import React, { useState } from 'react'
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native'
import { useDetections } from '../../data/use-detections.js'
import { RADIUS } from '../../theme/tokens.js'
import { useKindPaint } from '../../../shared/palette.js'
import { useEventKindResolver } from '../../data/use-event-kind-resolver.js'

export interface MotionBoxesOverlayProps {
  readonly deviceId: number
  /** Gated by the overlay's `objects` layer. */
  readonly enabled: boolean
}

interface Size {
  readonly width: number
  readonly height: number
}

export function MotionBoxesOverlay({ deviceId, enabled }: MotionBoxesOverlayProps) {
  const { boxes } = useDetections(deviceId, enabled)
  // `box.label` is the raw detection class (taxonomy) — resolved below.
  // `box.name`, when present, is the enrichment identity/plate and is already
  // shown VERBATIM; it must never go through the resolver.
  const resolver = useEventKindResolver([deviceId])
  const paint = useKindPaint()
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  const onLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {size.width > 0 && size.height > 0
        ? boxes.map((box, i) => {
            // Boxes arrive normalized 0..1 — scale to the measured overlay.
            const left = box.x1 * size.width
            const top = box.y1 * size.height
            const width = (box.x2 - box.x1) * size.width
            const height = (box.y2 - box.y1) * size.height
            if (width <= 0 || height <= 0) return null

            const color = paint(box.label)
            const pct = Math.round(box.score * 100)
            const text =
              box.name !== undefined
                ? `${box.name} ${pct}%`
                : `${resolver.resolveLabel(box.label)} ${pct}%`
            // No guaranteed tracking id; index keeps keys stable per frame.
            const key = `${box.label}-${i}`

            // Label is rendered at the OVERLAY level (sibling of the box), not
            // as a child of the box — a child's width is clamped to the box
            // width, so narrow detections forced the text to ellipsize. At the
            // overlay level the only width bound is the screen, so the full
            // `label score%` fits; `adjustsFontSizeToFit` shrinks it only when a
            // long label would otherwise run past the right edge.
            const labelMaxWidth = Math.max(24, size.width - left)
            return (
              <React.Fragment key={key}>
                <View
                  style={[
                    styles.box,
                    box.detail ? styles.detailBox : null,
                    { borderColor: color, left, top, width, height },
                  ]}
                />
                <View
                  style={[
                    styles.label,
                    { backgroundColor: color, left, top: Math.max(0, top - 18), maxWidth: labelMaxWidth },
                  ]}
                >
                  <Text
                    style={styles.labelText}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.6}
                  >
                    {text}
                  </Text>
                </View>
              </React.Fragment>
            )
          })
        : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: RADIUS.sm,
  },
  detailBox: { borderWidth: 1, borderStyle: 'dashed' },
  label: {
    position: 'absolute',
    alignSelf: 'flex-start',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: RADIUS.sm,
  },
  labelText: { fontSize: 10, fontWeight: '700', color: '#ffffff' },
})
