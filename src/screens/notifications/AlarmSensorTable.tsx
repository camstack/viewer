/**
 * One arm mode's sensor table (D697): what each opening reads NOW, whether the
 * arm check looks at it, and the switch that says whether it blocks arming.
 * The phone's counterpart of the admin UI's `alarm-sensor-table.tsx`.
 *
 * What a row says and what its switch writes is decided in
 * `alarm-sensor-table-model.ts` (byte-identical to the admin's); this file
 * only draws it.
 *
 *  - Drawn with the same pieces as the other Notification Center tabs: each
 *    sensor is a shared `ToggleRow` (its switch is the "blocks arming" switch)
 *    inside the mode's `Section` card, the filter bar is the shared
 *    `DeviceFilterBar`, a long list is paged with "Show more". The viewer has
 *    no table and no width mode: a phone is the only layout, so there is
 *    nothing to collapse into cards.
 *  - The switch ON means "blocks arming". A press sends ONE edit for ONE device
 *    (`onSwitch`) — the screen owns the write and refuses a second one while
 *    one is in flight (said by name), so this table never builds a list.
 *  - D315: a state cell says "Checking…" until the sensors read ANSWERED; a
 *    failed read says so (once above the rows, with a retry unless the hub is
 *    too old to have the read); "closed" is only ever a reading. The zone is
 *    named only from an ANSWERED zones read — never "No zone".
 *  - Q2 (operator, 2026-10-02): a sensor no rule of the mode covers is not a row
 *    (the model drops it). The exception is an uncovered sensor the mode's
 *    non-blocking list still holds: drawn muted and labelled, its switch usable,
 *    so the stored entry can be removed (D49).
 *  - D49: a listed id the device list no longer holds is still a row
 *    ("Removed"), so it can be switched off the list.
 */
