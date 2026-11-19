/**
 * tile-action — what a tap on a device row's scene tile does.
 *
 * ONE pure resolver, `resolveTileAction`, from the hub's row model (plus the
 * device's `type`, `features` and the session's reach) to the call the tile
 * sends, or `null` when the tile is not a button. The state read is the model's
 * own `state` — what the device REPORTED, never what we last asked for.
 *
 * Where the row model carries the action (the device's own power, a lock's
 * lock / unlock, an automation's enable / disable, a script's run / stop, a
 * pet fountain's pump) the tile sends THAT action, id and confirm included.
 * The row model carries no more than `primary` and `extras`, so the kinds whose
 * actions it does not list (cover and valve travel, a vacuum or mower start /
 * pause) fall back to the cap call the right-side control of the same row
 * already makes; the id is the hero action id all the same.
 *
 * `null` means "not pressable, and no affordance": a type that has no state flip
 * (climate, alarm panel, button, feeder, update, heat pump, control, every
 * read-only type), an unknown state, a device that is offline, a session that
 * may not actuate, a control the hub gated, or a state the device is in the
 * middle of changing (a lock that is locking, a jam, an open door).
 */
import type { HeroCall, HeroConfirm, HeroControl, HeroRowModel } from '@camstack/types'
import { DeviceType } from '@camstack/types/client'
import { canonicalStoredDeviceType } from '../components/camera/accessory-controls/device-kind.js'

/** The `DeviceFeature.LockOpen` wire value: the lock has a latch that can be released apart from the bolt. */
export const LOCK_OPEN_FEATURE = 'lock-open'

/** The call a tile press sends, named by the hero action id it stands for. */
export interface TileAction {
  readonly id: string
  readonly call: HeroCall
  /** `unlock` for a lock: the press arms, the second one sends. `null` = send at once. */
  readonly confirm: HeroConfirm | null
}

export interface TileInput {
  /** The device's wire `type`. */
  readonly type: string
  readonly online: boolean
  /** False for a session that may see the device but not command it. */
  readonly canActuate: boolean
  readonly model: HeroRowModel
}

/** Types whose tile flips the device's own power (the row model's `own-power` toggle). */
const POWER_TYPES: ReadonlySet<string> = new Set([
  DeviceType.Light,
  DeviceType.Switch,
  DeviceType.Siren,
  DeviceType.Humidifier,
  DeviceType.WaterHeater,
  DeviceType.Fan,
  DeviceType.MediaPlayer,
  DeviceType.Dishwasher,
  DeviceType.Washer,
  DeviceType.Dryer,
  DeviceType.Workload,
])

const call = (cap: string, method: string): HeroCall => ({ cap, method, args: {} })

const fromAction = (action: { readonly id: string; readonly call: HeroCall; readonly confirm: HeroConfirm | null }): TileAction => ({
  id: action.id,
  call: action.call,
  confirm: action.confirm,
})

/** The row's controls, `primary` first. */
function controlsOf(model: HeroRowModel): readonly HeroControl[] {
  return model.primary === null ? [] : [model.primary, ...(model.extras ?? [])]
}

function toggleById(model: HeroRowModel, id: string): Extract<HeroControl, { kind: 'toggle' }> | null {
  for (const control of controlsOf(model)) {
    if (control.kind === 'toggle' && control.id === id) return control
  }
  return null
}

/** A toggle's flip: off when it is on, on when it is off, nothing while its state is not known. */
function flip(toggle: Extract<HeroControl, { kind: 'toggle' }> | null): TileAction | null {
  if (toggle === null || toggle.on === null) return null
  return fromAction(toggle.on ? toggle.turnOff : toggle.turnOn)
}

function lockTile(model: HeroRowModel): TileAction | null {
  const primary = model.primary
  if (primary === null || primary.kind !== 'action') return null
  // `on` is locked and `standby` is unlocked; a bolt that is moving, a jam and an open door
  // are other states and carry no flip (the row model lists no lock control for them).
  if (model.state === 'on' && primary.action.id === 'lock.unlock') return fromAction(primary.action)
  if (model.state === 'standby' && primary.action.id === 'lock.lock') return fromAction(primary.action)
  return null
}

