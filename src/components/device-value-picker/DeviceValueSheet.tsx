/**
 * The device → value picker as a phone sheet (issue #496, "Flow · Phone"):
 * page 1 is the device list (search, facets, suggestions first); a device
 * with several matching values pushes page 2, its values, with Back in the
 * header. Back finds page 1 exactly as it was — the list's state lives here,
 * above both pages.
 *
 * A single field closes on the pick. A multi field edits a draft: ✓ toggles,
 * "Done (N)" saves — enabled only once the draft differs from the saved
 * value — and ✕ discards.
 */
import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { DeviceSearchItem, DeviceSearchRequires } from '@camstack/types'

import { Check, ChevronLeft, X } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { PickerSheet, PickerSheetButton } from '../ui/PickerSheet.js'
import { capabilityListLabel } from './capability-label.js'
import { toggleValue, valueKey, type PickedValue, type PickKind } from './device-value-picker-model.js'
import { DeviceValueList } from './DeviceValueList.js'
import { ValuesPage } from './DeviceValueRows.js'
import { useDeviceValueBrowse } from './use-device-value-browse.js'
import { useRecentDevices } from './recent-devices-store.js'

const UI = 'v2.deviceValuePicker'

/** What a field asks the picker for — shared by the sheet, the inline list and the field. */
export interface DeviceValueAsk {
  /** The capabilities the field needs; absent = any device. */
  readonly requires?: DeviceSearchRequires
  /** A whole device, or one of its values. */
  readonly kind: PickKind
  readonly contextDeviceId?: number
  readonly fixedTypes?: readonly string[]
  readonly excludeIds?: readonly number[]
  readonly excludeTypes?: readonly string[]
  /** The recents' key; absent = this field remembers nothing. */
  readonly recentKey?: string
  /** A caller's extra fact for a row's second line. */
  readonly detailOf?: (item: DeviceSearchItem) => string | null
}

export interface DeviceValueSheetProps extends DeviceValueAsk {
  readonly title?: string
  /** Under the title; default (multi): how many are selected. */
  readonly subtitle?: string
  readonly multiple: boolean
  readonly value: readonly PickedValue[]
  readonly onChange: (next: readonly PickedValue[]) => void
  readonly onClose: () => void
  readonly testID?: string
}

/** Whether two selections hold the same values, in any order. */
export function sameSelection(a: readonly PickedValue[], b: readonly PickedValue[]): boolean {
  const keys = new Set(a.map(valueKey))
  return keys.size === new Set(b.map(valueKey)).size && b.every((v) => keys.has(valueKey(v)))
}

export function DeviceValueSheet({
  title,
  subtitle,
  multiple,
  value,
  onChange,
  onClose,
  testID = 'dvp-sheet',
  ...ask
}: DeviceValueSheetProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const recents = useRecentDevices(ask.recentKey)
  const [draft, setDraft] = useState<readonly PickedValue[]>(value)
  const [drilled, setDrilled] = useState<DeviceSearchItem | null>(null)
  const caps = ask.requires?.caps ?? []
  const browse = useDeviceValueBrowse({
    ...(ask.requires !== undefined ? { requires: ask.requires } : {}),
    ...(ask.contextDeviceId !== undefined ? { contextDeviceId: ask.contextDeviceId } : {}),
    ...(ask.fixedTypes !== undefined ? { fixedTypes: ask.fixedTypes } : {}),
    ...(ask.excludeIds !== undefined ? { excludeIds: ask.excludeIds } : {}),
    ...(ask.excludeTypes !== undefined ? { excludeTypes: ask.excludeTypes } : {}),
    recentIds: recents.ids,
    enabled: true,
  })

  const pick = (next: PickedValue): void => {
    recents.push(next.deviceId)
    if (!multiple) {
      onChange([next])
      onClose()
      return
    }
    setDraft((d) => toggleValue(d, next))
  }

  const sheetTitle =
    drilled !== null
      ? drilled.name
      : (title ??
        (caps.length > 0
          ? capabilityListLabel(caps, (key, o) => t(key, o), t(`${UI}.or`))
          : t(`${UI}.title`)))

  const close = multiple ? (
    <View style={styles.buttons}>
      <PickerSheetButton onPress={onClose} label={t('v2.common.cancel')}>
        <X size={18} color={colors.foreground} />
      </PickerSheetButton>
      <PickerSheetButton
        onPress={() => {
          onChange(draft)
          onClose()
        }}
        label={t(`${UI}.doneCount`, { count: draft.length })}
        primary
        disabled={sameSelection(draft, value)}
      >
        <Check size={18} color={colors.primaryForeground} />
      </PickerSheetButton>
    </View>
  ) : (
    <PickerSheetButton onPress={onClose} label={t('v2.common.close')}>
      <X size={18} color={colors.foreground} />
    </PickerSheetButton>
  )

  return (
    <PickerSheet
      title={sheetTitle}
      {...(subtitle !== undefined
        ? { subtitle }
        : multiple
          ? { subtitle: t(`${UI}.selectedCount`, { count: draft.length }) }
          : {})}
      onClose={onClose}
      testID={testID}
      headerLeft={
        drilled !== null ? (
          <PickerSheetButton onPress={() => setDrilled(null)} label={t('v2.common.back')}>
            <ChevronLeft size={18} color={colors.foreground} />
          </PickerSheetButton>
        ) : undefined
      }
      headerRight={close}
    >
      {drilled !== null ? (
        <ValuesPage item={drilled} multiple={multiple} picked={draft} onPick={pick} />
      ) : (
        <DeviceValueList
          browse={browse}
          caps={caps}
          kind={ask.kind}
          multiple={multiple}
          picked={multiple ? draft : value}
          onPick={pick}
          onDrill={setDrilled}
          {...(ask.detailOf !== undefined ? { detailOf: ask.detailOf } : {})}
        />
      )}
    </PickerSheet>
  )
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
})
