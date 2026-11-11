/**
 * The rows the device → value picker draws: a section heading, a device row,
 * and the value page (page 2) of a device with several matching values.
 *
 * A device row is a FINAL pick when the device offers one value (its reading
 * on the right) or the field wants a whole device; it is a drill (›) when it
 * offers several and the field wants one of them. In a multi field a tap
 * toggles ✓ instead of closing. A device that does not provide the asked
 * capability is drawn dimmed and is not pressable.
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { DeviceSearchItem, DeviceValueOption } from '@camstack/types'

import { Check, ChevronRight } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, TABULAR, TYPOGRAPHY } from '../../theme/tokens.js'
import { deviceTypeLabel, deviceTypeLabelKey } from '../notifications/rule-editor.js'
import {
  isPicked,
  pickedCountOfDevice,
  pickFromOption,
  pickFromRow,
  rowMode,
  type ListSection,
  type PickedValue,
  type PickKind,
} from './device-value-picker-model.js'

const UI = 'v2.deviceValuePicker'

/** One row's height (pt): rows are fixed so the list can lay itself out without measuring. */
export const DEVICE_VALUE_ROW_HEIGHT = 56

/** The words of a device type: the locale's when it has one, else the type made readable. */
export function useDeviceTypeLabel(): (type: string) => string {
  const { t } = useTranslation()
  return (type) => t(deviceTypeLabelKey(type), { defaultValue: deviceTypeLabel(type) })
}

export function SectionHeading({ section }: { readonly section: ListSection }): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const typeLabel = useDeviceTypeLabel()
  const text =
    section.kind === 'suggested'
      ? t(`${UI}.suggested`)
      : section.kind === 'recent'
        ? t(`${UI}.recent`)
        : typeLabel(section.heading ?? '')
  return (
    <Text
      testID={`dvp-section-${section.id}`}
      accessibilityRole="header"
      style={[styles.heading, { color: colors.foregroundMuted }]}
    >
      {text.toUpperCase()}
    </Text>
  )
}

/** The second line of a device row: room · integration, and offline when it is. */
function rowDetail(item: DeviceSearchItem, offline: string): string | null {
  const parts = [item.location, item.integrationLabel ?? item.integrationId].filter(
    (p): p is string => p !== null && p.length > 0,
  )
  if (item.online === false) parts.push(offline)
  return parts.length > 0 ? parts.join(' · ') : null
}

export interface DeviceRowProps {
  readonly item: DeviceSearchItem
  readonly kind: PickKind
  readonly multiple: boolean
  readonly picked: readonly PickedValue[]
  readonly onPick: (value: PickedValue) => void
  readonly onDrill: (item: DeviceSearchItem) => void
  /** A caller's extra fact about the device (a container's name), shown on the second line. */
  readonly detail?: string | null
}

export function DeviceRow({
  item,
  kind,
  multiple,
  picked,
  onPick,
  onDrill,
  detail,
}: DeviceRowProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const mode = rowMode(item, kind)
  const value = mode === 'pick' ? pickFromRow(item, kind) : null
  const selected =
    value !== null ? isPicked(picked, value) : pickedCountOfDevice(picked, item.id) > 0
  const sole = mode === 'pick' && kind === 'value' ? item.values[0] : undefined
  const second =
    mode === 'drill'
      ? t(`${UI}.valuesCount`, { count: item.values.length })
      : [detail ?? null, rowDetail(item, t(`${UI}.offline`))].filter((p): p is string => p !== null).join(' · ')
  const inert = !item.compatible || item.disabled
  return (
    <Pressable
      testID={`dvp-row-${String(item.id)}`}
      accessibilityRole={multiple && mode === 'pick' ? 'checkbox' : 'button'}
      accessibilityState={{ checked: multiple ? selected : undefined, selected, disabled: inert }}
      accessibilityLabel={item.name}
      disabled={inert}
      onPress={() => {
        if (mode === 'drill') onDrill(item)
        else if (value !== null) onPick(value)
      }}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: colors.borderSubtle,
          backgroundColor: pressed ? colors.surfaceHover : selected ? `${colors.primary}14` : 'transparent',
          opacity: inert ? 0.4 : 1,
        },
      ]}
    >
      {multiple && mode === 'pick' ? <CheckBox checked={selected} /> : null}
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.name, { color: colors.foreground }]}>
          {item.name}
        </Text>
        {second.length > 0 ? (
          <Text numberOfLines={1} style={[styles.sub, { color: colors.foregroundSubtle }]}>
            {second}
          </Text>
        ) : null}
      </View>
      {sole !== undefined ? <Reading option={sole} /> : null}
      {mode === 'drill' && multiple && pickedCountOfDevice(picked, item.id) > 0 ? (
        <Text style={[styles.badge, { color: colors.primary }]}>
          {String(pickedCountOfDevice(picked, item.id))}
        </Text>
      ) : null}
      {mode === 'drill' ? <ChevronRight size={18} color={colors.foregroundSubtle} /> : null}
      {!multiple && mode === 'pick' && selected ? <Check size={18} color={colors.primary} /> : null}
    </Pressable>
  )
}

