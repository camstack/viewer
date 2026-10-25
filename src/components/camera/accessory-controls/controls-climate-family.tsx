/**
 * Compact climate-family accessory controls ported from admin-ui: humidifier
 * (on/off + mode + target humidity) and water-heater (operation mode + away +
 * setpoint). Optional surfaces render only when advertised by status.
 *
 * Cap methods (verbatim from the cap defs):
 *   - humidifier: setOn / setTargetHumidity / setMode
 *   - water-heater: setTargetTemp / setOperationMode / setAway
 */
import React, { useCallback } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Power, ChevronUp, ChevronDown, Droplet } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { useCapMutator } from '../../../data/use-accessory-controls.js'
import { useHumidifierStatus, useWaterHeaterStatus } from '../../../data/use-accessory-controls-ext.js'
import { IconButton, ControlSpinner, OptionPicker, PillButton } from './control-atoms.js'
import { stepValue } from './numeric-logic.js'
import type { AccessoryControlProps } from './controls.js'

const HUMIDITY_STEP = 5
const HUMIDITY_MIN_DEFAULT = 0
const HUMIDITY_MAX_DEFAULT = 100
const TEMP_STEP = 0.5
const WATER_MIN_DEFAULT = 30
const WATER_MAX_DEFAULT = 80

/** Title-case a token while preserving underscores as spaces. */
function formatToken(token: string): string {
  const spaced = token.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function formatTemp(value: number): string {
  return (Number.isInteger(value) ? String(value) : value.toFixed(1)) + '°'
}

function formatHumidity(value: number): string {
  return `${Math.round(value)}%`
}


// ── Humidifier (on/off + target-humidity stepper) ─────────────────────────────

export function HumidifierControl({ deviceId, online }: AccessoryControlProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const status = useHumidifierStatus(deviceId, online)
  const mutator = useCapMutator(deviceId)
  const data = status.data
  const on = data?.on ?? false
  const target = data?.targetHumidity ?? null
  const current = data?.currentHumidity ?? null
  const min = data?.minHumidity ?? HUMIDITY_MIN_DEFAULT
  const max = data?.maxHumidity ?? HUMIDITY_MAX_DEFAULT
  const mode = data?.mode ?? null
  const modeOptions = (data?.availableModes ?? []).map((candidate) => ({
    value: candidate,
    label: formatToken(candidate),
  }))

  const toggle = useCallback(async () => {
    await mutator.run('humidifier', 'setOn', { on: !on })
    void status.refetch()
  }, [mutator, on, status])
  const setMode = useCallback(
    async (next: string) => {
      await mutator.run('humidifier', 'setMode', { mode: next })
      void status.refetch()
    },
    [mutator, status],
  )
  const adjust = useCallback(
    async (direction: 1 | -1) => {
      await mutator.run('humidifier', 'setTargetHumidity', {
        humidity: stepValue(target, direction, HUMIDITY_STEP, min, max),
      })
      void status.refetch()
    },
    [mutator, target, min, max, status],
  )
  if (status.isLoading && !data) return <ControlSpinner />
  const disabled = !online || mutator.pending
  return (
    <View style={[styles.cluster, styles.wrapCluster]}>
      <IconButton icon={Power} label={on ? t('v2.accessories.off') : t('v2.accessories.on')} active={on} disabled={disabled} onPress={() => void toggle()} />
      {modeOptions.length > 0 ? (
        <OptionPicker
          label={t('v2.accessories.mode')}
          selected={mode}
          options={modeOptions}
          disabled={disabled}
          onSelect={(next) => void setMode(next)}
        />
      ) : null}
      {current !== null ? (
        <View style={styles.humidity}>
          <Droplet size={12} color={colors.foregroundMuted} />
          <Text style={[styles.readout, { color: colors.foregroundMuted }]} numberOfLines={1}>
            {formatHumidity(current)}
          </Text>
        </View>
      ) : null}
      {target !== null ? (
        <>
          <IconButton icon={ChevronDown} label={t('v2.accessories.dimDown')} disabled={disabled} onPress={() => void adjust(-1)} />
          <Text style={[styles.readout, { color: colors.foreground }]} numberOfLines={1}>
            {formatHumidity(target)}
          </Text>
          <IconButton icon={ChevronUp} label={t('v2.accessories.dimUp')} disabled={disabled} onPress={() => void adjust(1)} />
        </>
      ) : null}
    </View>
  )
}

// ── Water heater (current-temp readout + setpoint stepper) ────────────────────

export function WaterHeaterControl({ deviceId, online }: AccessoryControlProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const status = useWaterHeaterStatus(deviceId, online)
  const mutator = useCapMutator(deviceId)
  const data = status.data
  const target = data?.targetTemp ?? null
  const current = data?.currentTemp ?? null
  const min = data?.minTemp ?? WATER_MIN_DEFAULT
  const max = data?.maxTemp ?? WATER_MAX_DEFAULT
  const operationMode = data?.operationMode ?? null
  const modeOptions = (data?.availableModes ?? []).map((candidate) => ({
    value: candidate,
    label: formatToken(candidate),
  }))
  const away = data?.away ?? null

  const adjust = useCallback(
    async (direction: 1 | -1) => {
      await mutator.run('waterHeater', 'setTargetTemp', {
        temp: stepValue(target, direction, TEMP_STEP, min, max),
      })
      void status.refetch()
    },
    [mutator, target, min, max, status],
  )
  const setOperationMode = useCallback(
    async (next: string) => {
      await mutator.run('waterHeater', 'setOperationMode', { mode: next })
      void status.refetch()
    },
    [mutator, status],
  )
  const toggleAway = useCallback(async () => {
    if (away === null) return
    await mutator.run('waterHeater', 'setAway', { on: !away })
    void status.refetch()
  }, [mutator, away, status])
  if (status.isLoading && !data) return <ControlSpinner />
  const disabled = !online || mutator.pending
  return (
    <View style={[styles.cluster, styles.wrapCluster]}>
      {current != null ? (
        <Text style={[styles.readout, { color: colors.foregroundMuted }]} numberOfLines={1}>
          {formatTemp(current)}
        </Text>
      ) : null}
      <IconButton icon={ChevronDown} label={t('v2.accessories.cooler')} disabled={disabled || target === null} onPress={() => void adjust(-1)} />
      <Text style={[styles.readout, { color: colors.foreground }]} numberOfLines={1}>
        {target !== null ? formatTemp(target) : '--'}
      </Text>
      <IconButton icon={ChevronUp} label={t('v2.accessories.warmer')} disabled={disabled || target === null} onPress={() => void adjust(1)} />
      {modeOptions.length > 0 ? (
        <OptionPicker
          label={t('v2.accessories.mode')}
          selected={operationMode}
          options={modeOptions}
          disabled={disabled}
          onSelect={(next) => void setOperationMode(next)}
        />
      ) : null}
      {away !== null ? (
        <PillButton
          label={t('v2.accessories.away')}
          icon={Power}
          active={away}
          disabled={disabled}
          onPress={() => void toggleAway()}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  cluster: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  wrapCluster: { flexWrap: 'wrap' },
  readout: { fontSize: 12, fontWeight: '600', minWidth: 34, textAlign: 'center' },
  humidity: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  humidityText: { fontSize: 12, fontWeight: '600' },
})
