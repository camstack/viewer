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
import {
  pickAccessoryControl, hasMotionTrigger, isActuatingControlKind, type AccessoryControlPick,
} from './control-registry.js'
import { useCanActuate } from '../../../hooks/use-user-scope.js'
import { MotionTriggerToggle } from './MotionTriggerToggle.js'
import { TimedRunItems, TimedRunTime } from './TimedRunControl.js'
import { IconButtonGroup } from '../../ui/IconButtonGroup.js'
import type { GroupExtras } from './group-extras.js'
import { hasTimedRun } from '../../../data/timed-run.js'
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
export function PrimaryControl({
  device,
  pick: given,
  extras,
}: AccessoryControlComponentProps & {
  readonly pick?: AccessoryControlPick
  /** The row's other actions (a timer, "On motion"), drawn inside the control's own icon group. */
  readonly extras?: GroupExtras
}): React.ReactElement | null {
  const pick = given ?? pickAccessoryControl(device)
  const common = { deviceId: device.id, online: device.online }
  switch (pick.kind) {
    case 'cover':
      return <CoverControl {...common} capKey="cover" extras={extras} />
    case 'valve':
      return <CoverControl {...common} capKey="valve" extras={extras} />
    case 'lock':
      return <LockControl {...common} features={device.features} extras={extras} />
    case 'alarm':
      return <AlarmControl {...common} extras={extras} />
    case 'climate':
      return <ClimateControl {...common} />
    case 'fan':
      return <FanControl {...common} extras={extras} />
    case 'brightness':
      return <BrightnessControl {...common} extras={extras} />
    case 'switch':
      return <SwitchControl {...common} extras={extras} />
    case 'button':
      return <ButtonControl {...common} />
    case 'media-player':
      return <MediaPlayerControl {...common} features={device.features} deviceName={device.name} extras={extras} />
    case 'vacuum':
      return <VacuumControl {...common} extras={extras} />
    case 'lawn-mower':
      return <LawnMowerControl {...common} extras={extras} />
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

/** The kinds whose control draws the row's extras inside its own icon group. */
const GROUPING_KINDS: ReadonlySet<AccessoryControlPick['kind']> = new Set<AccessoryControlPick['kind']>([
  'cover', 'valve', 'lock', 'alarm', 'fan', 'brightness', 'switch', 'media-player', 'vacuum', 'lawn-mower',
])

export interface AccessoryControlWithLeadingProps extends AccessoryControlComponentProps {
  /** Icon segments drawn FIRST in the device's group (a pet fountain's pump toggle). */
  readonly leading?: React.ReactNode
}

export function AccessoryControl({ device, leading = null }: AccessoryControlWithLeadingProps) {
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

  // A timed run starts the device, so it is gated like an actuator.
  const showTimedRun = hasTimedRun(device.features) && canActuate
  const showLeading = leading !== null && canActuate

  const hasExtras = showMotion || showTimedRun || showLeading
  if (!hasExtras) return showPrimary ? <PrimaryControl device={device} /> : null
  // Motion-trigger-only accessory (no controllable primary, nothing else): the toggle IS the row.
  if (pick.kind === 'none' && showMotion && !showTimedRun && !showLeading) {
    return <MotionTriggerToggle deviceId={device.id} online={device.online} />
  }

  const extras: GroupExtras = {
    items: (
      <>
        {showLeading ? leading : null}
        {showTimedRun ? <TimedRunItems deviceId={device.id} online={device.online} /> : null}
        {showMotion ? <MotionTriggerToggle deviceId={device.id} online={device.online} iconOnly /> : null}
      </>
    ),
    after: showTimedRun ? <TimedRunTime deviceId={device.id} online={device.online} /> : null,
  }
  const primary = showPrimary && pick.kind !== 'none'
  if (primary && GROUPING_KINDS.has(pick.kind)) return <PrimaryControl device={device} extras={extras} />

  // The primary has no group of its own (or there is none): the extras are one group beside it.
  return (
    <View style={styles.row}>
      <IconButtonGroup>{extras.items}</IconButtonGroup>
      {extras.after}
      {primary ? <PrimaryControl device={device} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
})
