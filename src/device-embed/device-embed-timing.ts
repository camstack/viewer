/**
 * Debug-mode timing of one device-card embed open (`device:embed`).
 *
 * One line per mark, `log.debug`, so nothing is kept or shipped unless debug
 * mode is on (`setLogVerbose`). Each line carries `deviceId` and milliseconds
 * since the tap that opened the card. The clock starts at the tap and is not
 * restarted by a second note for the same device (the screen mounts after the
 * row's press). A different device, or {@link resetDeviceEmbedClock} when the
 * card unmounts, starts a new open.
 *
 * The hub page posts `{ "type": "card-ready", "deviceId" }` once that device's
 * card has left its skeleton. The host shows the card then — the document's
 * load event fires earlier, before the card has painted. A second open of a
 * kept document logs `show-device` instead of `webview-created` / `load-*`.
 */
import { log } from '../lib/logger.js'

export const DEVICE_EMBED_SCOPE = 'device:embed'

export const DEVICE_EMBED_MARKS = [
  'tap',
  'webview-created',
  'load-start',
  'load-end',
  'show-device',
  'token-refresh',
  'card-ready',
  'visible',
  'document-dropped',
] as const

export type DeviceEmbedMark = (typeof DEVICE_EMBED_MARKS)[number]

interface EmbedClock {
  readonly deviceId: number
  readonly t0: number
}

let clock: EmbedClock | null = null

/** Drop the open. The next mark starts a new clock. */
export function resetDeviceEmbedClock(): void {
  clock = null
}

function emit(mark: DeviceEmbedMark, deviceId: number): void {
  const sinceTapMs = clock === null || clock.deviceId !== deviceId ? 0 : Date.now() - clock.t0
  log.debug(DEVICE_EMBED_SCOPE, mark, { deviceId, sinceTapMs })
}

/**
 * The tap that opened this device. A repeat for the same device (the screen
 * mounting after the row already noted the press) does not restart the clock.
 */
export function noteDeviceEmbedTap(deviceId: number): void {
  if (clock?.deviceId === deviceId) return
  clock = { deviceId, t0: Date.now() }
  emit('tap', deviceId)
}

/** A later mark of the open. Starts a clock when the tap was not noted. */
export function markDeviceEmbed(mark: Exclude<DeviceEmbedMark, 'tap'>, deviceId: number): void {
  if (clock === null || clock.deviceId !== deviceId) {
    clock = { deviceId, t0: Date.now() }
  }
  emit(mark, deviceId)
}

export interface DeviceEmbedCardReady {
  readonly deviceId: number
}

function cardReadyDeviceId(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('type' in value) || value.type !== 'card-ready') return null
  if (!('deviceId' in value) || typeof value.deviceId !== 'number') return null
  if (!Number.isInteger(value.deviceId) || value.deviceId <= 0) return null
  return value.deviceId
}

/** The card-ready message, or null when it does not name a device. */
export function deviceEmbedCardReady(raw: string): DeviceEmbedCardReady | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    const deviceId = cardReadyDeviceId(parsed)
    return deviceId === null ? null : { deviceId }
  } catch {
    return null
  }
}

/**
 * The mark a host message represents, or null when it is not the card-ready
 * signal. A card-ready without a device id is not a signal.
 */
export function deviceEmbedMessageMark(raw: string): 'card-ready' | null {
  return deviceEmbedCardReady(raw) === null ? null : 'card-ready'
}
