/**
 * ActionDevicePicker — the device a Do step acts on, out of EVERY device on the
 * hub (a siren, a switch, a panel — not only cameras), searched inline.
 *
 * The fleet listing (`useDeviceCatalogue`, ~433 KB slim) is read only once this
 * sub-screen has a Do step to label or the operator opens the search — never in
 * the background. The list drawn is bounded and SAYS how many it left out, so a
 * device that is not in the first page is never mistaken for one the hub lacks.
 * A listing that failed says so; it is not an empty hub (D315). A picked device
 * the ANSWERED listing lacks is labelled removed and kept until changed (D49).
 */
import React, { useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useDeviceCatalogue } from '../../../../../accessories/use-device-catalogue.js'
import {
  boundOptions,
  buildPickerGroups,
  filterPickerGroups,
  pickerOptionsInOrder,
  resolvePickedOptions,
} from '../../../../../data/linked-device-picker.js'
import {
  deviceListStateOf,
  resolveSelectedDevices,
} from '../../../../../components/notifications/device-selection.js'
import { useTheme } from '../../../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../../../theme/tokens.js'
import { ActionTextField } from './action-controls.js'

const EDITOR = 'v2.nc.rules.editor'
const UI = `${EDITOR}.actions`
const SHOWN_LIMIT = 30
const NO_FILTER = { excludeDeviceId: null, excludeTypes: [] } as const

export interface ActionDevicePickerProps {
  readonly deviceId: number | undefined
  readonly onPick: (deviceId: number) => void
}

export function ActionDevicePicker({ deviceId, onPick }: ActionDevicePickerProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [open, setOpen] = useState(deviceId === undefined)
  const [query, setQuery] = useState('')
  const catalogue = useDeviceCatalogue(true)
  const candidates = catalogue.data

  // A step device the fleet no longer has is NAMED removed — only from a
  // listing that answered (D315) — and kept until the operator changes it (D49).
  const pickedRow =
    deviceId === undefined
      ? undefined
      : resolveSelectedDevices([deviceId], candidates, deviceListStateOf(catalogue))[0]
  const pickedLabel =
    deviceId === undefined
      ? t(`${UI}.deviceNone`)
      : pickedRow?.removed === true
        ? t(`${EDITOR}.deviceRemoved`, { id: deviceId })
        : (resolvePickedOptions(candidates ?? [], [deviceId])[0]?.label ?? `#${deviceId}`)
  const pickedColor =
    deviceId === undefined
      ? colors.foregroundSubtle
      : pickedRow?.removed === true
        ? colors.warning
        : colors.foreground

  const bounded = useMemo(() => {
    if (candidates === undefined) return undefined
    const groups = filterPickerGroups(buildPickerGroups(candidates, NO_FILTER, null), query)
    return boundOptions(pickerOptionsInOrder(groups), SHOWN_LIMIT)
  }, [candidates, query])

  const status = (text: string) => (
    <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }}>{text}</Text>
  )

  return (
    <View style={{ gap: SPACING.sm }}>
      <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '500' }}>{t(`${UI}.deviceLabel`)}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.md }}>
        <Text
          style={{ color: pickedColor, fontSize: 15, flex: 1 }}
        >
          {pickedLabel}
        </Text>
        {!open ? (
          <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
            <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>{t(`${UI}.deviceChange`)}</Text>
          </Pressable>
        ) : null}
      </View>
      {open ? (
        <View style={{ gap: SPACING.sm }}>
          <ActionTextField
            value={query}
            onChangeText={setQuery}
            placeholder={t(`${UI}.deviceSearchPlaceholder`)}
            accessibilityLabel={t(`${UI}.deviceSearchPlaceholder`)}
          />
          {catalogue.isError ? status(t(`${UI}.deviceUnavailable`)) : null}
          {bounded === undefined && !catalogue.isError ? status(t(`${UI}.deviceLoading`)) : null}
          {bounded !== undefined && bounded.shown.length === 0 ? status(t(`${UI}.deviceNoMatch`)) : null}
          {bounded?.shown.map((option) => (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected: option.id === deviceId }}
              onPress={() => {
                onPick(option.id)
                setOpen(false)
                setQuery('')
              }}
              style={{
                paddingVertical: SPACING.md,
                paddingHorizontal: SPACING.lg,
                borderRadius: RADIUS.md,
                backgroundColor: option.id === deviceId ? colors.background : 'transparent',
              }}
            >
              <Text style={{ color: colors.foreground, fontSize: 15 }}>{option.label}</Text>
              <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }}>{option.description}</Text>
            </Pressable>
          ))}
          {bounded !== undefined && bounded.hidden > 0
            ? status(t(`${UI}.deviceMore`, { count: bounded.hidden }))
            : null}
        </View>
      ) : null}
    </View>
  )
}
