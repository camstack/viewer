/**
 * The alarm panel's inline control: one Arm button per mode, Disarm, and a
 * refused arm that STAYS on screen with what is open (D630).
 *
 * The decisions are `alarm-control-model.ts`; this file only wires them.
 *
 *  - The Notification Center's panel, for a confirmed admin, arms through the
 *    `nc.*` bridge. A refusal comes back as a RESULT with an id, rendered as
 *    "Not armed — open: …" plus Arm anyway bound to exactly that id. A new
 *    refusal replaces it; a rejected Arm anyway (stale / expired / used /
 *    forgotten) says why, and an arm that excluded open devices names them —
 *    as the admin UI's Alarm tab does.
 *  - Every other panel, and every non-admin, arms through the device cap. A
 *    refusal there is a thrown error, shown inline in our own words when it
 *    can be read, else as the hub worded it; Arm anyway reaches them through
 *    the refusal notification's own button.
 *  - Disarm never waits on a read: until the nc path is decided it goes
 *    through the cap, which ends in the same `panel.disarm()`.
 *
 * One press at a time PER SIDE: a second arm tap while an arm is in flight is
 * dropped (`armInFlight`), so a double tap on Arm anyway cannot turn an
 * `armed` into a displayed `rejected: used`. Disarm has its own lock and its
 * own cap runner, so an arm stuck in flight never blocks it (N2), and neither
 * does a status read that has not answered (N1): pending renders as unknown.
 */
import React, { useCallback, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, ShieldCheck, ShieldOff } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { useAlarmStatus, useCapMutator, type AlarmArmMode } from '../../../data/use-accessory-controls.js'
import { useAdminVerdict } from '../../../data/use-me.js'
import type { NcAlarmArmOutcome, NcAlarmOpenDevice } from '../../../data/nc-alarm.js'
import {
  useNcAlarmRow,
  useNcArmAlarm,
  useNcArmAlarmAnyway,
  useNcDisarmAlarm,
} from '../../../data/use-nc-alarm.js'
import { useNcErrorText } from '../../notifications/use-nc-error-text.js'
import {
  alarmControlModel,
  alarmRefusalLine,
  capRefusalDevices,
  type AlarmBypassedView,
  type AlarmExcludedView,
} from './alarm-control-model.js'
import { ControlSpinner, PillButton } from './control-atoms.js'

export interface AlarmControlProps {
  readonly deviceId: number
  /** False when the accessory is offline — controls render disabled. */
  readonly online: boolean
}

/** An nc arm outcome and when it arrived (compared with the live view's fetch time). */
interface TimedOutcome {
  readonly outcome: NcAlarmArmOutcome
  readonly at: number
}

/** Stamp an outcome on ARRIVAL — called from a mutation callback, never during render. */
function stampOutcome(outcome: NcAlarmArmOutcome): TimedOutcome {
  return { outcome, at: Date.now() }
}

type Translate = (key: string, options?: Record<string, unknown>) => string

function devicesLine(devices: readonly NcAlarmOpenDevice[], t: Translate): string {
  return devices
    .map((d) => `${d.name !== '' ? d.name : t('v2.accessories.deviceFallback', { id: d.deviceId })} (${d.state})`)
    .join(', ')
}

/** A refused arm's line; one naming no device says so in words of its own. */
function refusalText(blocking: readonly NcAlarmOpenDevice[], t: Translate): string {
  const line = alarmRefusalLine(blocking)
  return line.key === 'v2.accessories.alarmRefusedNone'
    ? t(line.key)
    : t(line.key, { devices: devicesLine(line.devices, t) })
}

function excludedLine(devices: readonly AlarmExcludedView[], t: Translate): string {
  return devices
    .map((d) => (d.name !== '' ? d.name : t('v2.accessories.deviceFallback', { id: d.deviceId })))
    .join(', ')
}

/** "Back door (2 triggers dropped), Garage" — the count only where something was dropped. */
function bypassedLine(inputs: readonly AlarmBypassedView[], t: Translate): string {
  return inputs
    .map((b) => {
      const name = b.name !== '' ? b.name : t('v2.accessories.deviceFallback', { id: b.deviceId })
      return b.dropped > 0
        ? t('v2.accessories.alarmBypassedInput', {
            name,
            dropped: t('v2.accessories.alarmBypassedDropped', { count: b.dropped }),
          })
        : name
    })
    .join(', ')
}

/** The cap path's failure: a readable refusal in our words, anything else verbatim. */
function capProblem(error: string | null, t: Translate): string | null {
  if (error === null) return null
  const devices = capRefusalDevices(error)
  return devices !== null ? t('v2.accessories.alarmRefusedCap', { devices }) : error
}

