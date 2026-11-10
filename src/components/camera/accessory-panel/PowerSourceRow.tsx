/**
 * PowerSourceRow — the camera's power source in the accessory panel: a title
 * and two buttons: ONE on/off toggle that shows the linked switch's state
 * (on → "Power off", off → "Power on") and Restart. The title is the bare
 * word "Power": the toggle already says the state, and the camera's name is
 * the panel's own title.
 *
 * It sits between the devices and the function switches, drawn ONLY when the
 * hub says the camera has a power source linked. Whoever can reach the camera
 * can use it (`powerSource.*` is the intermediate tier, bounded by the same
 * device access as everything else on this panel), so it is not admin-gated.
 *
 * States, each drawn differently:
 *  - not asked yet, or the hub has no such capability, or no source linked:
 *    nothing — none of these is a claim about the camera;
 *  - the read FAILED: a line saying so, buttons inert — an unanswered read is
 *    never drawn as "no power source";
 *  - linked, switch state unknown: the toggle is inert (no direction to claim);
 *  - linked, restarting: both buttons inert, the toggle reads "Restarting"
 *    (the hub refuses a second restart).
 *
 * An action shows its progress on its own button and its typed result as a
 * line of text under the row: a refusal (switch offline, restart already
 * running) is read, never thrown. Restart asks first.
 */
import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { hapticAction } from '../../../lib/haptics.js'
import { Button } from '../../ui/Button.js'
import { useConfirm } from '../../ui/confirm.js'
import { usePowerSourceAction, usePowerSourceStatus } from '../../../data/use-power-source.js'
import {
  powerSwitchState,
  type PowerSourceAction,
  type PowerSourceActionResult,
} from '../../../data/power-source.js'

export interface PowerSourceRowProps {
  readonly deviceId: number
}

/** Reasons the hub names; any other falls back to the hub's own sentence. */
const REFUSAL_KEYS: Readonly<Record<string, string>> = {
  'switch-offline': 'v2.powerSource.refused.switchOffline',
  'switch-unknown': 'v2.powerSource.refused.switchUnknown',
  'switch-missing': 'v2.powerSource.refused.switchMissing',
  'restart-in-progress': 'v2.powerSource.refused.restartInProgress',
  'switch-call-failed': 'v2.powerSource.refused.switchCallFailed',
  'no-power-source': 'v2.powerSource.refused.noPowerSource',
}

export function PowerSourceRow({ deviceId }: PowerSourceRowProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const confirm = useConfirm()
  const status = usePowerSourceStatus(deviceId)
  const action = usePowerSourceAction(deviceId)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [outcomeFailed, setOutcomeFailed] = useState(false)

  if (status.isPending && !status.isError) return null
  if (!status.isError && (status.data === null || status.data === undefined || !status.data.linked)) {
    return null
  }

  const data = status.data ?? null
  const unknown = status.isError || data === null
  const restarting = data !== null && data.restartInProgress
  const inFlight = action.isPending
  const inert = unknown || restarting || inFlight

  const switchState = data === null ? 'unknown' : powerSwitchState(data)
  /** The toggle's direction: from on it powers off, from off it powers on. */
  const toggleAction: PowerSourceAction | null =
    switchState === 'on' ? 'powerOff' : switchState === 'off' ? 'powerOn' : null
  const toggleLabel = restarting
    ? t('v2.powerSource.state.restarting')
    : toggleAction === 'powerOff'
      ? t('v2.powerSource.powerOff')
      : toggleAction === 'powerOn'
        ? t('v2.powerSource.powerOn')
        : t('v2.powerSource.state.unknown')

  const describe = (result: PowerSourceActionResult): string => {
    if (result.accepted) return t('v2.powerSource.accepted')
    const key = REFUSAL_KEYS[result.reason]
    return key !== undefined ? t(key) : result.message || t('v2.powerSource.refused.generic')
  }

  const run = (which: PowerSourceAction): void => {
    hapticAction()
    setOutcome(null)
    action.mutate(which, {
      onSuccess: (result) => {
        setOutcomeFailed(!result.accepted)
        setOutcome(describe(result))
      },
      onError: () => {
        setOutcomeFailed(true)
        setOutcome(t('v2.powerSource.failed'))
      },
    })
  }

  const restart = async (): Promise<void> => {
    const ok = await confirm({
      title: t('v2.powerSource.restartTitle'),
      message: t('v2.powerSource.restartMessage'),
      confirmLabel: t('v2.powerSource.restart'),
      destructive: true,
    })
    if (ok) run('forceRestart')
  }

  const busyToggle = inFlight && action.variables !== 'forceRestart'
  const busyRestart = inFlight && action.variables === 'forceRestart'

  return (
    <View style={styles.row} testID="power-source-row">
      <Text style={[styles.label, { color: colors.foregroundMuted }]}>
        {t('v2.powerSource.title')}
      </Text>
      <View style={styles.actions}>
        <Button
          label={toggleLabel}
          kind={switchState === 'on' ? 'primary' : 'secondary'}
          grow
          disabled={inert || toggleAction === null}
          busy={busyToggle}
          onPress={() => {
            if (toggleAction !== null) run(toggleAction)
          }}
          testID="power-source-toggle"
        />
        <Button
          label={t('v2.powerSource.restart')}
          kind="danger"
          grow
          disabled={inert}
          busy={busyRestart}
          onPress={() => void restart()}
        />
      </View>
      {unknown ? (
        <Text style={[styles.note, { color: colors.foregroundMuted }]}>
          {t('v2.powerSource.unreadable')}
        </Text>
      ) : null}
      {outcome !== null ? (
        <Text style={[styles.note, { color: outcomeFailed ? colors.danger : colors.foregroundMuted }]}>
          {outcome}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { gap: SPACING.sm },
  label: { fontSize: 12, fontWeight: '600', paddingTop: SPACING.sm },
  actions: { flexDirection: 'row', gap: SPACING.sm },
  note: { fontSize: 12 },
})
