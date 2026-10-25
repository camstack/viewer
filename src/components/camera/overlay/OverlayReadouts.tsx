/**
 * OverlayReadouts — the operator's pinned values, drawn over the picture.
 *
 * Four absolutely-positioned corner stacks, each holding the readouts assigned
 * to it. Non-interactive by construction (`pointerEvents="none"` on the root and
 * on every chip): the picture underneath owns pinch, pan, and the single tap
 * that reveals the controls, and a chip that swallowed a tap would break the
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

import { useAudioLevel } from '../../../data/use-audio.js'
import {
  formatLiveValue,
  useDeviceLiveFields,
  type DeviceLiveField,
} from '../../../data/use-device-live-fields.js'
import { readoutsAt, type CameraOverlayConfig, type OverlayReadout } from './overlay-config.js'
import { ANCHOR_PLACEMENT, OVERLAY_ANCHORS } from './overlay-position.js'
import { useStyleScaler } from './OverlayFrame.js'
import { useTheme } from '../../../theme/theme-provider.js'

export interface OverlayReadoutsProps {
  readonly deviceId: number
  readonly config: CameraOverlayConfig
  /** Draw only while the picture is live and visible — a chip over a frozen
   *  frame reports a value that does not belong to what is on screen. */
  readonly enabled: boolean
}

/** The device ids the config's readouts refer to, de-duplicated. */
export function readoutDeviceIds(config: CameraOverlayConfig): readonly number[] {
  const ids = new Set<number>()
  for (const r of config.readouts) {
    if (r.source.kind === 'deviceField') ids.add(r.source.deviceId)
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

export function OverlayReadouts({ deviceId, config, enabled }: OverlayReadoutsProps) {
  const { t } = useTranslation()
  const sx = useStyleScaler()
  const deviceIds = useMemo(() => readoutDeviceIds(config), [config])
  const [byDevice, setByDevice] = React.useState<Readonly<Record<number, readonly DeviceLiveField[]>>>(
    {},
  )
  const onFields = React.useCallback((id: number, fields: readonly DeviceLiveField[]) => {
    setByDevice((prev) => (prev[id] === fields ? prev : { ...prev, [id]: fields }))
  }, [])

  // The audio chip is the only source that is not a device field, and it is the
  // one the operator asked for by name ("il db/rms correnti").
  const wantsAudio = config.readouts.some((r) => r.source.kind === 'audioDbfs')
  const dbfs = useAudioLevel(deviceId, enabled && wantsAudio)

  const valueFor = React.useCallback(
    (r: OverlayReadout): string => {
      if (r.source.kind === 'audioDbfs') {
        if (dbfs === null || !Number.isFinite(dbfs)) return '—'
        return formatLiveValue(dbfs, {
          precision: r.precision ?? 1,
          unit: r.unit ?? 'dBFS',
          onLabel: t('v2.common.on'),
          offLabel: t('v2.common.off'),
        })
      }
      const fields = byDevice[r.source.deviceId] ?? []
      const match =
        r.source.kind === 'deviceField'
          ? matchDeviceLiveField(fields, r.source.sectionId, r.source.fieldKey)
          : undefined
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
    [byDevice, dbfs, t],
  )

  if (!enabled || config.readouts.length === 0) return null

  return (
    <>
      {deviceIds.map((id) => (
        <DeviceFieldsProbe key={id} deviceId={id} enabled={enabled} onFields={onFields} />
      ))}
      {OVERLAY_ANCHORS.map((corner) => {
        const items = readoutsAt(config, corner)
        if (items.length === 0) return null
        return (
          <View key={corner} pointerEvents="none" style={[sx(styles.stack), ANCHOR_PLACEMENT[corner]]}>
            {items.map((r) => (
              <ReadoutChip key={r.id} label={r.label} value={valueFor(r)} />
            ))}
          </View>
        )
      })}
    </>
  )
}

const styles = StyleSheet.create({
  stack: { position: 'absolute', gap: 4 },
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
