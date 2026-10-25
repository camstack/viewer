/**
 * AccessoryControl — the registry-driven control renderer for one accessory row.
 *
 * Given an `AccessoryDevice`, picks the primary control via
 * `pickAccessoryControl(features)` and renders the matching compact control.
 * When the accessory ALSO advertises the `motion-trigger` cap
 * (`hasMotionTrigger(features)`), an interactive `MotionTriggerToggle` ("On
 * motion" pill) renders NEXT TO the main control — both coexist, exactly like
 * admin-ui's `DeviceItemActions`. A device whose only cap is `motion-trigger`
 * (registry `kind: 'none'`) shows the toggle as its sole row content.
 */
import React from 'react'
import { View, StyleSheet } from 'react-native'
import { SPACING } from '../../../theme/tokens.js'
import type { AccessoryDevice } from '../../../data/use-accessories.js'
import { pickAccessoryControl, hasMotionTrigger, isActuatingControlKind } from './control-registry.js'
import { useCanActuate } from '../../../hooks/use-user-scope.js'
import { MotionTriggerToggle } from './MotionTriggerToggle.js'
import {
  SwitchControl, BrightnessControl, LockControl, CoverControl,
  AlarmControl, SensorValueControl, ClimateControl, FanControl, ButtonControl,
} from './controls.js'
import {
  MediaPlayerControl, VacuumControl, LawnMowerControl, PetFeederControl,
} from './controls-lifecycle.js'
import { HumidifierControl, WaterHeaterControl } from './controls-climate-family.js'
import {
  UpdateControl, WeatherControl, ImageControl, InputControl, EventEmitterControl,
} from './controls-readonly.js'

export interface AccessoryControlComponentProps {
  readonly device: AccessoryDevice
}

/** Render the primary control for a pick. Returns null for `kind: 'none'` or a
 *  sensor pick missing its feature — the row may still show a motion chip. */
function PrimaryControl({ device }: AccessoryControlComponentProps): React.ReactElement | null {
  const pick = pickAccessoryControl(device)
  const common = { deviceId: device.id, online: device.online }
  switch (pick.kind) {
    case 'cover':
      return <CoverControl {...common} capKey="cover" />
    case 'valve':
      return <CoverControl {...common} capKey="valve" />
    case 'lock':
      return <LockControl {...common} />
    case 'alarm':
      return <AlarmControl {...common} />
    case 'climate':
      return <ClimateControl {...common} />
    case 'fan':
      return <FanControl {...common} />
    case 'brightness':
      return <BrightnessControl {...common} />
    case 'switch':
      return <SwitchControl {...common} />
    case 'button':
      return <ButtonControl {...common} />
    case 'media-player':
      return <MediaPlayerControl {...common} />
    case 'vacuum':
      return <VacuumControl {...common} />
    case 'lawn-mower':
      return <LawnMowerControl {...common} />
    case 'pet-feeder':
      return <PetFeederControl {...common} />
    case 'humidifier':
      return <HumidifierControl {...common} />
    case 'water-heater':
      return <WaterHeaterControl {...common} />
    case 'update':
      return <UpdateControl {...common} />
    case 'weather':
      return <WeatherControl {...common} />
    case 'image':
      return <ImageControl {...common} />
    case 'input':
      return <InputControl {...common} />
    case 'event-emitter':
      return <EventEmitterControl {...common} />
    case 'sensor':
      return pick.sensorFeature ? (
        <SensorValueControl {...common} feature={pick.sensorFeature} />
      ) : null
    case 'none':
      return null
    default: {
      // PARITY GUARD (render half): every AccessoryControlKind must have a case
      // above. Add a new kind to the union without a case here and this
      // assignment fails to compile ("Type X is not assignable to never").
      const _exhaustive: never = pick.kind
      return _exhaustive
    }
  }
}

export function AccessoryControl({ device }: AccessoryControlComponentProps) {
  const pick = pickAccessoryControl(device)
  /**
   * SCOPE GATE (`actuate`). A session that may see this camera but not act on
   * it keeps the row — name, location, online dot, and every READ-ONLY control
   * (a thermometer, a weather tile, which button last fired) — and loses only
   * the parts that would command something. `isActuatingControlKind` is what
   * decides which is which, and it is exhaustive over the kind union so a new
   * actuator cannot arrive here ungated by omission.
   *
   * Hidden, not disabled: a greyed siren toggle claims a capability the session
   * does not have, and the hub refuses it anyway.
   */
  const canActuate = useCanActuate()
  const showPrimary = canActuate || !isActuatingControlKind(pick.kind)
  // "On motion" WRITES the accessory's auto-activation — it is an actuator too.
  const showMotion = hasMotionTrigger(device.features) && canActuate

  // No motion-trigger → just the primary control (or nothing for kind 'none').
  if (!showMotion) return showPrimary ? <PrimaryControl device={device} /> : null

  // Motion-trigger-only accessory (no controllable primary): the toggle IS the
  // row content.
  if (pick.kind === 'none') {
    return <MotionTriggerToggle deviceId={device.id} online={device.online} />
  }

  // Both: the "On motion" toggle sits alongside the primary control.
  return (
    <View style={styles.row}>
      <MotionTriggerToggle deviceId={device.id} online={device.online} />
      {/* Reached only when `showMotion` held, which already required
          `canActuate` — so the primary is never withheld here. */}
      <PrimaryControl device={device} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
})
