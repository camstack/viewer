/**
 * Read-mostly accessory controls ported from admin-ui: firmware `update`
 * (version transition + Install action), read-only `weather` + `image` display
 * rows, and the generic HA `control` input (input_number / input_select /
 * input_text / input_datetime).
 *
 * Cap methods (verbatim):
 *   - update: installUpdate() — node-scoped singleton (no deviceId on the wire);
 *     the row shows the version transition + an Install pill when `updatable`.
 *   - control: setValue({ control: { kind, value } }) — a discriminated union.
 *     Numeric → stepper, select → cycle; text/datetime render read-only (inline
 *     free-text / date-picker editing isn't a compact-row affordance).
 *   - weather / image: methods:{} — pure read-only rows.
 */
import React, { useCallback } from 'react'
import { View, Text, Image, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ChevronUp, ChevronDown, Download, RefreshCw, Zap } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { useCapMutator } from '../../../data/use-accessory-controls.js'
import {
  useUpdateStatus, useWeatherStatus, useImageStatus, useControlStatus,
  useEventEmitterStatus,
} from '../../../data/use-accessory-controls-ext.js'
import { PillButton, IconButton, ControlSpinner } from './control-atoms.js'
import { stepValue, nextInList } from './numeric-logic.js'
import {
  channelIndexOf, clearFlash, composeEventLabel, formatEventAgo, nextFlashState,
  IDLE_FLASH, type FlashState,
} from './event-emitter-logic.js'
import type { AccessoryControlProps } from './controls.js'

const NUM_MIN_DEFAULT = 0
const NUM_MAX_DEFAULT = 100
const NUM_STEP_DEFAULT = 1

// ── Update (version transition + Install) ─────────────────────────────────────

export function UpdateControl({ deviceId, online }: AccessoryControlProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const status = useUpdateStatus(deviceId, online)
  const mutator = useCapMutator(deviceId)
  const data = status.data
  const install = useCallback(async () => {
    await mutator.run('update', 'installUpdate', {})
    void status.refetch()
  }, [mutator, status])
  if (status.isLoading && !data) return <ControlSpinner />
  const disabled = !online || mutator.pending || (data?.inProgress ?? false)
  if (data?.updatable) {
    return (
      <PillButton
        label={data.inProgress ? t('v2.accessories.installing') : t('v2.accessories.install')}
        icon={data.inProgress ? RefreshCw : Download}
        active
        disabled={disabled}
        onPress={() => void install()}
      />
    )
  }
  // Up to date / unknown → read-only current version.
  return (
    <Text style={[styles.readonly, { color: colors.foregroundMuted }]} numberOfLines={1}>
      {data?.currentVersion ?? t('v2.accessories.upToDate')}
    </Text>
  )
}

// ── Weather (read-only) ───────────────────────────────────────────────────────

export function WeatherControl({ deviceId, online }: AccessoryControlProps) {
  const { colors } = useTheme()
  const status = useWeatherStatus(deviceId, online)
  const data = status.data
  if (status.isLoading && !data) return <ControlSpinner />
  if (!data) return null
  const temp = data.temperature !== null ? `${Math.round(data.temperature)}${data.temperatureUnit ?? '°'}` : ''
  const text = [temp, data.condition ?? ''].filter((s) => s.length > 0).join(' · ')
  if (!text) return null
  return (
    <Text style={[styles.readonly, { color: colors.foreground }]} numberOfLines={1}>
      {text}
    </Text>
  )
}

// ── Image (read-only thumbnail) ───────────────────────────────────────────────

export function ImageControl({ deviceId, online }: AccessoryControlProps) {
  const { colors } = useTheme()
  const status = useImageStatus(deviceId, online)
  const url = status.data?.url ?? null
  if (status.isLoading && !status.data) return <ControlSpinner />
  if (!url) return null
  return (
    <Image
      source={{ uri: url }}
      style={[styles.thumb, { borderColor: colors.border }]}
      resizeMode="cover"
      accessibilityIgnoresInvertColors
    />
  )
}

// ── Control (HA input: numeric stepper / select cycle / read-only text) ───────

