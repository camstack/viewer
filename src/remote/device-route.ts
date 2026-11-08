/** The device detail's route; name and type only seed the screen until the hub answers. */
export function deviceRoute(deviceId: number, name: string | undefined, type: string): string {
  const query = [
    name === undefined || name === '' ? null : `name=${encodeURIComponent(name)}`,
    type === '' ? null : `type=${encodeURIComponent(type)}`,
  ].filter((part): part is string => part !== null)
  const base = `/device/${deviceId}`
  return query.length === 0 ? base : `${base}?${query.join('&')}`
}