/** A value's live reading; nothing when it is unknown (never 0). */
function Reading({ option }: { readonly option: DeviceValueOption }): React.JSX.Element | null {
  const { colors } = useTheme()
  if (option.reading === null) return null
  return (
    <Text numberOfLines={1} style={[styles.reading, TABULAR, { color: colors.foregroundMuted }]}>
      {option.reading}
    </Text>
  )
}

function CheckBox({ checked }: { readonly checked: boolean }): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View
      style={[
        styles.box,
        {
          borderColor: checked ? colors.primary : colors.border,
          backgroundColor: checked ? colors.primary : 'transparent',
        },
      ]}
    >
      {checked ? <Check size={12} color={colors.primaryForeground} /> : null}
    </View>
  )
}

export interface ValuesPageProps {
  readonly item: DeviceSearchItem
  readonly multiple: boolean
  readonly picked: readonly PickedValue[]
  readonly onPick: (value: PickedValue) => void
}

/** Page 2: only the asked capability's values of one device, each with its reading. */
export function ValuesPage({ item, multiple, picked, onPick }: ValuesPageProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View testID="dvp-values-page">
      <Text style={[styles.caption, { color: colors.foregroundMuted }]}>{t(`${UI}.chooseValue`)}</Text>
      {item.values.map((option) => {
        const value = pickFromOption(item, option)
        const selected = isPicked(picked, value)
        return (
          <Pressable
            key={`${option.cap}|${option.path}`}
            testID={`dvp-value-${option.cap}-${option.path}`}
            accessibilityRole={multiple ? 'checkbox' : 'button'}
            accessibilityState={{ checked: multiple ? selected : undefined, selected }}
            accessibilityLabel={option.label}
            onPress={() => onPick(value)}
            style={({ pressed }) => [
              styles.row,
              {
                borderBottomColor: colors.borderSubtle,
                backgroundColor: pressed ? colors.surfaceHover : selected ? `${colors.primary}14` : 'transparent',
              },
            ]}
          >
            {multiple ? <CheckBox checked={selected} /> : null}
            <Text numberOfLines={1} style={[styles.name, styles.rowText, { color: colors.foreground }]}>
              {option.label}
            </Text>
            <Reading option={option} />
            {!multiple && selected ? <Check size={18} color={colors.primary} /> : null}
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  badge: { fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.bold },
  box: {
    width: 18,
    height: 18,
    borderRadius: RADIUS.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    fontSize: TYPOGRAPHY.size.sm,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  heading: {
    fontSize: TYPOGRAPHY.size.xs,
    fontWeight: TYPOGRAPHY.weight.medium,
    letterSpacing: 0.6,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  name: { fontSize: TYPOGRAPHY.size.md },
  reading: { fontSize: TYPOGRAPHY.size.md, maxWidth: '40%' },
  row: {
    minHeight: DEVICE_VALUE_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
  },
  rowText: { flex: 1, minWidth: 0, justifyContent: 'center' },
  sub: { fontSize: TYPOGRAPHY.size.sm },
})