export function InputControl({ deviceId, online }: AccessoryControlProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const status = useControlStatus(deviceId, online)
  const mutator = useCapMutator(deviceId)
  const data = status.data

  const adjustNumeric = useCallback(
    async (direction: 1 | -1) => {
      if (!data || typeof data.value !== 'number') return
      const next = stepValue(
        data.value,
        direction,
        data.step ?? NUM_STEP_DEFAULT,
        data.min ?? NUM_MIN_DEFAULT,
        data.max ?? NUM_MAX_DEFAULT,
      )
      await mutator.run('control', 'setValue', { control: { kind: 'numeric', value: next } })
      void status.refetch()
    },
    [mutator, data, status],
  )
  const cycleSelect = useCallback(async () => {
    if (!data || typeof data.value !== 'string' || data.options.length === 0) return
    const next = nextInList(data.value, data.options)
    if (next === data.value) return
    await mutator.run('control', 'setValue', { control: { kind: 'select', value: next } })
    void status.refetch()
  }, [mutator, data, status])

  if (status.isLoading && !data) return <ControlSpinner />
  if (!data) return null
  const disabled = !online || mutator.pending

  if (data.kind === 'numeric' && typeof data.value === 'number') {
    const unit = data.unit ? ` ${data.unit}` : ''
    return (
      <View style={styles.cluster}>
        <IconButton icon={ChevronDown} label={t('v2.accessories.decrease')} disabled={disabled} onPress={() => void adjustNumeric(-1)} />
        <Text style={[styles.readout, { color: colors.foreground }]} numberOfLines={1}>
          {`${data.value}${unit}`}
        </Text>
        <IconButton icon={ChevronUp} label={t('v2.accessories.increase')} disabled={disabled} onPress={() => void adjustNumeric(1)} />
      </View>
    )
  }
  if (data.kind === 'select' && typeof data.value === 'string') {
    return (
      <PillButton
        label={data.value || t('v2.accessories.select')}
        active
        disabled={disabled || data.options.length <= 1}
        onPress={() => void cycleSelect()}
      />
    )
  }
  // text / datetime — read-only in the compact row.
  return (
    <Text style={[styles.readonly, { color: colors.foreground }]} numberOfLines={1}>
      {String(data.value)}
    </Text>
  )
}

// ── Event emitter (read-only: what the button last fired) ────────────────────

/** How long the row stays highlighted after a press. */
const FLASH_MS = 1_500
/** How often the "3s" age re-renders while the row is on screen. */
const AGE_TICK_MS = 1_000

/**
 * Event-emitter row — a wall switch / remote / scene controller. There is
 * nothing to press FROM here: the device is a pure input, so the row reports
 * its last fire (button · event type · age) and lights up when a new one
 * arrives.
 *
 * Cap-derived, not vendor-derived: the event type is whatever the device
 * declared, VERBATIM, and the button index is read from the optional
 * `data.channel` (absent → the event type alone). The live update rides the
 * `event-emitter.event` invalidation wired in `use-live-invalidation.ts`; the
 * slow `useCapStatus` reconcile is the D8 backstop behind it.
 */
export function EventEmitterControl({ deviceId, online }: AccessoryControlProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const status = useEventEmitterStatus(deviceId, online)
  const last = status.data?.lastEvent ?? null
  const seq = last?.seq ?? null

  // Adjusted DURING render, not in an effect: `nextFlashState` is identity-stable
  // for an unchanged `seq`, so the extra pass runs only on a real press — the
  // pattern React documents for "state derived from a changed input", and the
  // one that keeps the highlight from arriving a frame late.
  const [flashState, setFlashState] = React.useState<FlashState>(IDLE_FLASH)
  const flash = nextFlashState(flashState, seq)
  if (flash !== flashState) setFlashState(flash)

  React.useEffect(() => {
    if (!flash.flashing) return
    const timer = setTimeout(() => {
      setFlashState(clearFlash)
    }, FLASH_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [flash.flashing])

  // The age is derived from a fixed timestamp — without its own tick nothing
  // would ever re-render "3s" into "4s".
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!last) return
    const id = setInterval(() => {
      setNow(Date.now())
    }, AGE_TICK_MS)
    return () => {
      clearInterval(id)
    }
  }, [last])

  if (status.isLoading && !status.data) return <ControlSpinner />
  if (!last) {
    return (
      <Text style={[styles.readonly, { color: colors.foregroundMuted }]} numberOfLines={1}>
        {t('v2.accessories.noEvent')}
      </Text>
    )
  }

  const channel = channelIndexOf(last.data)
  const buttonLabel = channel === null ? null : t('v2.accessories.buttonIndex', { index: channel })
  const label = composeEventLabel(buttonLabel, last.eventType, formatEventAgo(last.timestamp, now))
  const tint = flash.flashing ? colors.primary : colors.foreground

  return (
    <View style={styles.cluster}>
      <Zap size={14} color={tint} />
      <Text style={[styles.event, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  cluster: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  readout: { fontSize: 12, fontWeight: '600', minWidth: 40, textAlign: 'center' },
  readonly: { fontSize: 14, fontWeight: '600' },
  event: { fontSize: 12, fontWeight: '600', maxWidth: 190 },
  thumb: { width: 44, height: 28, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth },
})
