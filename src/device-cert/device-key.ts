/** Native device key (Secure Enclave / Android Keystore); see `camstack-device-key`. */
import native from 'camstack-device-key'
import type { DeviceKeyModule } from './types.js'

/** False when this binary lacks the module (a mistaken OTA): the whole feature stays hidden. */
export const deviceKeysAvailable: boolean = native !== null

function required(): NonNullable<typeof native> {
  if (native === null) throw new Error('The device key module is not part of this app build')
  return native
}

export const deviceKeys: DeviceKeyModule = {
  generate: (alias) => required().generateKey(alias),
  getPublicKey: (alias) => required().getPublicKey(alias),
  sign: (alias, message) => required().sign(alias, message),
  has: (alias) => required().hasKey(alias),
  delete: (alias) => required().deleteKey(alias),
}
