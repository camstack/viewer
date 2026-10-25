/**
 * Per-cap COMPACT inline accessory controls (RN, lucide, camstack theme).
 *
 * Each control:
 *   - reads its cap status via the matching hook (refetch ~5s)
 *   - renders a compact, state-aware affordance on the row's right edge
 *   - mutates the cap on interaction via `useCapMutator`, disabling itself
 *     while the call is in-flight, then refetching status
 *
 * Offline accessories pass `online === false`; controls render disabled.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  Power, Lock, LockOpen, ChevronUp, ChevronDown, Square,
  Sun, Fan, Wind, Zap, RotateCw,
} from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import {
  useSwitchStatus, useBrightnessStatus, useLockStatus, useCoverStatus,
  useSensorValue, useCapMutator,
  useClimateStatus, useFanStatus,
} from '../../../data/use-accessory-controls.js'
import {
  NO_SETPOINT, buildModeOptions, formatSetpoint, formatTemp, setpointModel,
  setpointWrite, stepSetpoint, type SetpointModel,
} from './climate-logic.js'
import { createTrailingCommit, type TrailingCommit } from './trailing-commit.js'
import { FAN_DEFAULT_STEP, stepPercentage } from './fan-logic.js'
import { formatCoverPosition } from './cover-position.js'
import { PillButton, IconButton, ControlSpinner, OptionPicker, StepperArrows } from './control-atoms.js'

export interface AccessoryControlProps {
  readonly deviceId: number
  /** False when the accessory is offline — controls render disabled. */
  readonly online: boolean
}

const BRIGHTNESS_STEP = 20

// ── Switch (generic on/off — also non-dimmable lights & sirens) ───────────────

export function SwitchControl({ deviceId, online }: AccessoryControlProps) {
  const { t } = useTranslation()
  const status = useSwitchStatus(deviceId, online)
  const mutator = useCapMutator(deviceId)
  const on = status.data?.on ?? false
  const toggle = useCallback(async () => {
    await mutator.run('switch', 'setState', { on: !on })
    void status.refetch()
  }, [mutator, on, status])
  if (status.isLoading && !status.data) return <ControlSpinner />
  return (
    <PillButton
      label={on ? t('v2.accessories.on') : t('v2.accessories.off')}
      icon={Power}
      active={on}
      disabled={!online || mutator.pending}
      // The generic switch is what a SIREN renders as (control-registry maps
      // DeviceType.Siren -> 'switch'), so this one carries the heavier weight.
      haptic="action"
      onPress={() => void toggle()}
    />
  )
}

// ── Brightness (dimmable light: on/off + −/+ level) ──────────────────────────

export function BrightnessControl({ deviceId, online }: AccessoryControlProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const brightness = useBrightnessStatus(deviceId, online)
  // A dimmable light also exposes `switch` for true on/off; read it for state.
  const sw = useSwitchStatus(deviceId, online)
  const mutator = useCapMutator(deviceId)
  const level = brightness.data?.percentage ?? 0
  const on = sw.data?.on ?? level > 0

  const setLevel = useCallback(
    async (next: number) => {
      const clamped = Math.max(0, Math.min(100, next))
      await mutator.run('brightness', 'setBrightness', { percentage: clamped })
      void brightness.refetch()
      void sw.refetch()
    },
    [mutator, brightness, sw],
  )
  const toggle = useCallback(async () => {
    await mutator.run('switch', 'setState', { on: !on })
    void sw.refetch()
    void brightness.refetch()
  }, [mutator, on, sw, brightness])

  if (brightness.isLoading && !brightness.data) return <ControlSpinner />
  const disabled = !online || mutator.pending
  return (
    <View style={styles.cluster}>
      <IconButton
        icon={Sun}
        label={on ? t('v2.accessories.off') : t('v2.accessories.on')}
        active={on}
        disabled={disabled}
        onPress={() => void toggle()}
      />
      <IconButton
        icon={ChevronDown}
        label={t('v2.accessories.dimDown')}
        disabled={disabled}
        onPress={() => void setLevel(level - BRIGHTNESS_STEP)}
      />
      <Text style={[styles.readout, { color: colors.foregroundMuted }]} numberOfLines={1}>
        {`${Math.round(level)}%`}
      </Text>
      <IconButton
        icon={ChevronUp}
        label={t('v2.accessories.dimUp')}
        disabled={disabled}
        onPress={() => void setLevel(level + BRIGHTNESS_STEP)}
      />
    </View>
  )
}

// ── Lock (lock / unlock) ──────────────────────────────────────────────────────