import React, { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { AlarmArmMode } from '@camstack/types'

import { ToggleRow } from '../../components/ui/ToggleRow.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { DeviceFilterBar } from '../../components/notifications/DeviceFilterBar.js'
import {
  type AlarmCoverageCell,
  type AlarmSensorCell,
  type AlarmSensorRow,
  type AlarmSwitchWrite,
} from '../../components/notifications/alarm-sensor-table-model.js'
import {
  applyPickerFilters,
  flattenPickerGrouping,
  groupPickerDevicesBy,
  pageRows,
  pickerFacetOptions,
  pickerLocationKey,
  PICKER_NO_FILTERS,
  PICKER_PAGE_SIZE,
  type PickerFilters,
  type PickerGroupHeading,
  type PickerZonesRead,
} from '../../components/notifications/device-picker-model.js'
import { deviceTypeLabel, deviceTypeLabelKey } from '../../components/notifications/rule-editor.js'

const UI = 'v2.nc.alarm.table'

type Translate = (key: string, options?: Record<string, unknown>) => string

export interface AlarmSensorTableProps {
  readonly mode: AlarmArmMode
  readonly rows: readonly AlarmSensorRow[]
  /** The write in flight anywhere on the screen (one at a time across modes). */
  readonly inFlight: AlarmSwitchWrite | null
  readonly onSwitch: (
    row: AlarmSensorRow,
    kind: 'blocks' | 'secureOnArm',
    nextValue: boolean,
  ) => void
  readonly zones: PickerZonesRead
  readonly disabled: boolean
}

/**
 * "Zona giorno · Sala" — the zone only from an ANSWERED zones read (D315); the
 * location alone otherwise; null for a device with no location.
 */
export function zoneLocationLabel(
  location: string | null | undefined,
  zones: PickerZonesRead,
): string | null {
  const place = location?.trim() ?? ''
  if (place === '') return null
  if (zones.state === 'answered') {
    const key = pickerLocationKey(place)
    const zone = zones.zones.find((z) => z.locationKeys.includes(key))
    if (zone !== undefined) return `${zone.label} · ${place}`
  }
  return place
}

function sensorWords(cell: AlarmSensorCell, t: Translate): string {
  switch (cell.kind) {
    case 'checking':
      return t(`${UI}.state.checking`)
    case 'hub-too-old':
      return t(`${UI}.state.hubTooOld`)
    case 'read-failed':
      return t(`${UI}.state.readFailed`, { error: cell.error })
    case 'open':
    case 'closed':
      return cell.offline ? t(`${UI}.state.offline`, { word: cell.word }) : cell.word
    case 'unknown':
      return cell.why === 'not-answered'
        ? t(`${UI}.state.unknownNotAnswered`)
        : cell.why === 'read-failed'
          ? t(`${UI}.state.unknownReadFailed`)
          : t(`${UI}.state.unknownWord`)
    case 'not-opening':
      return t(`${UI}.state.notOpening`)
    case 'removed':
      return t(`${UI}.state.removed`)
  }
}

function coverageWords(row: AlarmSensorRow, t: Translate): string {
  if (row.listedUncovered) return t(`${UI}.coverage.listedUncovered`)
  return coverageCellWords(row.coverage, t)
}

function coverageCellWords(cell: AlarmCoverageCell, t: Translate): string {
  switch (cell.kind) {
    case 'arm-checked':
      return t(`${UI}.coverage.armChecked`)
    case 'arm-checked-skipped':
      return t(`${UI}.coverage.armCheckedSkipped`, { reason: t(`v2.nc.alarm.skipReason.${cell.reason}`) })
    case 'unscoped':
      return t(`${UI}.coverage.unscoped`)
    case 'not-covered':
      return t(`${UI}.coverage.notCovered`)
  }
}

function headingTitle(heading: PickerGroupHeading, t: Translate): string {
  switch (heading.kind) {
    case 'zone':
    case 'location':
      return heading.label
    case 'no-zone':
      return t('v2.nc.devicePicker.groupBy.noZone')
    case 'no-location':
      return t('v2.nc.devicePicker.groupBy.noLocation')
  }
}

interface SensorRowViewProps {
  readonly props: AlarmSensorTableProps
  readonly row: AlarmSensorRow
  /** No rule or footer follows it inside the card: drop the hairline. */
  readonly last: boolean
}

/** The state line's colour: a reading that needs attention reads as such. */
function stateTone(cell: AlarmSensorCell): 'warning' | 'muted' {
  switch (cell.kind) {
    case 'open':
    case 'read-failed':
    case 'hub-too-old':
    case 'removed':
      return 'warning'
    case 'closed':
    case 'checking':
    case 'unknown':
    case 'not-opening':
      return 'muted'
  }
}

function SensorRowView({ props, row, last }: SensorRowViewProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { mode, inFlight, onSwitch, zones, disabled } = props
  const id = row.device.id
  const muted = row.listedUncovered
  const blocksBusy =
    inFlight !== null &&
    inFlight.mode === mode &&
    inFlight.deviceId === id &&
    inFlight.kind === 'blocks'
  const secureBusy =
    inFlight !== null &&
    inFlight.mode === mode &&
    inFlight.deviceId === id &&
    inFlight.kind === 'secureOnArm'
  const waiting = inFlight !== null && !blocksBusy && !secureBusy
  const type = row.device.type
  const place = [
    zoneLocationLabel(row.device.location, zones),
    type !== undefined && type !== '' ? t(deviceTypeLabelKey(type), { defaultValue: deviceTypeLabel(type) }) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
  const key = `${mode}-${String(id)}`
  const showSecure = row.controllable
  return (
    <View testID={`alarm-row-${key}`}>
      <ToggleRow
        label={row.device.name}
        {...(place !== '' ? { description: place, descriptionTestID: `alarm-cell-place-${key}` } : {})}
        value={row.blocks}
        // Not `disabled` while another write runs: a press is still answered BY NAME.
        disabled={disabled}
        {...(muted || waiting ? { opacity: muted ? 0.6 : 0.5 } : {})}
        haptic="action"
        last={!showSecure && last}
        switchTestID={`alarm-switch-blocks-${key}`}
        switchAccessibilityLabel={t(`${UI}.switchLabel`, { name: row.device.name, defaultValue: `Blocks arming: ${row.device.name}` })}
        accessory={blocksBusy ? <ActivityIndicator size="small" color={colors.foregroundSubtle} /> : undefined}
        onValueChange={(next) => onSwitch(row, 'blocks', next)}
        detail={
          <>
            <Text
              testID={`alarm-cell-state-${key}`}
              style={{ color: stateTone(row.cell) === 'warning' ? colors.warning : colors.foregroundMuted, fontSize: 13 }}
            >
              {sensorWords(row.cell, t)}
            </Text>
            <Text testID={`alarm-cell-coverage-${key}`} style={{ color: colors.foregroundSubtle, fontSize: 12 }}>
              {coverageWords(row, t)}
            </Text>
          </>
        }
      />
      {showSecure ? (
        <ToggleRow
          label={t(`${UI}.secureOnArm`, { defaultValue: 'Secure on arm' })}
          value={row.secureOnArm}
          disabled={disabled}
          {...(muted || waiting ? { opacity: muted ? 0.6 : 0.5 } : {})}
          haptic="action"
          last={last}
          switchTestID={`alarm-switch-secure-${key}`}
          switchAccessibilityLabel={t(`${UI}.secureSwitchLabel`, {
            name: row.device.name,
            defaultValue: `Secure on arm: ${row.device.name}`,
          })}
          accessory={secureBusy ? <ActivityIndicator size="small" color={colors.foregroundSubtle} /> : undefined}
          onValueChange={(next) => onSwitch(row, 'secureOnArm', next)}
        />
      ) : null}
    </View>
  )
}

export function AlarmSensorTable(props: AlarmSensorTableProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { mode, rows, zones, disabled } = props
  const [filters, setFilters] = useState<PickerFilters>(PICKER_NO_FILTERS)
  const [shown, setShown] = useState(PICKER_PAGE_SIZE)
  const devices = useMemo(() => rows.map((r) => r.device), [rows])
  const matches = useMemo(() => applyPickerFilters(devices, filters, zones), [devices, filters, zones])
  // One list sorted by name — never split by zone or room (operator, 2026-10-02).
  const grouped = useMemo(() => groupPickerDevicesBy(matches, [], 'none', zones), [matches, zones])
  // Every group open: a table is read whole, not folded.
  const flat = useMemo(() => flattenPickerGrouping(grouped, [], new Map(), true), [grouped])
  const rowById = useMemo(() => new Map(rows.map((r) => [r.device.id, r])), [rows])
  const typeOptions = useMemo(
    () => pickerFacetOptions(devices, 'type', filters.types, zones),
    [devices, filters.types, zones],
  )
  const zoneOptions = useMemo(
    () => pickerFacetOptions(devices, 'zone', filters.zones, zones),
    [devices, filters.zones, zones],
  )
  const locationOptions = useMemo(
    () => pickerFacetOptions(devices, 'location', filters.locations, zones),
    [devices, filters.locations, zones],
  )
  const page = pageRows(flat, shown)
  const hidden = rows.length - matches.length

  const lastKey = page.rows.at(-1)?.key
  const footerFollows = hidden > 0 || page.remaining > 0
  return (
    <View testID={`alarm-sensors-${mode}`}>
      <View style={{ gap: SPACING.sm, paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md }}>
        <DeviceFilterBar
          filters={filters}
          onFiltersChange={(next) => {
            setFilters(next)
            setShown(PICKER_PAGE_SIZE)
          }}
          typeOptions={typeOptions}
          zoneOptions={zoneOptions}
          locationOptions={locationOptions}
          zones={zones}
          searchPlaceholder={t(`${UI}.searchPlaceholder`)}
          disabled={disabled}
        />
        {flat.length === 0 ? (
          <Text style={{ color: colors.foregroundSubtle, fontSize: 13, fontStyle: 'italic' }}>
            {t(`${UI}.noMatches`)}
          </Text>
        ) : null}
      </View>
      {page.rows.map((r) => {
        if (r.kind === 'header') {
          const heading = r.group.heading
          return (
            <Text
              key={r.key}
              testID="alarm-group-header"
              style={{
                color: colors.foregroundSubtle,
                fontSize: 12,
                fontWeight: '600',
                paddingHorizontal: SPACING.xl,
                paddingVertical: SPACING.sm,
              }}
            >
              {heading === undefined ? r.group.key : headingTitle(heading, t)}
            </Text>
          )
        }
        const row = rowById.get(r.device.id)
        return row === undefined ? null : (
          <SensorRowView key={r.key} props={props} row={row} last={r.key === lastKey && !footerFollows} />
        )
      })}
      {footerFollows ? (
        <View style={{ gap: SPACING.sm, padding: SPACING.xl }}>
          {hidden > 0 ? (
            <Text testID="alarm-rows-hidden" style={{ color: colors.foregroundSubtle, fontSize: 12 }}>
              {t(`${UI}.hidden`, { count: hidden })}
            </Text>
          ) : null}
          {page.remaining > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShown((n) => n + PICKER_PAGE_SIZE)}
              style={{
                alignItems: 'center',
                paddingVertical: SPACING.sm,
                borderRadius: RADIUS.md,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: colors.foregroundSubtle, fontSize: 13 }}>
                {t(`${UI}.showMore`, {
                  count: Math.min(page.remaining, PICKER_PAGE_SIZE),
                  left: page.remaining,
                })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}
