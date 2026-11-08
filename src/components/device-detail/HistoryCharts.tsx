/**
 * The History tab's marks, drawn with `react-native-svg` in a fixed 1000-unit
 * viewBox that scales to the card's width (no measuring, so it also renders
 * before layout): state bands for boolean / enum series and for device runs,
 * a line for gauge / counter series. Colours are theme tokens; every chart
 * carries an `accessibilityLabel` that says what it shows.
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import type { ColorTokens } from '../../theme/tokens.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../theme/tokens.js'
import {
  valueRange,
  xAt,
  type HistoryWindow,
  type LinePoint,
  type RunBand,
  type StateBand,
} from '../../data/device-history-model.js'

const W = 1000
const BAND_H = 80
const LINE_H = 260
const LINE_STROKE = 6
const DOT_R = 7
const LINE_PAD = 16

/** The colour of a band label: on / running = primary, off = quiet, enum states cycle the status hues. */
export function bandColor(label: string, order: readonly string[], colors: ColorTokens): string {
  if (label === 'on') return colors.primary
  if (label === 'off') return colors.border
  const palette = [colors.primary, colors.info, colors.warning, colors.success, colors.danger]
  const i = Math.max(0, order.indexOf(label))
  return palette[i % palette.length]!
}

function Frame({ children, height, label, testID }: {
  readonly children: React.ReactNode
  readonly height: number
  readonly label: string
  readonly testID: string
}): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[styles.frame, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}
    >
      <Svg width="100%" viewBox={`0 0 ${W} ${height}`} style={height === BAND_H ? styles.bandSvg : styles.lineSvg}>
        {children}
      </Svg>
    </View>
  )
}

export function BandsChart({ bands, window, order, label, testID }: {
  readonly bands: readonly { readonly from: number; readonly to: number; readonly label: string }[]
  readonly window: HistoryWindow
  readonly order: readonly string[]
  readonly label: string
  readonly testID: string
}): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <Frame height={BAND_H} label={label} testID={testID}>
      {bands.map((b, i) => {
        const x = xAt(b.from, window, W)
        return (
          <Rect key={`${b.from}-${i}`} x={x} y={0} width={Math.max(2, xAt(b.to, window, W) - x)} height={BAND_H} fill={bandColor(b.label, order, colors)} />
        )
      })}
    </Frame>
  )
}

/** Device runs as bands: the run is the filled part, the rest of the window is empty. */
export function RunsChart({ runs, window, label, testID }: {
  readonly runs: readonly RunBand[]
  readonly window: HistoryWindow
  readonly label: string
  readonly testID: string
}): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <Frame height={BAND_H} label={label} testID={testID}>
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
    </Frame>
  )
}

export function LineChart({ segments, window, label, testID }: {
  readonly segments: readonly (readonly LinePoint[])[]
  readonly window: HistoryWindow
  readonly label: string
  readonly testID: string
}): React.JSX.Element {
  const { colors } = useTheme()
  const range = valueRange(segments)
  const y = (v: number): number =>
    range === null ? LINE_H / 2 : LINE_H - LINE_PAD - ((v - range.min) / (range.max - range.min)) * (LINE_H - 2 * LINE_PAD)
  return (
    <Frame height={LINE_H} label={label} testID={testID}>
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
    </Frame>
  )
}

/** The window's two ends under a chart. */
export function TimeAxis({ windowId }: { readonly windowId: string }): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View style={styles.axis}>
      <Text style={[styles.axisText, { color: colors.foregroundSubtle }]}>{t(`v2.deviceDetail.history.ago.${windowId}`)}</Text>
      <Text style={[styles.axisText, { color: colors.foregroundSubtle }]}>{t('v2.deviceDetail.history.now')}</Text>
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
          <Text style={[styles.axisText, { color: colors.foregroundMuted }]}>{names[l] ?? l}</Text>
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
  frame: { borderWidth: 1, borderRadius: RADIUS.lg, overflow: 'hidden' },
  bandSvg: { aspectRatio: W / BAND_H },
  lineSvg: { aspectRatio: W / LINE_H },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.sm },
  axisText: { fontSize: TYPOGRAPHY.size.sm },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.lg, marginTop: SPACING.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  swatch: { width: 10, height: 10, borderRadius: RADIUS.pill },
})
