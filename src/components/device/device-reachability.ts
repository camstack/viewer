/**
 * device-reachability — the one rule for "is this device OFFLINE", shared by
 * every surface that draws a non-camera device.
 *
 * Offline is a CLAIM about reachability, and an off device is a claim about
 * state: they must never look alike (D62). The claim is made only from an
 * online flag the hub ANSWERED with `false`. An unanswered identity
 * (`undefined` / `null`) is not offline (D315): it draws nothing extra.
 */
export function isDeviceOffline(online: boolean | null | undefined): boolean {
  return online === false
}