/** Open / close / stop of a cover or a valve; the same lifecycle, the cap named after the type. */
function travelTile(model: HeroRowModel, cap: 'cover' | 'valve'): TileAction | null {
  const action = (method: 'open' | 'close' | 'stop'): TileAction => ({
    id: `${cap}.${method}`,
    call: call(cap, method),
    confirm: null,
  })
  switch (model.state) {
    case 'off':
      return action('open')
    case 'on':
      return action('close')
    case 'running':
      return action('stop')
    // A shutter stopped half way (`idle`), an unknown or offline one: no single obvious flip.
    default:
      return null
  }
}

/** A vacuum and a mower share the lifecycle: running pauses, paused resumes, resting starts. */
function lifecycleTile(
  model: HeroRowModel,
  surface: { readonly prefix: 'vacuum' | 'mower'; readonly cap: string; readonly start: string },
): TileAction | null {
  const send = (id: 'start' | 'pause' | 'resume', method: string): TileAction => ({
    id: `${surface.prefix}.${id}`,
    call: call(surface.cap, method),
    confirm: null,
  })
  switch (model.state) {
    case 'running':
      return send('pause', 'pause')
    case 'standby':
      return send('resume', surface.start)
    case 'idle':
      return send('start', surface.start)
    default:
      return null
  }
}

function scriptTile(model: HeroRowModel): TileAction | null {
  const primary = model.primary
  if (primary === null || primary.kind !== 'action') return null
  const id = primary.action.id
  return id === 'script.run' || id === 'script.stop' ? fromAction(primary.action) : null
}

/**
 * What a tap on the tile sends, or `null` when the tile is not pressable.
 * Pure: same input, same output.
 */
export function resolveTileAction(input: TileInput): TileAction | null {
  const { model } = input
  if (!input.online || !input.canActuate) return null
  if (model.primaryGated === true) return null
  if (model.state === 'offline' || model.state === 'unknown') return null
  const type = canonicalStoredDeviceType(input.type)
  if (POWER_TYPES.has(type)) return flip(toggleById(model, 'own-power'))
  switch (type) {
    case DeviceType.Lock:
      return lockTile(model)
    case DeviceType.Cover:
      return travelTile(model, 'cover')
    case DeviceType.Valve:
      return travelTile(model, 'valve')
    case DeviceType.Vacuum:
      return lifecycleTile(model, { prefix: 'vacuum', cap: 'vacuum-control', start: 'start' })
    case DeviceType.LawnMower:
      return lifecycleTile(model, { prefix: 'mower', cap: 'lawn-mower-control', start: 'startMowing' })
    case DeviceType.Automation:
      return flip(toggleById(model, 'automation.enabled'))
    case DeviceType.Script:
      return scriptTile(model)
    case DeviceType.PetFountain:
      return flip(toggleById(model, 'fountain.pump'))
    // Climate, alarm panel, button, feeder, update, heat pump, control and every read-only type.
    default:
      return null
  }
}

/**
 * Does the lock offer "Open door" (release the latch)? Only a lock that has
 * the feature AND is at rest, locked or unlocked — the hero's own condition for
 * `lock.open`. `state` is the cap's lock state, `null` while it is not known.
 */
export function lockOpenAvailable(features: readonly string[], state: string | null): boolean {
  return features.includes(LOCK_OPEN_FEATURE) && (state === 'locked' || state === 'unlocked')
}

/** The `lock.open` call, double-tap confirmed like an unlock. */
export const LOCK_OPEN_ACTION: TileAction = {
  id: 'lock.open',
  call: { cap: 'lock-control', method: 'open', args: {} },
  confirm: 'unlock',
}

/** The i18n key of the caption a row shows while the action `id` is armed ("Tap again to …"). */
export function armCaptionKey(id: string): string {
  if (id === 'lock.open') return 'v2.hero.tapAgain.open'
  return id === 'lock.unlock' ? 'v2.hero.tapAgain.unlock' : 'v2.hero.tapAgain.confirm'
}