export function LockControl({ deviceId, online }: AccessoryControlProps) {
  const { t } = useTranslation()
  const status = useLockStatus(deviceId, online)
  const mutator = useCapMutator(deviceId)
  const state = status.data?.state ?? 'unlocked'
  const transitioning = state === 'locking' || state === 'unlocking'
  const locked = state === 'locked'
  const run = useCallback(
    async (method: 'lock' | 'unlock') => {
      await mutator.run('lockControl', method, {})
      void status.refetch()
    },
    [mutator, status],
  )
  if (status.isLoading && !status.data) return <ControlSpinner />
  const disabled = !online || mutator.pending || transitioning
  return (
    <View style={styles.cluster}>
      <PillButton
        label={t('v2.accessories.lock')}
        icon={Lock}
        active={locked}
        disabled={disabled}
        haptic="action"
        onPress={() => void run('lock')}
      />
      <PillButton
        label={t('v2.accessories.unlock')}
        icon={LockOpen}
        active={!locked}
        disabled={disabled}
        haptic="action"
        onPress={() => void run('unlock')}
      />
    </View>
  )
}

// ── Cover & Valve (open / stop / close) ───────────────────────────────────────

export interface PositionControlProps extends AccessoryControlProps {
  /** `cover` or `valve` — both share the open/close/stop method surface. */
  readonly capKey: 'cover' | 'valve'
}

export function CoverControl({ deviceId, online, capKey }: PositionControlProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  // valve status shape ⊆ cover status (state + position) — useCoverStatus guards
  // both safely (it only requires state ∈ lifecycle + optional position).
  const status = useCoverStatus(deviceId, online)
  const mutator = useCapMutator(deviceId)
  const state = status.data?.state ?? 'stopped'
  const run = useCallback(
    async (method: 'open' | 'close' | 'stop') => {
      await mutator.run(capKey, method, {})
      void status.refetch()
    },
    [mutator, status, capKey],
  )
  if (status.isLoading && !status.data) return <ControlSpinner />
  const disabled = !online || mutator.pending
  // How far open, when the hardware reports it. A shutter that only opens and
  // closes has no intermediate surface and shows nothing here — `null` is not
  // "0 % open". Direction is the cap's, verbatim (0 closed → 100 open), the
  // same number admin-ui prints.
  const openPct = formatCoverPosition(status.data?.position)
  return (
    <View style={styles.cluster}>
      {openPct !== null ? (
        <Text
          style={[styles.coverPct, { color: colors.foregroundMuted }]}
          numberOfLines={1}
          accessibilityLabel={t('v2.accessories.openPercent', { percent: openPct })}
        >
          {openPct}
        </Text>
      ) : null}
      <IconButton
        icon={ChevronUp}
        label={t('v2.accessories.open')}
        active={state === 'open' || state === 'opening'}
        // The move takes ten to twenty seconds, and until it ends this button
        // is the only evidence the command landed.
        pulsing={state === 'opening'}
        disabled={disabled}
        onPress={() => void run('open')}
      />
      <IconButton
        icon={Square}
        label={t('v2.accessories.stop')}
        disabled={disabled}
        onPress={() => void run('stop')}
      />
      <IconButton
        icon={ChevronDown}
        label={t('v2.accessories.close')}
        active={state === 'closed' || state === 'closing'}
        pulsing={state === 'closing'}
        disabled={disabled}
        onPress={() => void run('close')}
      />
    </View>
  )
}

// ── Alarm — see `controls-alarm.tsx` (mode picker, refusal, Arm anyway) ──────

export { AlarmControl } from './controls-alarm.js'

// ── Sensor (read-only value) ──────────────────────────────────────────────────

export interface SensorValueProps extends AccessoryControlProps {
  readonly feature: string
}

export function SensorValueControl({ deviceId, online, feature }: SensorValueProps) {
  const { colors } = useTheme()
  const query = useSensorValue(feature, deviceId, online)
  const value = query.data
  if (query.isLoading && !value) return <ControlSpinner />
  if (!value) return null
  const text =
    value.kind === 'number'
      ? formatNumber(value.value as number, value.precision) + (value.unit ? ` ${value.unit}` : '')
      : String(value.value)
  return (
    <Text style={[styles.sensor, { color: colors.foreground }]} numberOfLines={1}>
      {text}
    </Text>
  )
}

