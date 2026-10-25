/** The certificate machinery over the platform key module and the secure store. */
import { secureKvStore } from '../app/kv-secure-storage.js'
import { DeviceCertStore } from './cert-store.js'
import { deviceKeys, deviceKeysAvailable } from './device-key.js'
import type { DeviceCertDeps } from './device-session.js'

export const deviceCertDeps: DeviceCertDeps = {
  keys: deviceKeys,
  store: new DeviceCertStore(secureKvStore),
}

/** Can this build hold a device key at all? False hides every device-certificate path. */
export function deviceCertificatesSupported(): boolean {
  return deviceKeysAvailable
}
