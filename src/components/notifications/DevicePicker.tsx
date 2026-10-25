/**
 * DevicePicker — ONE compact picker for every device selection in the rule
 * editors (D636): a rule's devices, a system rule's include / exclude, the
 * timelapse and digest cameras (the alarm's openings are a sensor table, D697).
 *
 * The long checklists it replaces took the whole screen to say "two cameras".
 * This shows the SELECTION as chips (removable, every one drawn) and opens a
 * searchable, grouped, virtualised sheet
 * (`DevicePickerSheet`) only to change it — the rendering is `ItemPicker`,
 * which this file feeds with a SOURCE (below) and a verdict per id — the same UX as the camera's
 * accessory picker, whose sheet frame it shares (`ui/PickerSheet.tsx`), and as
 * the admin UI's `DevicePicker` (the decisions are `device-picker-model.ts`,
 * byte-identical in both).
 *
 * WHERE THE LIST COMES FROM ({@link DevicePickerSource}):
 *  - `cameras` — the camera list the app already holds (`useCameras`, hidden
 *    included: hiding a camera on this phone does not remove it from a rule);
 *  - `fleet` — every device, read ONLY while the sheet is open
 *    (`useDeviceCatalogue(open)`): a system rule's batteries and consumables
 *    belong to sensors and vacuums, not cameras;
 *  - `caps` — the devices bound to one of these caps: ONE ids-only read
 *    (`useDeviceIdsByCaps`), unioned with a SECOND one when `extraCapNames`
 *    is given, then the rows of just those ids (`useDevicesByIds`). A SENSOR
 *    rule's devices are its sensors PLUS every camera (fix round 1,
 *    2026-10-01 — a camera-scoped sensor rule is legitimate, D630 §6) —
 *    `rule-device-source.ts`.
 * It never reads more than that. A selected id the list does not hold is
 * resolved by a TARGETED `listAll({ deviceIds })` (`useDevicesByIds`), only
 * for those ids.
 *
 * What a selected id IS — named, "Device #<id> — removed", or "Device #<id>" —
 * is `device-selection.ts` (D315: only an ANSWERED list may call an id
 * removed; D49: a read never drops one, every chip is removable). A pending
 * camera list is a loading line, never the "applies to all" hint; emptying an
 * all-meaning selection that held devices warns, seeded from the SAVED rule
 * (`savedHadDevices`) so a sub-screen round trip does not forget it.
 *
 * "Group by" (Zone | Location | None) is this picker's alone — the node and
 * package pickers have none. The choice is remembered on the device
 * (`device-picker-group-store`), and the site zones are read while the sheet is
 * open, in every mode — the Zone filter needs them too (`usePickerZonesRead`).
 * A failure is kept as a failure: the sheet then groups by location, pauses a
 * chosen zone filter, and says why (D315).
 */
