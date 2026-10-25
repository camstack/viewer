/**
 * DetectionMetaList — renders the metadata for every detection on a frame:
 * class icon + colored name, optional sub-label, confidence %, zone chips, and
 * track state. Presentational; no data fetching.
 */

import React, { memo } from 'react'
import { View, Text, StyleSheet, ScrollView } from 'react-native'
import { User, Car, Dog, Bird, HelpCircle } from '../../../../lib/icons.js'
import { useTheme } from '../../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../../theme/tokens.js'
import { colorForEventType } from '../event-highlights.js'
import { useEventKindResolver } from '../../../../data/use-event-kind-resolver.js'
import type { DetailDetection } from './cluster-detail.js'

type IconComponent = React.ComponentType<{ size: number; color: string }>

function iconForClass(className: string): IconComponent {
  const lower = className.toLowerCase()
  if (lower === 'person' || lower === 'face') return User
  if (['car', 'truck', 'bus', 'vehicle', 'motorcycle', 'bicycle'].includes(lower)) return Car
  if (lower === 'dog' || lower === 'cat' || lower === 'animal') return Dog
  if (lower === 'bird') return Bird
  return HelpCircle
}

export interface DetectionMetaListProps {
  readonly detections: readonly DetailDetection[]
}

export const DetectionMetaList = memo(function DetectionMetaList({
  detections,
}: DetectionMetaListProps) {
  const { colors } = useTheme()
  // `d.className` and the tier-1 `d.label` (a sub-class like `van` — see
  // `ObjectEventSchema`'s tiered-label model on the server) are TAXONOMY and go
  // through the resolver. `DetailDetection` carries no tier-2 identity field at
  // all, so there is nothing here that must stay verbatim.
  const resolver = useEventKindResolver()

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      {detections.map((d) => {
        const color = colorForEventType(d.className)
        const Icon = iconForClass(d.className)
        const pct = typeof d.confidence === 'number' ? `${Math.round(d.confidence * 100)}%` : null
        return (
          <View key={d.id} style={[styles.row, { borderColor: colors.border }]}>
            <View style={[styles.iconBox, { backgroundColor: color + '1A' }]}>
              <Icon size={16} color={color} />
            </View>
            <View style={styles.body}>
              <View style={styles.titleRow}>
                <Text style={[styles.className, { color: colors.foreground }]}>
                  {resolver.resolveLabel(d.className)}
                </Text>
                {d.label ? (
                  <Text style={[styles.label, { color: colors.foregroundMuted }]}>
                    · {resolver.resolveLabel(d.label)}
                  </Text>
                ) : null}
                {pct ? <Text style={[styles.conf, { color }]}>{pct}</Text> : null}
              </View>
              {(d.zones.length > 0 || d.state) ? (
                <View style={styles.chipsRow}>
                  {d.state ? (
                    <View style={[styles.chip, { borderColor: colors.border }]}>
                      <Text style={[styles.chipText, { color: colors.foregroundMuted }]}>{d.state}</Text>
                    </View>
                  ) : null}
                  {d.zones.map((z) => (
                    <View key={z} style={[styles.chip, { borderColor: color + '66', backgroundColor: color + '14' }]}>
                      <Text style={[styles.chipText, { color }]}>{z}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        )
      })}
    </ScrollView>
  )
})

const styles = StyleSheet.create({
  list: { flexGrow: 0 },
  listContent: { gap: SPACING.xs, paddingVertical: SPACING.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBox: { width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  className: { fontSize: 14, fontWeight: '600' },
  label: { fontSize: 13 },
  conf: { fontSize: 12, fontWeight: '700', marginLeft: 'auto', fontVariant: ['tabular-nums'] },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: { paddingHorizontal: SPACING.xs + 1, paddingVertical: 1, borderRadius: RADIUS.sm, borderWidth: 1 },
  chipText: { fontSize: 10, fontWeight: '600' },
})
