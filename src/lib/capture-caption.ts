/**
 * capture-caption — the "camera · when" line under a captured face or plate in
 * its detail sheet. One builder so the two sheets cannot drift: both fell back
 * to `#<deviceId>` for an unknown camera, and one of them formatted the date in
 * the runtime's locale instead of the app's (`check-date-locale.mjs`).
 *
 * `cameraName` is undefined while the camera list has not arrived or no longer
 * holds the device — the line then names the id rather than pretending the
 * capture has no origin.
 */
export interface CaptureCaptionInput {
  readonly cameraName: string | undefined
  readonly deviceId: number
  readonly timestamp: number
}

/** "Front door · 21/10/2026 23:40" in the app's `locale`. */
export function captureCaption({ cameraName, deviceId, timestamp }: CaptureCaptionInput, locale: string): string {
  const date = new Date(timestamp)
  const when = `${date.toLocaleDateString(locale)} ${date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`
  return `${cameraName ?? `#${String(deviceId)}`} · ${when}`
}
