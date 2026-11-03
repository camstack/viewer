/** The full-screen remote's route for a device; the name only titles the screen. */
export function remoteRoute(deviceId: number, name: string | undefined): string {
  const base = `/remote/${deviceId}`
  return name === undefined || name === '' ? base : `${base}?name=${encodeURIComponent(name)}`
}
