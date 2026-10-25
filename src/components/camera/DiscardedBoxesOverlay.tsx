/**
 * DiscardedBoxesOverlay — DIAGNOSTIC layer: what the model saw that the
 * pipeline threw away before `MotionBoxesOverlay` could draw it.
 *
 * Two elements, both deliberately un-mistakable for real detections:
 *
 * 1. **The discarded boxes** — thin DASHED red outlines with a translucent
 *    label reading `class score% · reason` ("below threshold", "zone rule").
 *    Fed by `FrameResult.discarded[]`, which the server puts on every
 *    `detection.result` frame that dropped a box (since 2026-08-01), and
 *    narrowed to the RELEVANT drops by `filterRelevantDiscards` — near-miss
 *    and out-of-zone subjects only. Drawing the whole feed put every chair,
 *    TV and full-frame phantom on the picture, which is not a middle ground
 *    between "survivors" and "everything": it IS everything.
 *
 * 2. **The count pill** (bottom-center) — `model N · kept M`, derived from
 *    the live `pipeline.trace` event, which DOES leave the process today.
 *    N is the root detector's post-NMS output; M the survivors after the
 *    confidence / class / full-frame filters. N > M is exactly the
 *    "boxes are missing" gap the operator on cam 101 could previously only
 *    infer. A shed frame ("shed · <reason>") means the pool deliberately
 *    skipped inference — a different fact from "the model saw nothing".
 *    The pill counts the UNFILTERED feed on purpose: it is the diagnostic,
 *    the boxes are the UX. It also reports how many drops were withheld as
 *    off-topic, so the gap and the outlines on screen never silently disagree.
 *
 * Same contract as its siblings: fills the (relative) parent, measured with
 * `onLayout`, `pointerEvents="none"`, live-edge only, mounted only at the top
 * `discarded` layer of the box overlay (`hasLayer(config, 'discarded')`).
 */
import React, { useMemo, useState } from 'react'
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  useDiscardedDetections,
  discardReasonKey,
  filterRelevantDiscards,
} from '../../data/use-discarded-detections.js'
import { RADIUS, withAlpha } from '../../theme/tokens.js'
import { useTheme } from '../../theme/theme-provider.js'
import { useEventKindResolver } from '../../data/use-event-kind-resolver.js'

export interface DiscardedBoxesOverlayProps {
  readonly deviceId: number
  /** Gated by the box overlay's top rung ("All model detections"). */
  readonly enabled: boolean
}

interface Size {
  readonly width: number
  readonly height: number
}

export function DiscardedBoxesOverlay({ deviceId, enabled }: DiscardedBoxesOverlayProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { boxes, trace } = useDiscardedDetections(deviceId, enabled)
  // A dropped detection never reached enrichment, so `box.label` is always the
  // raw taxonomy class — resolved below.
  const resolver = useEventKindResolver([deviceId])
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  const onLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
  }

  const hidden = trace ? Math.max(0, trace.modelSaw - trace.kept) : 0

  // The boxes DRAWN are the relevant subset; the pill below still counts the
  // whole feed. Chairs, TVs and full-frame phantoms are dropped here, not in
  // the hook — see `RELEVANT_DISCARD_REASONS`.
  const drawnBoxes = useMemo(() => filterRelevantDiscards(boxes), [boxes])
  const offTopic = boxes.length - drawnBoxes.length

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {size.width > 0 && size.height > 0
        ? drawnBoxes.map((box, i) => {
            const left = box.x1 * size.width
            const top = box.y1 * size.height
            const width = (box.x2 - box.x1) * size.width
            const height = (box.y2 - box.y1) * size.height
            if (width <= 0 || height <= 0) return null

            const pct = Math.round(box.score * 100)
            const reasonKey = box.reason !== undefined ? discardReasonKey(box.reason) : null
            const reasonText =
              reasonKey !== null ? t(reasonKey) : box.reason !== undefined ? box.reason : null
            const resolvedLabel = resolver.resolveLabel(box.label)
            const text =
              reasonText !== null
                ? `${resolvedLabel} ${pct}% · ${reasonText}`
                : `${resolvedLabel} ${pct}%`
            // No identity across frames; index keeps keys stable per frame.
            const key = `${box.label}-${i}`
            const labelMaxWidth = Math.max(24, size.width - left)
            return (
              <React.Fragment key={key}>
                <View
                  style={[
                    styles.box,
                    { left, top, width, height, borderColor: colors.danger },
                  ]}
                />
                <View
                  style={[
                    styles.label,
                    {
                      left,
                      top: Math.max(0, top - 16),
                      maxWidth: labelMaxWidth,
                      backgroundColor: withAlpha(colors.dangerFill, 0.55),
                    },
                  ]}
                >
                  <Text
                    style={[styles.labelText, { color: colors.dangerOn }]}
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

      {/* The count pill — the part that works TODAY. Rendered only while a
          trace is fresh so an idle camera (no inference running) shows
          nothing rather than a stale zero. */}
      {trace !== null ? (
        <View style={styles.pillRow}>
          <View
            style={[
              styles.pill,
              {
                backgroundColor: withAlpha(colors.background, 0.55),
                borderColor: colors.danger,
              },
            ]}
          >
            <Text style={[styles.pillText, { color: colors.foreground }]}>
              {trace.shedReason !== undefined
                ? t('v2.overlay.diagShed', { reason: trace.shedReason })
                : t('v2.overlay.diagCounts', { saw: trace.modelSaw, kept: trace.kept })}
            </Text>
            {hidden > 0 && trace.shedReason === undefined ? (
              <Text style={[styles.pillText, styles.pillHidden, { color: colors.danger }]}>
                {' · '}
                {t('v2.overlay.diagHidden', { hidden })}
              </Text>
            ) : null}
            {/* How many of the dropped boxes were withheld from the picture for
                being off-topic. Without it the pill's gap and the number of
                dashed outlines disagree and the overlay looks broken. */}
            {offTopic > 0 && trace.shedReason === undefined ? (
              <Text style={[styles.pillText, { color: colors.foreground }]}>
                {' · '}
                {t('v2.overlay.diagOffTopic', { offTopic })}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  // Thin + dashed + fixed red: a ghost of a box, not a detection.
  box: {
    position: 'absolute',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: RADIUS.sm,
  },
  label: {
    position: 'absolute',
    alignSelf: 'flex-start',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: RADIUS.sm,
  },
  labelText: { fontSize: 9, fontWeight: '700' },
  pillRow: { position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: { fontSize: 10, fontWeight: '600' },
  pillHidden: {},
})
