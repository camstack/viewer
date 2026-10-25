/**
 * Accessory control registry — picks ONE primary control per accessory row.
 *
 * An accessory `DeviceInfo` can advertise several caps (`features`), e.g. a
 * dimmable light carries both `switch` and `brightness`. To keep each row
 * compact we render a single control, chosen by a fixed priority order. The
 * pick is pure + typed (`pickAccessoryControl`) so it can be unit-tested
 * independently of rendering.
 *
 * The pick is keyed on the device's canonical `type` (each device is exactly
 * ONE `DeviceType`), so there is no cross-type contention — the "priority" is
 * simply the fixed type→control map below. The only refinement that consults
 * `features` is a light (dim vs plain on/off) and a sensor (which value to
 * read). Ordered most→least "actionable / specific":
 *   1. cover           — full open/close/stop triad, the row's dominant action
 *   2. lock            — lock/unlock, security-critical
 *   3. alarm           — arm/disarm, security-critical
 *   4. valve           — open/close/stop (cover-like)
 *   5. climate         — thermostat / A-C: mode cycle + setpoint stepper
 *   6. fan             — on/off (switch) + speed stepper + optional oscillate
 *   7. brightness      — dimmable light: on/off + level (supersedes bare switch)
 *   8. switch          — generic on/off (covers non-dimmable lights & sirens)
 *   9. button          — fire-only actuator (HA button/input_button): "Press"
 *  10. sensors         — read-only value (temperature/humidity/light/numeric/enum)
 *
 * `brightness` outranks `switch` because a dimmable light exposes both and the
 * brightness control includes its own on/off, so it fully subsumes the switch.
 *
 * FULL PARITY with admin-ui's HeroRegistry: every controllable `DeviceType`
 * admin-ui renders a hero for has a viewer control here (climate, fan, button,
 * media-player, vacuum, lawn-mower, pet-feeder, humidifier, water-heater,
 * update, weather, image, and the generic `control` input). The
 * `CONTROL_BY_DEVICE_TYPE` map below is a compile-time parity GUARD — see it.
 */

import { DeviceType } from '@camstack/types/client'

/** Identifier of the control kind a row should render. `'none'` = no control. */
export type AccessoryControlKind =
  | 'cover'
  | 'lock'
  | 'alarm'
  | 'valve'
  | 'climate'
  | 'fan'
  | 'brightness'
  | 'switch'
  | 'button'
  | 'sensor'
  | 'media-player'
  | 'vacuum'
  | 'lawn-mower'
  | 'pet-feeder'
  | 'humidifier'
  | 'water-heater'
  | 'update'
  | 'weather'
  | 'image'
  | 'input'
  | 'event-emitter'
  | 'none'

/** Kebab feature flag advertised by an accessory that auto-activates when its
 *  parent camera detects motion. The cap's kebab name is `motion-trigger` (see
 *  `motion-trigger.cap.ts`). It is INDEPENDENT of the row's primary control: a
 *  siren/light/switch can expose BOTH a `switch` on/off AND a `motion-trigger`
 *  "activate on motion" toggle — admin-ui's `DeviceItemActions` renders the
 *  toggle (`OnMotionToggle`) right next to the primary control on this gate. */
export const MOTION_TRIGGER_FEATURE = 'motion-trigger'

/** True when an accessory advertises the `motion-trigger` cap — drives the
 *  inline "On motion" toggle rendered alongside its primary control. Pure +
 *  testable. */
export function hasMotionTrigger(features: readonly string[]): boolean {
  return features.includes(MOTION_TRIGGER_FEATURE)
}

/**
 * PARITY GUARD (scope half) — does this control kind WRITE to the device?
 *
 * A session that may view a camera but not act on it keeps every read-only row
 * (a thermometer, a weather tile, which button last fired) and loses every row
 * that would command something. The distinction cannot be eyeballed per call
 * site: `update` and `input` sound actuating and are not, `button` sounds inert
 * and fires a relay.
 *
 * `satisfies Record<AccessoryControlKind, boolean>` makes the map exhaustive —
 * a new control kind must state which side it is on or the viewer `tsc` fails,
 * which is the only way a new actuator cannot arrive UNGATED by omission.
 */
const ACTUATES_BY_CONTROL_KIND = {
  cover: true,
  lock: true,
  alarm: true,
  valve: true,
  climate: true,
  fan: true,
  brightness: true,
  switch: true,
  button: true,
  'media-player': true,
  vacuum: true,
  'lawn-mower': true,
  'pet-feeder': true,
  humidifier: true,
  'water-heater': true,
  // Read-only rows: state worth showing, nothing to command.
  sensor: false,
  update: false,
  weather: false,
  image: false,
  input: false,
  'event-emitter': false,
  // No row at all.
  none: false,
} as const satisfies Record<AccessoryControlKind, boolean>

/** True when rendering this control offers the operator a WRITE. */
export function isActuatingControlKind(kind: AccessoryControlKind): boolean {
  return ACTUATES_BY_CONTROL_KIND[kind]
}

/** Kebab-case sensor cap names → the read-only `SensorValue` control. */
export const SENSOR_FEATURES: readonly string[] = [
  'temperature-sensor',
  'humidity-sensor',
  'ambient-light-sensor',
  'numeric-sensor',
  'enum-sensor',
]

/** The chosen control plus the sensor feature (when `kind === 'sensor'`) so the
 *  renderer knows which sensor cap to read. */
export interface AccessoryControlPick {
  readonly kind: AccessoryControlKind
  /** The kebab sensor cap name to read, only set when `kind === 'sensor'`. */
  readonly sensorFeature?: string
}

