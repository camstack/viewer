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
 * The hub page posts no ready message today (the host learns "loaded" from
 * the WebView / iframe load event, which fires before the card's data has
 * painted). {@link deviceEmbedMessageMark} recognises `{ "type": "card-ready" }`
 * so the mark exists the moment the page starts posting it.
 */
import { log } from '../lib/logger.js'

export const DEVICE_EMBED_SCOPE = 'device:embed'

export const DEVICE_EMBED_MARKS = [
  'tap',
  'webview-created',
  'load-start',
  'load-end',
  'card-ready',
  'visible',
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

function isCardReadyMessage(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  return 'type' in value && value.type === 'card-ready'
}

/**
 * The mark a host message represents, or null when it is not the card-ready
 * signal. Non-JSON payloads are not a signal.
 */
export function deviceEmbedMessageMark(raw: string): 'card-ready' | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isCardReadyMessage(parsed) ? 'card-ready' : null
  } catch {
    return null
  }
}
