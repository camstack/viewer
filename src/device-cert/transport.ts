import { originOf } from '../connection/hub-origin.js'
import type { DeviceTarget } from './types.js'

/** Certificate operations travel over TLS only: a signature or a proof over plain http is readable and replayable. */
export function isSecureHub(url: string): boolean {
  return originOf(url)?.startsWith('https://') === true
}

/** The target for `hubKey`, dialled at `liveUrl`; every known route of the hub may be named by the challenge. */
export function deviceTarget(input: {
  readonly hubKey: string
  readonly liveUrl: string
  readonly knownUrls?: readonly string[]
}): DeviceTarget {
  const origins = new Set<string>()
  for (const url of [input.liveUrl, ...(input.knownUrls ?? [])]) {
    const origin = originOf(url)
    if (origin !== null) origins.add(origin)
  }
  return { hubKey: input.hubKey, serverUrl: input.liveUrl, allowedOrigins: [...origins] }
}
