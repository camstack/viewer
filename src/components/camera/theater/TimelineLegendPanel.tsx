/**
 * TimelineLegendPanel — what the heatmap tape and the right-edge activity
 * columns mean. Opened from the toolbar "?" so the operator does not have to
 * guess the language of the two surfaces.
 */
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING, withAlpha } from '../../../theme/tokens.js'

/** Faint well behind a legend swatch. White in both themes, so a dark swatch still separates. */
const SWATCH_WELL_ALPHA = 0.04
import { audioScaleColors, useKindPaint } from '../../../../shared/palette.js'
import { TimelinePanelHost } from './TimelinePanelHost.js'

export interface TimelineLegendPanelProps {
  readonly onClose: () => void
}

interface SwatchRowProps {
  readonly color?: string
  readonly scale?: readonly string[]
  readonly shape: 'lineH' | 'lineV' | 'dot' | 'peak' | 'fill' | 'scale'
  readonly title: string
}

function Swatch({
  color,
  scale,
  shape,
}: Pick<SwatchRowProps, 'color' | 'scale' | 'shape'>): React.JSX.Element {
  const { colors } = useTheme()
  const well = [styles.swatchBox, { backgroundColor: withAlpha(colors.onPicture, SWATCH_WELL_ALPHA) }]
  if (shape === 'scale') {
    return (
      <View style={[well, styles.scaleBox]}>
        {(scale ?? []).map((c) => (
          <View key={c} style={[styles.scaleBar, { backgroundColor: c }]} />
        ))}
      </View>
    )
  }
  if (shape === 'dot') {
    return (
      <View style={[styles.swatchBox, { backgroundColor: 'transparent' }]}>
        <View style={[styles.dot, { backgroundColor: color, borderColor: colors.mediaBlack }]} />
      </View>
    )
  }
  if (shape === 'lineV') {
    return (
      <View style={well}>
        <View style={[styles.lineV, { backgroundColor: color }]} />
      </View>
    )
  }
  if (shape === 'peak') {
    return (
      <View style={well}>
        <View style={[styles.peak, { backgroundColor: color }]} />
      </View>
    )
  }
  if (shape === 'fill') {
    return <View style={[styles.swatchBox, { backgroundColor: color }]} />
  }
  return (
    <View style={well}>
      <View style={[styles.lineH, { backgroundColor: color }]} />
    </View>
  )
}

function SwatchRow({ color, scale, shape, title }: SwatchRowProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View style={styles.row}>
      <Swatch color={color} scale={scale} shape={shape} />
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
    </View>
  )
}

export function TimelineLegendPanel({ onClose }: TimelineLegendPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const paint = useKindPaint()
  const audioScale = audioScaleColors()
  return (
    <TimelinePanelHost title={t('v2.theater.legend.title')} onClose={onClose}>
      <Text style={[styles.section, { color: colors.foregroundMuted }]}>
        {t('v2.theater.legend.heatmapTitle')}
      </Text>
      <SwatchRow
        color={paint('recording')}
        shape="lineH"
        title={t('v2.theater.legend.heatmapRecordingTitle')}
      />
      <SwatchRow
        scale={audioScale}
        shape="scale"
        title={t('v2.theater.legend.heatmapAudioTitle')}
      />
      <SwatchRow
        color={paint('motion')}
        shape="fill"
        title={t('v2.theater.legend.heatmapBottomTitle')}
      />

      <Text style={[styles.section, { color: colors.foregroundMuted }]}>
        {t('v2.theater.legend.timelineTitle')}
      </Text>
      <SwatchRow
        color={paint('recording')}
        shape="lineV"
        title={t('v2.theater.legend.timelineRecordingTitle')}
      />
      <SwatchRow
        color={paint('motion')}
        shape="lineV"
        title={t('v2.theater.legend.timelineMotionTitle')}
      />
      <SwatchRow
        color={paint('person')}
        shape="dot"
        title={t('v2.theater.legend.timelineDetectionTitle')}
      />
      <SwatchRow
        scale={audioScale}
        shape="scale"
        title={t('v2.theater.legend.timelineAudioTitle')}
      />

      <Text style={[styles.section, { color: colors.foregroundMuted }]}>
        {t('v2.theater.legend.classesTitle')}
      </Text>
      <SwatchRow
        color={paint('person')}
        shape="dot"
        title={t('v2.theater.legend.classPerson')}
      />
      <SwatchRow
        color={paint('vehicle')}
        shape="dot"
        title={t('v2.theater.legend.classVehicle')}
      />
      <SwatchRow
        color={paint('animal')}
        shape="dot"
        title={t('v2.theater.legend.classAnimal')}
      />
    </TimelinePanelHost>
  )
}

const styles = StyleSheet.create({
  section: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    opacity: 0.7,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.sm,
  },
  swatchBox: {
    width: 28,
    height: 28,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleBox: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    gap: 1,
    paddingVertical: 5,
  },
  lineH: {
    width: 20,
    height: 3,
    borderRadius: 1,
  },
  lineV: {
    width: 3,
    height: 18,
    borderRadius: 1,
  },
  peak: {
    width: 8,
    height: 18,
    borderRadius: 1,
  },
  scaleBar: {
    width: 3,
    borderRadius: 1,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
})