/** The accessory fields the pick needs: its canonical `DeviceType` plus the
 *  secondary cap `features` (used only to refine a light or sensor). */
export interface AccessoryControlInput {
  readonly type: string
  readonly features: readonly string[]
}

/**
 * PARITY GUARD — the single source of truth mapping every shared `DeviceType`
 * to its viewer control kind. `satisfies Record<DeviceType, AccessoryControlKind>`
 * makes this map EXHAUSTIVE over the enum: if a new `DeviceType` is added to
 * `@camstack/types` (i.e. admin-ui grows a device class) but NOT given a mapping
 * here, the viewer `tsc` FAILS with a missing-key error — so the viewer can
 * never silently lag admin-ui's device controls. Removing any one entry breaks
 * the build the same way. Deleting an enum member likewise surfaces the now-dead
 * key. This is the compile-time half of the parity contract; the renderer's
 * `never`-typed switch default in `AccessoryControl.tsx` is the other half
 * (every kind must have a component).
 *
 * A few types carry a FEATURE-refined kind at runtime — the map holds their
 * BASE kind and `pickAccessoryControl` refines it from `features`:
 *   - a `switch`-base device advertising `brightness` → the `brightness` control
 *   - a `sensor`/`presence` device → the specific sensor value, or `none` when
 *     it advertises no recognised sensor cap.
 * Structural / non-interactive types map to `'none'` (camera → StreamPanel;
 * hub/container → structural anchors; notifier/script/automation → admin-ui
 * renders a DummyHero, i.e. no hero control). `alarm-panel` maps to the
 * viewer's richer `alarm` control (admin-ui uses a DummyHero — the viewer
 * exceeds parity here, which the guard permits).
 *
 * `event-emitter` is READ-ONLY rather than structural: a wall switch / remote
 * cannot be actuated from here, but it does have live state worth showing —
 * which button fired, which event type, how long ago. It maps to the
 * `event-emitter` row (admin-ui's counterpart is `EventEmitterHero`); it sat on
 * `'none'` while the cap already carried all three.
 */
const CONTROL_BY_DEVICE_TYPE = {
  [DeviceType.Camera]: 'none',
  [DeviceType.Hub]: 'none',
  [DeviceType.Light]: 'switch', // → brightness when the device advertises it
  [DeviceType.Siren]: 'switch',
  [DeviceType.Switch]: 'switch',
  [DeviceType.Sensor]: 'sensor', // → specific sensor value, or none
  [DeviceType.Thermostat]: 'climate',
  [DeviceType.Climate]: 'climate',
  [DeviceType.Button]: 'button',
  [DeviceType.EventEmitter]: 'event-emitter',
  [DeviceType.Update]: 'update',
  [DeviceType.Generic]: 'none',
  [DeviceType.Notifier]: 'none',
  [DeviceType.Script]: 'none',
  [DeviceType.Automation]: 'none',
  [DeviceType.Lock]: 'lock',
  [DeviceType.Cover]: 'cover',
  [DeviceType.Valve]: 'valve',
  [DeviceType.Humidifier]: 'humidifier',
  [DeviceType.WaterHeater]: 'water-heater',
  [DeviceType.Fan]: 'fan',
  [DeviceType.MediaPlayer]: 'media-player',
  [DeviceType.AlarmPanel]: 'alarm',
  [DeviceType.Control]: 'input',
  [DeviceType.Presence]: 'sensor', // → specific sensor value, or none
  [DeviceType.Weather]: 'weather',
  [DeviceType.Vacuum]: 'vacuum',
  [DeviceType.LawnMower]: 'lawn-mower',
  [DeviceType.PetFeeder]: 'pet-feeder',
  [DeviceType.Container]: 'none',
  [DeviceType.Image]: 'image',
  // No dishwasher control here yet: its device page is the hub's own.
  [DeviceType.Dishwasher]: 'none',
} as const satisfies Record<DeviceType, AccessoryControlKind>

/** Resolve a raw device-type string to its base control kind via the guarded
 *  map, else `'none'` for an unknown future type. */
function baseControlKind(type: string): AccessoryControlKind {
  if (Object.prototype.hasOwnProperty.call(CONTROL_BY_DEVICE_TYPE, type)) {
    // Guarded above to be exactly the DeviceType key set.
    return CONTROL_BY_DEVICE_TYPE[type as DeviceType]
  }
  return 'none'
}

/**
 * Pick the primary control for an accessory. The base kind is chosen by the
 * device's canonical `type` via the parity-guarded `CONTROL_BY_DEVICE_TYPE`
 * map, then refined by `features`: a `switch`-base device advertising
 * `brightness` becomes the dim control, and a `sensor`-base device resolves to
 * its specific sensor value (or `none` when it advertises none). Pure: same
 * input → same output.
 */
export function pickAccessoryControl(device: AccessoryControlInput): AccessoryControlPick {
  const set = new Set(device.features)
  const base = baseControlKind(device.type)
  if (base === 'switch') {
    // A dimmable light exposes both switch + brightness; the brightness control
    // subsumes on/off. (Sirens / plain switches never advertise `brightness`.)
    return { kind: set.has('brightness') ? 'brightness' : 'switch' }
  }
  if (base === 'sensor') {
    const sensor = SENSOR_FEATURES.find((f) => set.has(f))
    return sensor ? { kind: 'sensor', sensorFeature: sensor } : { kind: 'none' }
  }
  return { kind: base }
}