export function AlarmControl({ deviceId, online }: AlarmControlProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const errorText = useNcErrorText()
  const status = useAlarmStatus(deviceId, online)
  const verdict = useAdminVerdict()
  const nc = useNcAlarmRow(deviceId)
  const armMutator = useCapMutator(deviceId)
  const disarmMutator = useCapMutator(deviceId)
  const ncArm = useNcArmAlarm()
  const ncArmAnyway = useNcArmAlarmAnyway()
  const ncDisarm = useNcDisarmAlarm()
  const [last, setLast] = useState<TimedOutcome | null>(null)
  const [ncError, setNcError] = useState<Error | null>(null)
  const armInFlight = useRef(false)
  const disarmInFlight = useRef(false)

  const model = alarmControlModel({
    status: status.data ?? null,
    ncLive: nc.live,
    ncLiveAt: nc.liveAt,
    ncPanel: nc.lookup,
    verdict,
    deviceId,
    lastOutcome: last?.outcome ?? null,
    lastOutcomeAt: last?.at ?? null,
  })

  const { refetch } = status
  const settleArm = useCallback(() => {
    armInFlight.current = false
    void refetch()
  }, [refetch])
  const settleDisarm = useCallback(() => {
    disarmInFlight.current = false
    void refetch()
  }, [refetch])

  /** Single flight for one side: false when that side is already in flight. */
  const claim = (lock: { current: boolean }): boolean => {
    if (lock.current) return false
    lock.current = true
    setNcError(null)
    return true
  }

  const armHandlers = {
    // Stamped on arrival: the live view fetched before it must not overrule it.
    onSuccess: (outcome: NcAlarmArmOutcome) => setLast(stampOutcome(outcome)),
    onError: setNcError,
    onSettled: settleArm,
  }

  const arm = (mode: AlarmArmMode): void => {
    if (model.armPath === null || !claim(armInFlight)) return
    if (model.armPath === 'nc') {
      ncArm.mutate(mode, armHandlers)
      return
    }
    void armMutator.run('alarmPanel', 'arm', { mode }).then(settleArm)
  }

  const armAnyway = (refusalId: string): void => {
    if (!claim(armInFlight)) return
    ncArmAnyway.mutate(refusalId, armHandlers)
  }

  const disarm = (): void => {
    if (!claim(disarmInFlight)) return
    setLast(null)
    if (model.disarmPath === 'nc') {
      ncDisarm.mutate(undefined, { onError: setNcError, onSettled: settleDisarm })
      return
    }
    void disarmMutator.run('alarmPanel', 'disarm', {}).then(settleDisarm)
  }

  const disarmBusy = disarmMutator.pending || ncDisarm.isPending
  const armBusy = armMutator.pending || ncArm.isPending || ncArmAnyway.isPending || disarmBusy
  const loading = status.isLoading && !status.data
  const state = model.state
  const transitional = state === 'arming' || state === 'pending' || state === 'triggered'
  // Both paths' failures: a path that flipped must not hide the other's.
  const problems = [errorText(ncError), capProblem(armMutator.error, t), capProblem(disarmMutator.error, t)].filter(
    (p, i, all): p is string => p !== null && all.indexOf(p) === i,
  )

  return (
    <View style={styles.column}>
      <View style={[styles.cluster, styles.wrapCluster]}>
        {loading ? <ControlSpinner /> : null}
        {model.modes.map((mode) => (
          <PillButton
            key={mode}
            label={t(`v2.accessories.armMode.${mode}`, { defaultValue: mode })}
            icon={ShieldCheck}
            active={state === `armed_${mode}`}
            disabled={!online || armBusy || !model.canArm}
            haptic="action"
            onPress={() => arm(mode)}
          />
        ))}
        <PillButton
          label={t('v2.accessories.disarm')}
          icon={ShieldOff}
          // Drawn "at rest" only on a panel KNOWN to be disarmed.
          active={state === 'disarmed'}
          disabled={!online || disarmBusy || !model.canDisarm}
          haptic="action"
          onPress={disarm}
        />
      </View>
      {model.lookupUnknown ? (
        <Text style={[styles.note, { color: colors.warning }]}>{t('v2.accessories.alarmLookupUnknown')}</Text>
      ) : null}
      {state === null && !loading ? (
        <Text style={[styles.note, { color: colors.warning }]}>{t('v2.accessories.alarmStateUnknown')}</Text>
      ) : null}
      {transitional ? (
        <Text style={[styles.note, { color: state === 'arming' ? colors.foregroundMuted : colors.danger }]}>
          {t(`v2.accessories.alarmState.${state}`)}
        </Text>
      ) : null}
      {model.excluded.length > 0 ? (
        <Text style={[styles.note, { color: colors.foregroundMuted }]}>
          {t('v2.accessories.alarmExcluded', { devices: excludedLine(model.excluded, t) })}
        </Text>
      ) : null}
      {model.bypassed.length > 0 ? (
        <Text testID="alarm-bypassed" style={[styles.note, { color: colors.warning }]}>
          {t('v2.accessories.alarmBypassed', {
            count: model.bypassed.length,
            inputs: bypassedLine(model.bypassed, t),
          })}
        </Text>
      ) : null}
      {model.refusal !== null ? (
        <View style={[styles.refusal, { borderColor: colors.warning }]}>
          <Text style={[styles.note, { color: colors.foreground }]}>
            {refusalText(model.refusal.blocking, t)}
          </Text>
          <PillButton
            label={t('v2.accessories.armAnyway')}
            icon={ShieldAlert}
            disabled={!online || armBusy}
            haptic="action"
            onPress={() => {
              if (model.refusal !== null) armAnyway(model.refusal.refusalId)
            }}
          />
        </View>
      ) : null}
      {model.rejected !== null ? (
        <Text style={[styles.note, { color: colors.danger }]}>
          {t(`v2.accessories.armAnywayRejected.${model.rejected}`)}
        </Text>
      ) : null}
      {problems.map((problem) => (
        <Text key={problem} style={[styles.note, { color: colors.danger }]} accessibilityRole="alert">
          {problem}
        </Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  column: { alignItems: 'flex-end', gap: SPACING.xs, flexShrink: 1 },
  cluster: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  wrapCluster: { flexWrap: 'wrap', justifyContent: 'flex-end' },
  refusal: {
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACING.sm,
    gap: SPACING.xs,
    alignItems: 'flex-end',
    maxWidth: 280,
  },
  note: { fontSize: 12, textAlign: 'right', maxWidth: 280 },
})
