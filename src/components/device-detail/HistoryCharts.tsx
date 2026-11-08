/**
 * The History tab's marks, drawn with `react-native-svg` in a fixed 1000-unit
 * viewBox that scales to the plot's width: state bands for boolean / enum
 * series and for device runs, a line for gauge / counter series. Every chart
 * has value labels on the y axis (lines), time labels on the x axis, and a
 * cursor — hover with a mouse, touch or drag on a phone — that snaps a
 * crosshair and a tooltip with the time and the value. Colours are theme
 * tokens; every chart carries an `accessibilityLabel` that says what it shows.
 */
import React, { useMemo, useRef, useState } from 'react'
import { PanResponder, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import type { ColorTokens } from '../../theme/tokens.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../theme/tokens.js'
import {
  bandAt,
  formatSeriesValue,
  nearestPoint,
  timeAt,
  timeTicks,
  valueRange,
  valueTicks,
  xAt,
  type HistoryWindow,
  type HistoryWindowId,
  type LinePoint,
  type RunBand,
  type StateBand,
} from '../../data/device-history-model.js'

const W = 1000
const BAND_H = 80
const LINE_H = 260
const LINE_STROKE = 6
const GRID_STROKE = 2
const CROSS_STROKE = 3
const DOT_R = 7
const LINE_PAD = 16
const Y_TICKS = 3
/** Time labels that fit without touching: five on a wide plot, three on a phone. */
const X_TICKS_WIDE = 5
const X_TICKS_NARROW = 3
const X_WIDE_MIN_PLOT = 360
/** Width reserved left of every plot for the y labels, so bands and lines align. */
const Y_GUTTER = 52
const X_LABEL_W = 64
const X_LABEL_H = 16
const TIP_W = 136
const MARK_R = 5

/** The colour of a band label: on / running = primary, off = quiet, enum states cycle the status hues. */
export function bandColor(label: string, order: readonly string[], colors: ColorTokens): string {
  if (label === 'on') return colors.primary
  if (label === 'off') return colors.border
  const palette = [colors.primary, colors.info, colors.warning, colors.success, colors.danger]
  const i = Math.max(0, order.indexOf(label))
  return palette[i % palette.length]!
}

/** What the cursor says about the instant it is on. */
export interface Readout {
  /** The instant shown; a line snaps to its nearest point. */
  readonly t: number
  /** The value / state line, or null when the cursor is in a gap. */
  readonly text: string | null
  /** Where the dot sits on the plot, 0..1 from the top; omitted for bands. */
  readonly yFrac?: number
}

export interface YLabel {
  /** 0..1 from the top of the plot. */
  readonly frac: number
  readonly text: string
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function useAxisTime(windowId: HistoryWindowId): { readonly tick: (t: number) => string; readonly full: (t: number) => string } {
  const { i18n } = useTranslation()
  return useMemo(() => {
    const lang = i18n.language
    const hm = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' })
    const day = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' })
    const full = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    return {
      tick: (t: number): string => (windowId === '24h' ? hm.format(t) : day.format(t)),
      full: (t: number): string => full.format(t),
    }
  }, [i18n.language, windowId])
}

/**
 * One plot: the y labels in a left gutter, the marks, the time labels under
 * it, and the cursor. Gestures: a mouse hovers, a finger touches or drags
 * (a vertical drag is handed back to the scroll view).
 */
function ChartBody({ children, height, label, testID, window, windowId, yLabels, readoutAt }: {
  readonly children: React.ReactNode
  readonly height: number
  readonly label: string
  readonly testID: string
  readonly window: HistoryWindow
  readonly windowId: HistoryWindowId
  readonly yLabels?: readonly YLabel[]
  readonly readoutAt: (t: number) => Readout | null
}): React.JSX.Element {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const axisTime = useAxisTime(windowId)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [cursor, setCursor] = useState<number | null>(null)
  const widthRef = useRef(0)
  widthRef.current = size.w

  const fromX = (x: number): void => {
    if (widthRef.current > 0) setCursor(clamp01(x / widthRef.current))
  }
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => true,
        onPanResponderGrant: (e) => fromX(e.nativeEvent.locationX),
        onPanResponderMove: (e) => fromX(e.nativeEvent.locationX),
        onPanResponderTerminate: () => setCursor(null),
      }),
    [],
  )

  const readout = cursor === null ? null : readoutAt(timeAt(cursor, window))
  const crossX = readout === null ? null : (xAt(readout.t, window, size.w) || 0)
  const tipLeft = crossX === null ? 0 : Math.min(Math.max(0, crossX - TIP_W / 2), Math.max(0, size.w - TIP_W))
  const xTicks = timeTicks(window, size.w >= X_WIDE_MIN_PLOT ? X_TICKS_WIDE : X_TICKS_NARROW)

  return (
    <View style={styles.chartRow}>
      <View style={[styles.gutter, styles.inert, { height: size.h }]}>
        {size.h > 0 && yLabels !== undefined
          ? yLabels.map((y) => (
              <Text
                key={y.frac}
                numberOfLines={1}
                style={[styles.yLabel, { top: y.frac * size.h - styles.yLabel.height / 2, color: colors.foregroundSubtle }]}
              >
                {y.text}
              </Text>
            ))
          : null}
      </View>
      <View style={styles.plotCol}>
        <View
          testID={testID}
          accessibilityRole="image"
          accessibilityLabel={label}
          style={[styles.frame, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}
          onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          {...responder.panHandlers}
          onPointerMove={(e) => {
            if (e.nativeEvent.pointerType === 'mouse') fromX(e.nativeEvent.offsetX)
          }}
          onPointerLeave={() => setCursor(null)}
        >
          <View style={styles.inert}>
            <Svg width="100%" viewBox={`0 0 ${W} ${height}`} style={{ aspectRatio: W / height }}>
              {children}
            </Svg>
          </View>
          {crossX !== null ? (
            <View style={[StyleSheet.absoluteFill, styles.inert]}>
              <View testID={`${testID}-cross`} style={[styles.cross, { left: crossX, backgroundColor: colors.foregroundMuted }]} />
              {readout !== null && readout.yFrac !== undefined ? (
                <View
                  style={[
                    styles.mark,
                    { left: crossX - MARK_R, top: readout.yFrac * size.h - MARK_R, backgroundColor: colors.primary, borderColor: colors.backgroundElevated },
                  ]}
                />
              ) : null}
              {readout !== null ? (
                <View testID={`${testID}-tip`} style={[styles.tip, { left: tipLeft, backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={[styles.tipTime, { color: colors.foregroundMuted }]}>{axisTime.full(readout.t)}</Text>
                  {readout.text !== null ? <Text style={[styles.tipValue, { color: colors.foreground }]}>{readout.text}</Text> : null}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        <View style={styles.xAxis}>
          {size.w > 0
            ? xTicks.map((tick, i) => (
                <Text
                  key={tick.frac}
                  numberOfLines={1}
                  style={[
                    styles.xLabel,
                    {
                      left: Math.min(Math.max(0, tick.frac * size.w - X_LABEL_W / 2), size.w - X_LABEL_W),
                      color: colors.foregroundSubtle,
                    },
                  ]}
                >
                  {i === xTicks.length - 1 ? t('v2.deviceDetail.history.now') : axisTime.tick(tick.value)}
                </Text>
              ))
            : null}
        </View>
      </View>
    </View>
  )
}

export function BandsChart({ bands, window, windowId, order, names, label, testID }: {
  readonly bands: readonly StateBand[]
  readonly window: HistoryWindow
  readonly windowId: HistoryWindowId
  readonly order: readonly string[]
  readonly names: Readonly<Record<string, string>>
  readonly label: string
  readonly testID: string
}): React.JSX.Element {
  const { colors } = useTheme()
  const readoutAt = (t: number): Readout => {
    const b = bandAt(bands, t)
    return { t, text: b === null ? null : (names[b.label] ?? b.label) }
  }
  return (
    <ChartBody height={BAND_H} label={label} testID={testID} window={window} windowId={windowId} readoutAt={readoutAt}>
      {bands.map((b, i) => {
        const x = xAt(b.from, window, W)
        return (
          <Rect key={`${b.from}-${i}`} x={x} y={0} width={Math.max(2, xAt(b.to, window, W) - x)} height={BAND_H} fill={bandColor(b.label, order, colors)} />
        )
      })}
    </ChartBody>
  )
}

/** Device runs as bands: the run is the filled part, the rest of the window is empty. */
export function RunsChart({ runs, window, windowId, label, runLabel, testID }: {
  readonly runs: readonly RunBand[]
  readonly window: HistoryWindow
  readonly windowId: HistoryWindowId
  readonly label: string
  readonly runLabel: string
  readonly testID: string
}): React.JSX.Element {
  const { colors } = useTheme()
  const readoutAt = (t: number): Readout => {
    const r = runs.find((x) => t >= x.from && t <= x.to)
    return { t, text: r === undefined ? null : (r.outcome === null ? runLabel : `${runLabel} · ${r.outcome}`) }
  }
  return (
    <ChartBody height={BAND_H} label={label} testID={testID} window={window} windowId={windowId} readoutAt={readoutAt}>
      {runs.map((r, i) => {
        const x = xAt(r.from, window, W)
        return (
          <Rect
            key={`${r.from}-${i}`}
            x={x}
            y={0}
            width={Math.max(4, xAt(r.to, window, W) - x)}
            height={BAND_H}
            fill={r.outcome === 'failed' || r.outcome === 'aborted' ? colors.danger : colors.primary}
          />
        )
      })}
    </ChartBody>
  )
}

export function LineChart({ segments, window, windowId, unit, label, testID }: {
  readonly segments: readonly (readonly LinePoint[])[]
  readonly window: HistoryWindow
  readonly windowId: HistoryWindowId
  readonly unit: string | null
  readonly label: string
  readonly testID: string
}): React.JSX.Element {
  const { colors } = useTheme()
  const range = valueRange(segments)
  const span = range === null ? 1 : range.max - range.min
  const yFrac = (v: number): number => (range === null ? 0.5 : (LINE_PAD + ((range.max - v) / span) * (LINE_H - 2 * LINE_PAD)) / LINE_H)
  const y = (v: number): number => yFrac(v) * LINE_H
  const ticks = range === null ? [] : valueTicks(range, Y_TICKS)
  const yLabels = ticks.map((tick) => ({ frac: yFrac(tick.value), text: formatSeriesValue(tick.value, unit) }))
  const readoutAt = (t: number): Readout | null => {
    const p = nearestPoint(segments, t)
    return p === null ? null : { t: p.t, text: formatSeriesValue(p.v, unit), yFrac: yFrac(p.v) }
  }
  return (
    <ChartBody height={LINE_H} label={label} testID={testID} window={window} windowId={windowId} yLabels={yLabels} readoutAt={readoutAt}>
      {ticks.map((tick) => (
        <Line key={tick.frac} x1={0} x2={W} y1={y(tick.value)} y2={y(tick.value)} stroke={colors.borderSubtle} strokeWidth={GRID_STROKE} />
      ))}
      {segments.map((seg, i) =>
        seg.length === 1 ? (
          <Circle key={i} cx={xAt(seg[0]!.t, window, W)} cy={y(seg[0]!.v)} r={DOT_R} fill={colors.primary} />
        ) : (
          <Path
            key={i}
            d={seg.map((p, j) => `${j === 0 ? 'M' : 'L'}${xAt(p.t, window, W).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')}
            stroke={colors.primary}
            strokeWidth={LINE_STROKE}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />
        ),
      )}
    </ChartBody>
  )
}

/** Series names with their colours — the legend of a line chart. */
export function LineLegend({ name }: { readonly name: string }): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <View style={[styles.swatch, { backgroundColor: colors.primary }]} />
        <Text style={[styles.legendText, { color: colors.foregroundMuted }]}>{name}</Text>
      </View>
    </View>
  )
}

export function BandLegend({ labels, order, names }: {
  readonly labels: readonly string[]
  readonly order: readonly string[]
  readonly names: Readonly<Record<string, string>>
}): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View style={styles.legend}>
      {labels.map((l) => (
        <View key={l} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: bandColor(l, order, colors) }]} />
          <Text style={[styles.legendText, { color: colors.foregroundMuted }]}>{names[l] ?? l}</Text>
        </View>
      ))}
    </View>
  )
}

export function distinctLabels(bands: readonly StateBand[]): readonly string[] {
  const seen: string[] = []
  for (const b of bands) if (!seen.includes(b.label)) seen.push(b.label)
  return seen
}

const styles = StyleSheet.create({
  inert: { pointerEvents: 'none' },
  chartRow: { flexDirection: 'row' },
  gutter: { width: Y_GUTTER, paddingRight: SPACING.sm },
  yLabel: { position: 'absolute', left: 0, right: SPACING.sm, height: 14, lineHeight: 14, textAlign: 'right', fontSize: TYPOGRAPHY.size.xs },
  plotCol: { flex: 1 },
  frame: { borderWidth: 1, borderRadius: RADIUS.lg, overflow: 'hidden' },
  cross: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  mark: { position: 'absolute', width: MARK_R * 2, height: MARK_R * 2, borderRadius: RADIUS.pill, borderWidth: 2 },
  tip: { position: 'absolute', top: SPACING.sm, width: TIP_W, borderWidth: 1, borderRadius: RADIUS.md, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md },
  tipTime: { fontSize: TYPOGRAPHY.size.xs },
  tipValue: { fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.medium },
  xAxis: { height: X_LABEL_H, marginTop: SPACING.sm },
  xLabel: { position: 'absolute', top: 0, width: X_LABEL_W, textAlign: 'center', fontSize: TYPOGRAPHY.size.xs },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.lg, marginTop: SPACING.sm, paddingLeft: Y_GUTTER },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  legendText: { fontSize: TYPOGRAPHY.size.sm },
  swatch: { width: 10, height: 10, borderRadius: RADIUS.pill },
})
