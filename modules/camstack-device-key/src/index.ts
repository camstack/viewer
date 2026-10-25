/**
 * Native binding of the device key (D855): a P-256 key generated inside the
 * Secure Enclave (iOS) or the Android Keystore (StrongBox when present).
 * The private key never leaves the chip; only the public key (SPKI DER,
 * base64url) and signatures come out.
 *
 * There is no web implementation here — the browser build uses a
 * non-extractable WebCrypto key (`src/device-cert/device-key.web.ts`).
 */
import { requireOptionalNativeModule } from 'expo'

export interface GeneratedDeviceKey {
  /** SubjectPublicKeyInfo DER, base64url. */
  readonly publicKeySpki: string
  /** True when the key lives in secure hardware (Secure Enclave, StrongBox or TEE as the OS reports it). */
  readonly hardwareBacked: boolean
}

export interface CamstackDeviceKeyNative {
  /** Replace any key of this alias with a fresh one. */
  generateKey(alias: string): Promise<GeneratedDeviceKey>
  /** SPKI of the key, or null when there is none. */
  getPublicKey(alias: string): Promise<string | null>
  /** ECDSA P-256 over SHA-256 of the UTF-8 message; DER signature, base64url. */
  sign(alias: string, message: string): Promise<string>
  hasKey(alias: string): Promise<boolean>
  /** True when a key existed. */
  deleteKey(alias: string): Promise<boolean>
}

/**
 * OPTIONAL: `null` when the installed binary does not contain the module (an
 * OTA that reached an older build). Importing this file must never throw at
 * launch; the feature simply stays hidden.
 */
export default requireOptionalNativeModule<CamstackDeviceKeyNative>('CamstackDeviceKey')
