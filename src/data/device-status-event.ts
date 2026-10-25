/**
 * device-status-event — reading a hub bus event without trusting its shape.
 *
 * The SDK hands subscribers the raw event object, whose payload lives either at
 * the top level or under `data` depending on the emitter. Both forms are in
 * production, so every consumer narrows before reading.
 *
 * The reason this is its own module: a camera's ONLINE flag has no dedicated
 * bus category. `device-status.onStatusChanged` is declared on the cap but
 * never emitted; the only announcement of a liveness flip is the generic
 * `device.state-changed` carrying `capName: 'device-status'` (BaseDevice's
 * `markOnline` → `runtimeState.setCapState('device-status', …)` → the
 * device-manager state mirror emits it). So the camera list must filter that
 * category by cap name, and the filter has to be testable without a socket.
 */

/** The cap whose runtime-state slice IS a device's liveness. */
export const DEVICE_STATUS_CAP = 'device-status'

/**
 * Read one field from a bus event, top level or nested under `data`.
 * Returns `undefined` for anything that is not an object.
 */
export function readEventField(event: unknown, field: string): unknown {
  if (typeof event !== 'object' || event === null) return undefined
  const record: Record<string, unknown> = event as Record<string, unknown>
  if (field in record) return record[field]
  const data = record.data
  return typeof data === 'object' && data !== null
    ? (data as Record<string, unknown>)[field]
    : undefined
}

/**
 * Is this `device.state-changed` event the one that moves a camera's `online`
 * flag? Narrow by cap name — `device.state-changed` fires for EVERY cap's
 * runtime slice (measured: 18,924 dispatches in 30 s during a cold start), and
 * refetching the whole device list on each of those is exactly the storm the
 * invalidation debouncer exists to prevent.
 */
export function isDeviceStatusChange(event: unknown): boolean {
  return readEventField(event, 'capName') === DEVICE_STATUS_CAP
}
