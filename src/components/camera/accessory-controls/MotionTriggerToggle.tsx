/**
 * MotionTriggerToggle — the inline "On motion" toggle for an accessory row.
 *
 * Mirrors admin-ui's `OnMotionToggle` (DeviceItemActions): when an accessory
 * advertises the `motion-trigger` cap, this control lets the operator arm/disarm
 * the firmware behaviour "activate this accessory when the parent camera detects
 * motion". It is INDEPENDENT of the row's primary control (a siren shows both a
 * `switch` on/off pill AND this toggle) — toggling it on does NOT switch the
 * accessory on; it instructs the camera firmware to flip it when motion fires.
 *
 * Reads `motionTrigger.getStatus({ deviceId })` (`{ enabled }`) and writes
 * `motionTrigger.setMotionTrigger({ deviceId, enabled })` via the shared cap
 * mutator, disabling itself while in-flight and refetching after.
 */
import React, { useCallback } from 'react'
import { Activity } from '../../../lib/icons.js'
import { useTranslation } from 'react-i18next'
import { useMotionTriggerStatus, useCapMutator } from '../../../data/use-accessory-controls.js'
import { PillButton, ControlSpinner } from './control-atoms.js'

export interface MotionTriggerToggleProps {
  readonly deviceId: number
  /** False when the accessory is offline — the toggle renders disabled. */
  readonly online: boolean
}

export function MotionTriggerToggle({ deviceId, online }: MotionTriggerToggleProps) {
  const { t } = useTranslation()
  const status = useMotionTriggerStatus(deviceId, online)
  const mutator = useCapMutator(deviceId)
  const on = status.data?.enabled ?? false
  const toggle = useCallback(async () => {
    await mutator.run('motionTrigger', 'setMotionTrigger', { enabled: !on })
    void status.refetch()
  }, [mutator, on, status])
  if (status.isLoading && !status.data) return <ControlSpinner />
  return (
    <PillButton
      label={t('v2.accessories.onMotion')}
      icon={Activity}
      active={on}
      disabled={!online || mutator.pending}
      onPress={() => void toggle()}
    />
  )
}
