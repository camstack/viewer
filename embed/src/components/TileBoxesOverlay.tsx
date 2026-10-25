/**
 * TileBoxesOverlay — live detection bounding boxes composited on one grid tile.
 *
 * Subscribes to the tile device's `detection.result` live events (the SAME
 * `EventCategory.DetectionResult` stream the tile highlight / active-only mode
 * already consume — the share-view token allowlist covers it via
 * `live.onEvent`), normalizes each frame's pixel boxes to 0..1
 * (`normalizeFrameBoxes`, pure + tested) and renders them as
 * percentage-positioned rects with a `label score%` tag colored per class.
 *
 * Boxes auto-clear after a short idle window so they fade once detection
 * stops. Non-interactive (`pointerEvents: none`) — never steals tile taps.
 */
import { useEffect, useRef, useState } from 'react'
import { useLiveEvent } from '@camstack/ui-library'
import { EventCategory } from '@camstack/types/enums'
import type { DetectionResultPayload } from '@camstack/types'
import {
  normalizeFrameBoxes,
  tileBoxColor,
  TILE_BOXES_FADE_MS,
  type TileBox,
} from '../embed/tile-boxes'

interface TileBoxesOverlayProps {
  readonly deviceId: number
}

export function TileBoxesOverlay({ deviceId }: TileBoxesOverlayProps) {
  const [boxes, setBoxes] = useState<readonly TileBox[]>([])
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useLiveEvent<DetectionResultPayload>(EventCategory.DetectionResult, (evt) => {
    const p = evt.data
    if (!p || p.frame.deviceId !== deviceId) return
    setBoxes(normalizeFrameBoxes(p.frame))
    if (fadeTimer.current) clearTimeout(fadeTimer.current)
    fadeTimer.current = setTimeout(() => setBoxes([]), TILE_BOXES_FADE_MS)
  })

  // Clear pending fade + stale boxes on unmount / device change.
  useEffect(() => {
    return () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current)
      setBoxes([])
    }
  }, [deviceId])

  if (boxes.length === 0) return null

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {boxes.map((box, i) => {
        const color = tileBoxColor(box.label)
        const pct = Math.round(box.score * 100)
        return (
          <div
            // No guaranteed tracking id; index keeps keys stable per frame.
            key={`${box.label}-${i}`}
            style={{
              position: 'absolute',
              left: `${box.x1 * 100}%`,
              top: `${box.y1 * 100}%`,
              width: `${(box.x2 - box.x1) * 100}%`,
              height: `${(box.y2 - box.y1) * 100}%`,
              border: `2px solid ${color}`,
              borderRadius: 3,
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: -2,
                bottom: '100%',
                background: color,
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                fontFamily: 'system-ui, sans-serif',
                lineHeight: '14px',
                padding: '0 4px',
                borderRadius: 3,
                whiteSpace: 'nowrap',
              }}
            >
              {`${box.label} ${pct}%`}
            </span>
          </div>
        )
      })}
    </div>
  )
}