import React, { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { SPACING } from '../../theme/tokens.js'
import { useCameras } from '../../data/use-cameras.js'
import { useDevicesByIds } from '../../data/use-devices-by-ids.js'
import { useDeviceIdsByCaps } from '../../data/use-device-ids-by-caps.js'
import { useDeviceCatalogue } from '../../accessories/use-device-catalogue.js'
import { usePickerZonesRead } from '../../data/use-site-zones.js'
import { useDevicePickerGroupStore } from '../../store/device-picker-group-store.js'
import type { PickerCandidate } from '../../data/linked-device-picker.js'
import type { PickerDevice, PickerGroupBy } from './device-picker-model.js'
import type { PickerGroupingControl } from './DevicePickerSheet.js'
import {
  deviceListStateOf,
  emptyDevicesWidens,
  offListSelections,
  showsNoCamerasHint,
  type DeviceListState,
  type SelectedDeviceRow,
} from './device-selection.js'
import { ItemPicker, PickerLine } from './ItemPicker.js'

const UI = 'v2.nc.rules.editor'

/** Where the picker's list comes from — see the file header. */
export type DevicePickerSource =
  | { readonly kind: 'cameras' }
  | { readonly kind: 'fleet' }
  | {
      readonly kind: 'caps'
      readonly capNames: readonly string[]
      /**
       * A second `listDeviceIdsByCaps` query, unioned into the first — a
       * sensor rule's camera-streams query, kept separate because
       * `listDeviceIdsByCaps` takes at most 16 names and `EVENTFUL_CAP_NAMES`
       * is already exactly 16 (`rule-device-source.ts`).
       */
      readonly extraCapNames?: readonly string[]
      /**
       * Which noun the "no devices" / "unavailable" / widening wording uses —
       * independent of HOW the list is fetched. Defaults to `'sensor'`
       * (every current non-rule `'caps'` source is sensor/control openings);
       * a rule whose kind targets cameras but fetches by capability
       * (`rule-device-source.ts`: `detection` / `occupancy` / `sound`) passes
       * `'camera'` so its picker reads exactly like the plain `'cameras'`
       * source it replaced.
       */
      readonly subject?: 'camera' | 'sensor'
    }

/** True for a source whose empty/unavailable/widening wording should read as
 *  a CAMERA scope — the literal `'cameras'` source, or a `'caps'` source
 *  explicitly marked `subject: 'camera'`. */
function isCameraWorded(source: DevicePickerSource): boolean {
  return source.kind === 'cameras' || (source.kind === 'caps' && source.subject === 'camera')
}

export interface DevicePickerProps {
  readonly value: readonly number[]
  readonly onChange: (next: number[]) => void
  readonly source: DevicePickerSource
  /** Empty means ALL devices (a rule's devices, a system filter). */
  readonly emptyMeansAll?: boolean
  /** Whether the SAVED rule had devices here — the widening warning survives a remount. */
  readonly savedHadDevices?: boolean
  /** What an empty selection reads as, where it does not mean "every device". */
  readonly emptyLabel?: string
  /** The sheet's title. */
  readonly title?: string
  readonly disabled?: boolean
  readonly testID?: string
}

/** The list a source answers, and whether it answered. */
interface PickerList {
  readonly devices: readonly PickerDevice[] | undefined
  readonly state: DeviceListState
}

/** No caps asked: the by-caps read stays disabled. */
const NO_CAPS: readonly string[] = []

/** A slim device row as the picker lists it, its container as the second line. */
function pickerDevicesOf(rows: readonly PickerCandidate[]): readonly PickerDevice[] {
  const names = new Map(rows.map((row) => [row.id, row.name]))
  return rows.map((row) => {
    const parent = row.parentDeviceId !== null ? names.get(row.parentDeviceId) : undefined
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      location: row.location,
      ...(parent !== undefined ? { detail: parent } : {}),
    }
  })
}

/**
 * The `caps` source: the bound ids — unioned with a SECOND query's ids when
 * `extraCapNames` is given (a sensor rule's camera-streams query, kept apart
 * from `capNames` because `listDeviceIdsByCaps` takes at most 16 names) —
 * then their rows. Answered only when EVERY query answered — an answered
 * empty id list is an answered empty list, with nothing more to read; a
 * failed step is a failure, never "none" (D315).
 */
function useCapsList(
  capNames: readonly string[],
  extraCapNames: readonly string[] | undefined,
  enabled: boolean,
): PickerList {
  const hasExtra = enabled && (extraCapNames?.length ?? 0) > 0
  const ids = useDeviceIdsByCaps(capNames, enabled)
  const extraIds = useDeviceIdsByCaps(extraCapNames ?? NO_CAPS, hasExtra)
  const unionIds = useMemo(() => {
    if (ids.data === undefined) return undefined
    if (!hasExtra) return ids.data
    if (extraIds.data === undefined) return undefined
    return [...new Set([...ids.data, ...extraIds.data])]
  }, [ids.data, extraIds.data, hasExtra])
  const rows = useDevicesByIds(unionIds ?? [])
  const devices = useMemo(
    () => (rows.data === undefined ? undefined : pickerDevicesOf(rows.data)),
    [rows.data],
  )
  if (unionIds === undefined) {
    const failed = ids.isError || (hasExtra && extraIds.isError)
    return { devices: undefined, state: failed ? 'failed' : 'pending' }
  }
  if (unionIds.length === 0) return { devices: [], state: 'answered' }
  return { devices, state: deviceListStateOf(rows) }
}

function useSourceList(source: DevicePickerSource, open: boolean): PickerList {
  const cameras = useCameras({ includeHidden: true })
  const catalogue = useDeviceCatalogue(source.kind === 'fleet' && open)
  const caps = useCapsList(
    source.kind === 'caps' ? source.capNames : NO_CAPS,
    source.kind === 'caps' ? source.extraCapNames : undefined,
    source.kind === 'caps',
  )
  const fleet = useMemo(
    (): readonly PickerDevice[] | undefined =>
      catalogue.data === undefined ? undefined : pickerDevicesOf(catalogue.data),
    [catalogue.data],
  )
  if (source.kind === 'caps') return caps
  if (source.kind === 'fleet') return { devices: fleet, state: deviceListStateOf(catalogue) }
  const cams = cameras.data?.map((cam) => ({
    id: cam.id,
    name: cam.name,
    type: cam.type,
    location: cam.location,
  }))
  return { devices: cams, state: deviceListStateOf(cameras) }
}

