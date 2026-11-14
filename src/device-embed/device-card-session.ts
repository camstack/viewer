/**
 * The one device-card document, kept by {@link DeviceCardSheetHost} after the
 * detail route has gone. Opening the route presents it; leaving the route
 * parks it. A hidden document is dropped by its owner (a time bound, a memory
 * warning, or the devices panel taking the card).
 */
import { resetDeviceEmbedClock } from './device-embed-timing.js'

export interface DeviceCardPresent {
  readonly deviceId: number
  readonly deviceName: string
  readonly deviceType: string
}

export interface DeviceCardSession extends DeviceCardPresent {
  readonly phase: 'open' | 'parked'
}

let session: DeviceCardSession | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function deviceCardSession(): DeviceCardSession | null {
  return session
}

export function subscribeDeviceCardSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function presentDeviceCard(input: DeviceCardPresent): void {
  session = { deviceId: input.deviceId, deviceName: input.deviceName, deviceType: input.deviceType, phase: 'open' }
  emit()
}

/** The route left. The document stays; the next tap starts a new clock. */
export function parkDeviceCard(): void {
  if (session === null || session.phase === 'parked') return
  session = {
    deviceId: session.deviceId,
    deviceName: session.deviceName,
    deviceType: session.deviceType,
    phase: 'parked',
  }
  resetDeviceEmbedClock()
  emit()
}

export function dropDeviceCard(): void {
  if (session === null) return
  session = null
  emit()
}

/** Drop a parked document so another surface can be the one card. An open sheet is left alone. */
export function dropParkedDeviceCard(): void {
  if (session?.phase !== 'parked') return
  session = null
  emit()
}
