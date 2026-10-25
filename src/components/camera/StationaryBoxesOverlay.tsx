/**
 * StationaryBoxesOverlay — the PARKED objects, composited ON the video surface.
 *
 * ## Why this is its own component
 *
 * It used to be a block inside `MotionBoxesOverlay`, which draws the LIVE
 * detections. That gave the parked objects no switch of their own: the only
 * gate was the detection-boxes control, and that control defaults OFF — so a
 * fresh install never drew a parked car, and "parked only" could not be asked
 * for at all. `stationary` is now one of four independent
 * `OverlayLayer`s, and this is the thing that layer mounts.
 *
 * ## Where the data comes from, and why it needs its own cadence
 *
 * `zoneAnalytics.getCurrentSnapshot` carries `stationaryObjects[]` — the last
 * CONFIRMED bbox of each parked object, normalised client-side by
 * `data/occupancy.ts`. Promotion used to be silent (`occupancy-changed` only
 * fires when `frame.totalObjects` changes). The hub now emits
 * `pipeline-analytics.stationary-changed` on appear/depart; `useLiveInvalidation`
 * invalidates occupancy, so this overlay uses the five-minute reconcile like
 * every other event-backed query.
 *
 * Fills its (relative) parent and is non-interactive, so it never steals taps.
 */
import React, { useState } from 'react'
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useCurrentOccupancy } from '../../data/use-occupancy.js'
import { RADIUS } from '../../theme/tokens.js'
import { useEventKindResolver } from '../../data/use-event-kind-resolver.js'

/** Muted steel accent for parked objects — deliberately OUTSIDE the class-color
 *  palette so a parked car never reads as a live detection. */
const STATIONARY_COLOR = '#8b98a5'

export interface StationaryBoxesOverlayProps {
  readonly deviceId: number
  /** Gated by the overlay's `stationary` layer. */
  readonly enabled: boolean
}

interface Size {
  readonly width: number
  readonly height: number
}

export function StationaryBoxesOverlay({ deviceId, enabled }: StationaryBoxesOverlayProps) {
  const { t } = useTranslation()
  const { data: occupancy, dataUpdatedAt } = useCurrentOccupancy(deviceId, enabled)
  // `obj.label` is NOT tier-1 taxonomy here: the server stamps it from
  // `displayLabel(track)` — `subLabel ?? label` — before promotion, so by the
  // time it reaches this snapshot the two tiers are already collapsed into one
  // field that CAN be an ArcFace identity or a plate. It stays verbatim,
  // exactly like a tier-2 value, for the same reason `trackTitle` never
  // resolves `subLabel`. Only the className fallback (used when a parked
  // object carries no enrichment at all) is safely resolvable taxonomy.
  const resolver = useEventKindResolver([deviceId])
  const stationary = occupancy?.stationaryObjects ?? []
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  const onLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
  }

  if (!enabled) return null

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {size.width > 0 && size.height > 0
        ? stationary.map((obj) => {
            const left = obj.x1 * size.width
            const top = obj.y1 * size.height
            const width = (obj.x2 - obj.x1) * size.width
            const height = (obj.y2 - obj.y1) * size.height
            if (width <= 0 || height <= 0) return null
            // Measured against the SNAPSHOT's arrival, not `Date.now()`:
            // reading the clock during render is impure. A new parked object
            // refetches the snapshot (stationary-changed), which refreshes
            // this number; the five-minute reconcile is the backstop.
            const minutes = Math.max(
              0,
              Math.round((dataUpdatedAt - obj.becameStationaryAt) / 60_000),
            )
            // obj.label (when present) is the server's already-collapsed
            // enrichment value and stays VERBATIM; only the className fallback
            // is resolved taxonomy.
            const text = `${obj.label ?? resolver.resolveLabel(obj.className)} · ${t('v2.cameras.stationaryFor', { min: minutes })}`
            return (
              <React.Fragment key={`stationary-${obj.id}`}>
                <View style={[styles.box, { left, top, width, height }]} />
                <View
                  style={[
                    styles.label,
                    { left, top: Math.max(0, top - 18), maxWidth: Math.max(24, size.width - left) },
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
  /** Dashed muted rect + soft fill — clearly NOT a live box. */
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: RADIUS.sm,
    borderColor: STATIONARY_COLOR,
    backgroundColor: 'rgba(139,152,165,0.08)',
  },
  label: {
    position: 'absolute',
    alignSelf: 'flex-start',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: RADIUS.sm,
    backgroundColor: STATIONARY_COLOR,
  },
  labelText: { fontSize: 10, fontWeight: '700', color: '#ffffff' },
})
