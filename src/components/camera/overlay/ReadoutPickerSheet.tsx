/**
 * ReadoutPickerSheet — pick a live value to pin on the stream overlay.
 *
 * Opened from the view-options readouts section ("Aggiungi"); replaces the
 * former inline expand. Device chips (this camera + linked), search, and a
 * scrollable field list — including audio dBFS for the camera itself.
 */
import React, { memo, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Plus, X } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { PickerSheet, PickerSheetButton } from '../../ui/PickerSheet.js'
import { useDeviceLiveFields, type DeviceLiveField } from '../../../data/use-device-live-fields.js'
import type { OverlayReadoutSource } from './overlay-config.js'

export interface ReadoutPickerSheetProps {
  readonly visible: boolean
  readonly cameraDeviceId: number
  readonly linkedDevices: readonly { readonly id: number; readonly name: string }[]
  readonly onPin: (
    source: OverlayReadoutSource,
    label: string,
    unit?: string,
    precision?: number,
  ) => void
  readonly onClose: () => void
}

interface PickerTarget {
  readonly deviceId: number
  readonly name: string
}

function fieldMatchesQuery(field: DeviceLiveField, query: string): boolean {
  if (query.length === 0) return true
  const q = query.toLowerCase()
  return field.label.toLowerCase().includes(q) || field.sectionTitle.toLowerCase().includes(q)
}

export const ReadoutPickerSheet = memo(function ReadoutPickerSheet({
  visible,
  cameraDeviceId,
  linkedDevices,
  onPin,
  onClose,
}: ReadoutPickerSheetProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [target, setTarget] = useState<PickerTarget>(() => ({
    deviceId: cameraDeviceId,
    name: t('v2.overlay.thisCamera'),
  }))
  const [query, setQuery] = useState('')

  const { data: fields = [] } = useDeviceLiveFields(target.deviceId, visible)

  const filteredFields = useMemo(
    () => fields.filter((f) => fieldMatchesQuery(f, query.trim())),
    [fields, query],
  )

  if (!visible) return null

  const pinField = (f: DeviceLiveField): void => {
    onPin(
      { kind: 'deviceField', deviceId: target.deviceId, sectionId: f.sectionId, fieldKey: f.key },
      f.label,
      f.unit,
      f.precision,
    )
  }

  return (
    <PickerSheet
      testID="readout-picker-sheet"
      title={t('v2.overlay.addReadout')}
      onClose={onClose}
      headerRight={
        <PickerSheetButton onPress={onClose} label={t('v2.common.close')}>
          <X size={18} color={colors.foreground} />
        </PickerSheetButton>
      }
      search={{
        value: query,
        onChange: setQuery,
        placeholder: t('v2.common.search', 'Search'),
      }}
    >
      <View style={styles.deviceRow}>
        <DeviceChip
          label={t('v2.overlay.thisCamera')}
          active={target.deviceId === cameraDeviceId}
          onPress={() => setTarget({ deviceId: cameraDeviceId, name: t('v2.overlay.thisCamera') })}
        />
        {linkedDevices.map((d) => (
          <DeviceChip
            key={d.id}
            label={d.name}
            active={target.deviceId === d.id}
            onPress={() => setTarget({ deviceId: d.id, name: d.name })}
          />
        ))}
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
        {target.deviceId === cameraDeviceId ? (
          <FieldRow
            label={t('v2.overlay.audioDbfs')}
            caption="dBFS"
            onPress={() => onPin({ kind: 'audioDbfs' }, t('v2.overlay.audioDbfs'), 'dBFS', 1)}
          />
        ) : null}
        {filteredFields.length === 0 ? (
          <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>
            {t('v2.overlay.noFields')}
          </Text>
        ) : null}
        {filteredFields.map((f) => (
          <FieldRow
            key={`${f.sectionId}:${f.key}`}
            label={f.label}
            caption={f.sectionTitle}
            onPress={() => pinField(f)}
          />
        ))}
      </ScrollView>
    </PickerSheet>
  )
})

function DeviceChip({
  label,
  active,
  onPress,
}: {
  readonly label: string
  readonly active: boolean
  readonly onPress: () => void
}): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: active ? colors.primary : colors.border },
        active ? { backgroundColor: colors.primary + '22' } : null,
      ]}
    >
      <Text
        style={[styles.chipText, { color: active ? colors.primary : colors.foregroundMuted }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function FieldRow({
  label,
  caption,
  onPress,
}: {
  readonly label: string
  readonly caption: string
  readonly onPress: () => void
}): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.fieldRow}>
      <View style={styles.fieldText}>
        <Text style={[styles.fieldLabel, { color: colors.foreground }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.fieldCaption, { color: colors.foregroundSubtle }]} numberOfLines={1}>
          {caption}
        </Text>
      </View>
      <Plus size={16} color={colors.primary} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  deviceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { fontSize: 11, fontWeight: '600', maxWidth: 140 },
  list: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg, gap: 2 },
  hint: { fontSize: 11, paddingVertical: SPACING.xs },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 5 },
  fieldText: { flex: 1 },
  fieldLabel: { fontSize: 13, fontWeight: '500' },
  fieldCaption: { fontSize: 10 },
})