/** The sheet's "Group by": the remembered mode and, in Zone mode while open, the zone read. */
function useGroupingControl(open: boolean): PickerGroupingControl {
  const groupBy = useDevicePickerGroupStore((s) => s.groupBy)
  const setGroupBy = useDevicePickerGroupStore((s) => s.setGroupBy)
  const hydrate = useDevicePickerGroupStore((s) => s.hydrate)
  useEffect(() => {
    void hydrate()
  }, [hydrate])
  const zones = usePickerZonesRead(open)
  return useMemo(
    () => ({ groupBy, onGroupByChange: (next: PickerGroupBy) => setGroupBy(next), zones }),
    [groupBy, setGroupBy, zones],
  )
}

export function DevicePicker({
  value,
  onChange,
  source,
  emptyMeansAll = false,
  savedHadDevices = false,
  emptyLabel,
  title,
  disabled = false,
  testID,
}: DevicePickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [hadDevices, setHadDevices] = useState(savedHadDevices || value.length > 0)
  if (value.length > 0 && !hadDevices) setHadDevices(true)

  const list = useSourceList(source, open)
  const grouping = useGroupingControl(open)
  const listed = list.state === 'answered' ? list.devices : undefined
  const listedIds = new Set((listed ?? []).map((device) => device.id))
  // Who can name an off-list id: an ANSWERED list's gaps are asked by id; the
  // fleet source (not read while closed) asks for every selected id; a FAILED
  // camera list asks nothing more of a sick hub (D315).
  const readsWhenOpen = source.kind === 'fleet'
  const askIds =
    listed !== undefined ? value.filter((id) => !listedIds.has(id)) : readsWhenOpen ? value : []
  const lookup = useDevicesByIds(askIds)
  const lookupState = deviceListStateOf(lookup)
  const judged: readonly SelectedDeviceRow[] =
    listed !== undefined || readsWhenOpen
      ? offListSelections(value, listed, lookup.data, lookupState)
      : offListSelections(value, undefined, undefined, 'failed')
  const widening = emptyDevicesWidens(emptyMeansAll, value.length, hadDevices)

  const cameraWorded = isCameraWorded(source)
  if (cameraWorded && list.state === 'pending') {
    return <PickerLine text={t(`${UI}.devicesLoading`)} />
  }
  const cameraCount = listed?.length ?? 0
  if (cameraWorded && showsNoCamerasHint(list.state, cameraCount, value.length)) {
    return (
      <View style={{ gap: SPACING.sm }} testID={testID}>
        <PickerLine text={t(emptyMeansAll ? `${UI}.noCameras` : `${UI}.noCamerasRequired`)} />
        {widening ? <PickerLine text={t(`${UI}.devicesEmptyWidens`)} warning /> : null}
      </View>
    )
  }

  return (
    <ItemPicker<number>
      items={list.devices}
      state={list.state}
      judged={judged}
      value={value}
      onChange={onChange}
      emptyMeansAll={emptyMeansAll}
      savedHadDevices={hadDevices}
      disabled={disabled}
      removedLabel={(id) => t(`${UI}.deviceRemoved`, { id })}
      unknownLabel={(id) => t(`${UI}.deviceUnknown`, { id })}
      onOpenChange={setOpen}
      grouping={grouping}
      {...(emptyLabel !== undefined ? { emptyLabel } : {})}
      {...(title !== undefined ? { title } : {})}
      {...(testID !== undefined ? { testID } : {})}
      {...(source.kind === 'caps' && !cameraWorded
        ? { widensLabel: t(`${UI}.sensorsEmptyWidens`), unavailableLabel: t(`${UI}.sensorsUnavailable`) }
        : {})}
      {...(cameraWorded && list.state === 'failed' ? { notice: t(`${UI}.devicesUnavailable`) } : {})}
      {...(source.kind === 'caps' && !cameraWorded && list.state === 'failed'
        ? { notice: t(`${UI}.sensorsUnavailable`) }
        : {})}
    />
  )
}