/** Format a sensor number with optional fixed precision, else trim to 1 dp. */
function formatNumber(value: number, precision?: number): string {
  if (typeof precision === 'number') return value.toFixed(precision)
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

// ── Climate (thermostat / A-C: mode select + setpoint + ▲▼) ───────────────────

/** Title-case a token while preserving underscores as spaces. */
function formatToken(token: string): string {
  const spaced = token.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Trailing window a burst of arrow taps folds into ONE setpoint write. */
const SETPOINT_COMMIT_MS = 400

/**
 * The compact climate row: mode dropdown, setpoint readout, ▲▼ — and nothing
 * else. The current temperature rides along as small secondary text under the
 * setpoint when the device reports one.
 *
 * Fan mode, preset, swing axes and target humidity are cap surfaces this row
 * deliberately does NOT render (see `climate-logic.ts`); they belong to a
 * wider surface, not to a strip shared with the device name.
 *
 * Arrow taps are optimistic: the readout moves at once, ONE `setTarget` /
 * `setTargetRange` lands `SETPOINT_COMMIT_MS` after the last tap, and the
 * optimistic value is dropped after the post-write refetch — so a rejected
 * value reverts to whatever the device actually holds.
 */
export function ClimateControl({ deviceId, online }: AccessoryControlProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const status = useClimateStatus(deviceId, online)
  const mutator = useCapMutator(deviceId)

  const data = status.data
  const mode = data?.mode ?? 'off'
  const modeOptions = buildModeOptions(data?.availableModes ?? [], mode, (candidate) =>
    t(`v2.accessories.climateModes.${candidate}`, { defaultValue: formatToken(candidate) }),
  )
  const serverModel = data ? setpointModel(data) : NO_SETPOINT

  // Optimistic setpoint: what the arrows have moved to but the device has not
  // confirmed yet. Null once the post-write refetch has reconciled the row.
  const [optimistic, setOptimistic] = useState<SetpointModel | null>(null)
  const shown = optimistic ?? serverModel

  // Refs so the debounced commit always sees the LATEST optimistic value and
  // the latest query/mutator, without re-arming the timer on every render.
  const optimisticRef = useRef<SetpointModel | null>(optimistic)
  const commitRef = useRef<() => void>(() => {})
  // A tap counter: the post-write reconcile must not discard a tap that landed
  // WHILE the write was in flight (that tap has its own commit coming).
  const tapSeq = useRef(0)
  useEffect(() => {
    optimisticRef.current = optimistic
    commitRef.current = () => {
      const write = setpointWrite(optimisticRef.current ?? serverModel)
      if (write === null) {
        setOptimistic(null)
        return
      }
      const seq = tapSeq.current
      void (async () => {
        await mutator.run('climateControl', write.method, { ...write.args })
        await status.refetch()
        if (tapSeq.current === seq) setOptimistic(null)
      })()
    }
  })

  // Built on the FIRST tap, never during render (a ref read in render is what
  // `react-hooks/purity` forbids), and torn down on unmount.
  const trailing = useRef<TrailingCommit | null>(null)
  const getTrailing = useCallback((): TrailingCommit => {
    const existing = trailing.current
    if (existing !== null) return existing
    const created = createTrailingCommit(SETPOINT_COMMIT_MS, () => commitRef.current())
    trailing.current = created
    return created
  }, [])
  useEffect(() => () => trailing.current?.cancel(), [])

  const setMode = useCallback(
    async (next: string) => {
      // A pending optimistic setpoint belongs to the OUTGOING mode — the new
      // mode may not even have a single target. Drop it and let the refetch
      // paint what the device reports.
      trailing.current?.cancel()
      tapSeq.current += 1
      setOptimistic(null)
      await mutator.run('climateControl', 'setMode', { mode: next })
      void status.refetch()
    },
    [mutator, status],
  )
  const adjustSetpoint = useCallback(
    (direction: 1 | -1) => {
      tapSeq.current += 1
      setOptimistic((current) => stepSetpoint(current ?? serverModel, direction))
      getTrailing().schedule()
    },
    [getTrailing, serverModel],
  )

  if (status.isLoading && !data) return <ControlSpinner />
  // The arrows stay live while a write is in flight — the whole point of the
  // trailing commit is that a burst of taps is uninterrupted.
  const canAdjust = shown.kind !== 'none'
  const currentTemp = data?.currentTemp ?? null

  return (
    <View style={styles.cluster}>
      <OptionPicker
        label={t('v2.accessories.mode')}
        selected={mode}
        options={modeOptions}
        disabled={!online || mutator.pending}
        onSelect={(next) => void setMode(next)}
      />
      <View style={styles.setpoint}>
        <Text
          accessibilityLabel={t('v2.accessories.setTemperature')}
          style={[styles.readout, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {formatSetpoint(shown)}
        </Text>
        {currentTemp !== null ? (
          <Text
            accessibilityLabel={t('v2.accessories.currentTemperature')}
            style={[styles.currentTemp, { color: colors.foregroundSubtle }]}
            numberOfLines={1}
          >
            {formatTemp(currentTemp)}
          </Text>
        ) : null}
      </View>
      <StepperArrows
        upLabel={t('v2.accessories.warmer')}
        downLabel={t('v2.accessories.cooler')}
        disabled={!online || !canAdjust}
        onUp={() => adjustSetpoint(1)}
        onDown={() => adjustSetpoint(-1)}
      />
    </View>
  )
}

// ── Fan (on/off via switch + speed stepper + optional oscillate) ──────────────

export function FanControl({ deviceId, online }: AccessoryControlProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const sw = useSwitchStatus(deviceId, online)
  const fan = useFanStatus(deviceId, online)
  const mutator = useCapMutator(deviceId)

  const percentage = fan.data?.percentage ?? 0
  const step = fan.data?.percentageStep ?? FAN_DEFAULT_STEP
  const on = sw.data?.on ?? percentage > 0
  const oscillating = fan.data?.oscillating ?? null
  const preset = fan.data?.preset ?? ''
  const direction = fan.data?.direction ?? null
  const presetOptions = (fan.data?.availablePresets ?? []).map((candidate) => ({
    value: candidate,
    label: formatToken(candidate),
  }))
  const directionOptions = [
    { value: 'forward', label: formatToken('forward') },
    { value: 'reverse', label: formatToken('reverse') },
  ]

  const toggle = useCallback(async () => {
    await mutator.run('switch', 'setState', { on: !on })
    void sw.refetch()
    void fan.refetch()
  }, [mutator, on, sw, fan])

  const setSpeed = useCallback(
    async (directionDelta: 1 | -1) => {
      await mutator.run('fanControl', 'setPercentage', {
        percentage: stepPercentage(percentage, directionDelta, step),
      })
      void fan.refetch()
      void sw.refetch()
    },
    [mutator, percentage, step, fan, sw],
  )

  const setPreset = useCallback(
    async (next: string) => {
      await mutator.run('fanControl', 'setPreset', { preset: next })
      void fan.refetch()
    },
    [mutator, fan],
  )
  const setDirection = useCallback(
    async (next: 'forward' | 'reverse') => {
      await mutator.run('fanControl', 'setDirection', { direction: next })
      void fan.refetch()
    },
    [mutator, fan],
  )

  const toggleOscillate = useCallback(async () => {
    await mutator.run('fanControl', 'setOscillating', { oscillating: !(oscillating ?? false) })
    void fan.refetch()
  }, [mutator, oscillating, fan])

  if (fan.isLoading && !fan.data) return <ControlSpinner />
  const disabled = !online || mutator.pending
  return (
    <View style={[styles.cluster, styles.wrapCluster]}>
      <IconButton
        icon={Fan}
        label={on ? t('v2.accessories.off') : t('v2.accessories.on')}
        active={on}
        disabled={disabled}
        onPress={() => void toggle()}
      />
      {presetOptions.length > 0 ? (
        <OptionPicker
          label={t('v2.accessories.preset')}
          icon={Sun}
          selected={preset || null}
          options={presetOptions}
          disabled={disabled}
          onSelect={(next) => void setPreset(next)}
        />
      ) : null}
      {direction !== null ? (
        <OptionPicker
          label={t('v2.accessories.direction')}
          icon={RotateCw}
          selected={direction}
          options={directionOptions}
          disabled={disabled}
          onSelect={(next) => void setDirection(next as 'forward' | 'reverse')}
        />
      ) : null}
      <IconButton
        icon={ChevronDown}
        label={t('v2.accessories.speedDown')}
        disabled={disabled}
        onPress={() => void setSpeed(-1)}
      />
      <Text style={[styles.readout, { color: colors.foregroundMuted }]} numberOfLines={1}>
        {`${Math.round(percentage)}%`}
      </Text>
      <IconButton
        icon={ChevronUp}
        label={t('v2.accessories.speedUp')}
        disabled={disabled}
        onPress={() => void setSpeed(1)}
      />
      {oscillating !== null ? (
        <IconButton
          icon={Wind}
          label={t('v2.accessories.oscillate')}
          active={oscillating}
          disabled={disabled}
          onPress={() => void toggleOscillate()}
        />
      ) : null}
    </View>
  )
}

// ── Button (fire-only actuator: HA button / input_button "Press") ─────────────

export function ButtonControl({ deviceId, online }: AccessoryControlProps) {
  const { t } = useTranslation()
  const mutator = useCapMutator(deviceId)
  const press = useCallback(async () => {
    await mutator.run('button', 'press', {})
  }, [mutator])
  return (
    <PillButton
      label={t('v2.accessories.press')}
      icon={Zap}
      disabled={!online || mutator.pending}
      onPress={() => void press()}
    />
  )
}

const styles = StyleSheet.create({
  cluster: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  wrapCluster: { flexWrap: 'wrap' },
  coverPct: { fontSize: 12, fontWeight: '600', minWidth: 34, textAlign: 'right' },
  readout: { fontSize: 12, fontWeight: '600', minWidth: 34, textAlign: 'center' },
  /** Setpoint over the current temperature — two short lines that together stay
   *  inside the row height the devices panel already sets. */
  setpoint: { alignItems: 'center', minWidth: 42 },
  currentTemp: { fontSize: 9, fontWeight: '500' },
  sensor: { fontSize: 14, fontWeight: '600' },
})
