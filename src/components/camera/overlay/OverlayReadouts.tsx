/**
 * OverlayReadouts — the operator's pinned values, drawn over the picture.
 *
 * Each readout is one entry of the stream's overlay stack (`OverlayStack`),
 * at the corner it is assigned to, laid out with the other overlays of that
 * corner. Non-interactive by construction (`pointerEvents="none"` on every
 * chip): the picture underneath owns pinch, pan, and the single tap that
 * reveals the controls, and a chip that swallowed a tap would break the
 * gesture in the one place the operator is most likely to aim — a corner.
 *
 * Data comes in two shapes and this component fetches BOTH, once each:
 *   • the live dBFS, off the audio-inference event stream (per second);
 *   • device live-info fields, one poll per DEVICE regardless of how many chips
 *     read from it — the readouts are grouped by device id before fetching, so
 *     four sensors on one thermostat cost one request.
 */
import React, { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'

import {
  formatLiveValue,
  useDeviceLiveFields,
  type DeviceLiveField,
} from '../../../data/use-device-live-fields.js'
import {
  isOverlayShown,
  readoutsForCamera,
  type OverlayConfig,
  type OverlayReadout,
} from './overlay-config.js'
import { useStyleScaler } from './OverlayFrame.js'
import type { OverlayStackEntry } from './OverlayStack.js'
import { useTheme } from '../../../theme/theme-provider.js'

export interface UseReadoutEntriesInput {
  /** The camera the stream shows — the device a `cameraField` reads from. */
  readonly deviceId: number
  readonly config: OverlayConfig
  /** Draw only while the picture is live and visible — a chip over a frozen
   *  frame reports a value that does not belong to what is on screen. */
  readonly enabled: boolean
  /** The auto-hiding controls are showing (what a readout's `fade` follows). */
  readonly controlsVisible: boolean
}

/** The device a readout reads its field from, or null for the audio level. */
function sourceDeviceId(r: OverlayReadout, cameraDeviceId: number): number | null {
  if (r.source.kind === 'deviceField') return r.source.deviceId
  if (r.source.kind === 'cameraField') return cameraDeviceId
  return null
}

/** The device ids the config's readouts read from, de-duplicated. */
export function readoutDeviceIds(config: OverlayConfig, cameraDeviceId: number): readonly number[] {
  const ids = new Set<number>()
  for (const r of readoutsForCamera(config.readouts, cameraDeviceId)) {
    const id = sourceDeviceId(r, cameraDeviceId)
    if (id !== null) ids.add(id)
  }
  return [...ids]
}


/**
 * One device's live fields, subscribed once and handed to every chip that reads
 * from it. A component rather than a hook call in a loop because the number of
 * devices changes as the operator edits the config, and hooks cannot be called
 * conditionally.
 */
/** Stable empty catalogue — `data ?? []` would mint a NEW array identity every
 *  render while the query has no data, and the probe's effect (keyed on the
 *  fields identity) would then set state on each render: an update loop. */
const NO_FIELDS: readonly DeviceLiveField[] = []

/** Match a stored readout to a catalogue row (`cap-status` keys may be `cap` or `cap:path`). */
export function matchDeviceLiveField(
  fields: readonly DeviceLiveField[],
  sectionId: string,
  fieldKey: string,
): DeviceLiveField | undefined {
  return fields.find((f) => f.sectionId === sectionId && f.key === fieldKey)
}

function DeviceFieldsProbe({
  deviceId,
  enabled,
  onFields,
}: {
  readonly deviceId: number
  readonly enabled: boolean
  readonly onFields: (deviceId: number, fields: readonly DeviceLiveField[]) => void
}): null {
  const { data } = useDeviceLiveFields(deviceId, enabled)
  const fields = data ?? NO_FIELDS
  React.useEffect(() => {
    onFields(deviceId, fields)
  }, [deviceId, fields, onFields])
  return null
}

function ReadoutChip({ label, value }: { readonly label: string; readonly value: string }) {
  const { colors } = useTheme()
  const sx = useStyleScaler()
  return (
    <View style={[sx(styles.chip), { backgroundColor: `${colors.background}8C` }]} pointerEvents="none">
      <Text style={[sx(styles.chipLabel), { color: colors.foregroundMuted }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[sx(styles.chipValue), { color: colors.foreground }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

/**
 * The stack entries of the operator's pinned readouts, plus the probes that
 * feed them (render `probes` anywhere inside the frame — they draw nothing).
 */
export function useReadoutEntries({
  deviceId,
  config,
  enabled,
  controlsVisible,
}: UseReadoutEntriesInput): {
  readonly entries: readonly OverlayStackEntry[]
  readonly probes: React.ReactNode
} {
  const { t } = useTranslation()
  const deviceIds = useMemo(() => readoutDeviceIds(config, deviceId), [config, deviceId])
  const [byDevice, setByDevice] = React.useState<Readonly<Record<number, readonly DeviceLiveField[]>>>(
    {},
  )
  const onFields = React.useCallback((id: number, fields: readonly DeviceLiveField[]) => {
    setByDevice((prev) => (prev[id] === fields ? prev : { ...prev, [id]: fields }))
  }, [])

  const valueFor = React.useCallback(
    (r: OverlayReadout): string => {
      const source = sourceDeviceId(r, deviceId)
      const fields = source === null ? [] : (byDevice[source] ?? [])
      const match = matchDeviceLiveField(fields, r.source.sectionId, r.source.fieldKey)
      if (!match) return '—'
      const opts: { precision?: number; unit?: string; onLabel: string; offLabel: string } = {
        onLabel: t('v2.common.on'),
        offLabel: t('v2.common.off'),
      }
      const precision = r.precision ?? match.precision
      if (precision !== undefined) opts.precision = precision
      const unit = r.unit ?? match.unit
      if (unit !== undefined) opts.unit = unit
      return formatLiveValue(match.value, opts)
    },
    [byDevice, deviceId, t],
  )

  const entries = useMemo<readonly OverlayStackEntry[]>(
    () =>
      !enabled
        ? []
        : readoutsForCamera(config.readouts, deviceId)
            .filter((r) => isOverlayShown(config, `readout:${r.id}`, controlsVisible))
            .map((r) => ({
              id: `readout:${r.id}` as const,
              anchor: r.corner,
              node: <ReadoutChip label={r.label} value={valueFor(r)} />,
            })),
    [enabled, config, deviceId, controlsVisible, valueFor],
  )
  const probes = enabled
    ? deviceIds.map((id) => (
        <DeviceFieldsProbe key={id} deviceId={id} enabled={enabled} onFields={onFields} />
      ))
    : null
  return { entries, probes }
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  chipLabel: { fontSize: 10, fontWeight: '600' },
  // Tabular figures so a value ticking between 9 and 10 does not shift the chip.
  chipValue: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
})
