/**
 * tile-quick-action — what tapping a row's LEFT icon does, how it is tinted and
 * when it moves. Pure, so a spec can drive every case.
 *
 * The icon is a button only where the device type has ONE obvious primary
 * action the session may send; every other type keeps a plain icon. It reuses
 * the cap methods the row's own control already calls — there is no new call.
 *
 *  - a light, switch, plug, fan: `switch.setState` flips power;
 *  - a cover / valve: stop while moving, close when open, else open;
 *  - a lock: lock when unlocked, unlock when locked (unlock is armed, like the
 *    lock's own button: first tap asks in the row, a second sends);
 *  - media / climate / any type whose hub row model carries a power toggle:
 *    that toggle.
 *
 * A read-only session never gets an action (`canActuate`).
 */
import type { HeroTone } from '@dominevo/types'
import type { AccessoryControlKind } from '../components/camera/accessory-controls/control-registry.js'

export type TileQuickKind = 'switch' | 'cover' | 'lock' | 'hero-power' | 'none'

/** The settled-or-moving state a tile reads from its device. `null` = not read yet. */
export type TileDeviceState = 'on' | 'off' | 'transitional' | 'unknown'

/** Longest a tile keeps pulsing for one transition; a stuck report must not animate forever. */
export const TILE_PULSE_MAX_MS = 60_000

/** Which quick action a control kind offers; `heroToggle` is true when the hub row model has a power toggle. */
export function tileQuickKind(
  controlKind: AccessoryControlKind,
  heroToggle: boolean,
  canActuate: boolean,
): TileQuickKind {
  if (!canActuate) return 'none'
  switch (controlKind) {
    case 'switch':
    case 'brightness':
    case 'fan':
      return 'switch'
    case 'cover':
    case 'valve':
      return 'cover'
    case 'lock':
      return 'lock'
    // Only the kinds whose hub row power toggle is the type's own on/off; any other kind stays plain.
    case 'media-player':
    case 'climate':
      return heroToggle ? 'hero-power' : 'none'
    default:
      return 'none'
  }
}

export interface TileCall {
  readonly cap: string
  readonly method: string
  readonly args: Readonly<Record<string, unknown>>
  /** The id of the double-tap arm this call needs (`tile-action.ts` spelling), or null to send at once. */
  readonly armId: string | null
}

/** The i18n key (under `v2.tileAction`) that names what a tap will do. */
export type TileActionLabel = 'powerOn' | 'powerOff' | 'open' | 'close' | 'stop' | 'lock' | 'unlock'

export interface TilePlan {
  readonly call: TileCall
  readonly label: TileActionLabel
}

/** The next power state asked of a switch. A state not read (loading, failed read) offers nothing: the tile opens the device. */
export function switchPlan(on: boolean | null): TilePlan | null {
  if (on === null) return null
  const next = !on
  return {
    call: { cap: 'switch', method: 'setState', args: { on: next }, armId: null },
    label: next ? 'powerOn' : 'powerOff',
  }
}

const COVER_STATES: readonly string[] = ['open', 'closed', 'opening', 'closing', 'stopped']

/** A cover's tap by its reported state: stop while it moves, close when open, open when closed or stopped. An unread or unrecognised state offers nothing. */
export function coverPlan(capKey: 'cover' | 'valve', state: string | null): TilePlan | null {
  if (state === null || !COVER_STATES.includes(state)) return null
  if (state === 'opening' || state === 'closing') {
    return { call: { cap: capKey, method: 'stop', args: {}, armId: null }, label: 'stop' }
  }
  if (state === 'open') {
    return { call: { cap: capKey, method: 'close', args: {}, armId: null }, label: 'close' }
  }
  return { call: { cap: capKey, method: 'open', args: {}, armId: null }, label: 'open' }
}

/** A lock's tap: lock when unlocked, unlock (armed) when locked. A moving or unread lock offers nothing. */
export function lockPlan(state: string | null): TilePlan | null {
  if (state === 'unlocked') {
    return { call: { cap: 'lockControl', method: 'lock', args: {}, armId: null }, label: 'lock' }
  }
  if (state === 'locked') {
    return { call: { cap: 'lockControl', method: 'unlock', args: {}, armId: 'lock.unlock' }, label: 'unlock' }
  }
  return null
}

export function switchState(on: boolean | null): TileDeviceState {
  return on === null ? 'unknown' : on ? 'on' : 'off'
}

export function coverState(state: string | null): TileDeviceState {
  if (state === 'opening' || state === 'closing') return 'transitional'
  if (state === 'open') return 'on'
  if (state === 'closed') return 'off'
  // `stopped` part-way is neither: it is open to some degree, the accent says so.
  return state === 'stopped' ? 'on' : 'unknown'
}

export function lockState(state: string | null): TileDeviceState {
  if (state === 'locking' || state === 'unlocking') return 'transitional'
  if (state === 'locked') return 'on'
  if (state === 'unlocked') return 'off'
  return 'unknown'
}

export interface TileTintInput {
  readonly online: boolean
  readonly state: TileDeviceState | 'loading'
  /** The last send failed. */
  readonly failed: boolean
  /** The tone the hub (or the row) gives the icon when active. */
  readonly activeTone: HeroTone
  /** The tone the icon wears before the state is read (the hub's own look). */
  readonly restingTone: HeroTone
}

export interface TileTint {
  readonly tone: HeroTone
  /** Offline: drawn with the disabled foreground, not the muted one. */
  readonly disabled: boolean
}

/**
 * The icon's colour: offline is disabled, a failed send is danger, an active
 * device wears its accent, an inactive or unread one is muted. While the state
 * has not been read the hub's own look stands, so a row never flashes.
 */
export function tileTint(input: TileTintInput): TileTint {
  if (!input.online) return { tone: 'muted', disabled: true }
  if (input.failed) return { tone: 'danger', disabled: false }
  switch (input.state) {
    case 'loading':
      return { tone: input.restingTone, disabled: false }
    case 'on':
    case 'transitional':
      return { tone: input.activeTone === 'muted' ? 'primary' : input.activeTone, disabled: false }
    case 'off':
    case 'unknown':
      return { tone: 'muted', disabled: false }
  }
}

/** How long a failed send keeps the icon red before it returns to the state's own tint. */
export const TILE_FAILED_MS = 5000

/** True while the icon should pulse: a send is in flight or the device reports it is moving. */
export function tilePulsing(state: TileDeviceState | 'loading', pending: boolean, expired: boolean): boolean {
  return !expired && (pending || state === 'transitional')
}
