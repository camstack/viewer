/** Shapes shared by the device-certificate modules (D855). */

/** What a platform key module reports after generating a key. */
export interface GeneratedDeviceKey {
  /** SubjectPublicKeyInfo DER, base64url. */
  readonly publicKeySpki: string
  /** False for a software key (an iOS simulator, a browser). */
  readonly hardwareBacked: boolean
}

/**
 * The device key. Native: Secure Enclave / Android Keystore. Web: a
 * non-extractable WebCrypto key in IndexedDB. The private key never leaves it.
 */
export interface DeviceKeyModule {
  /** Replace any key of this alias with a fresh one. */
  generate(alias: string): Promise<GeneratedDeviceKey>
  getPublicKey(alias: string): Promise<string | null>
  /** ECDSA P-256 / SHA-256 over the UTF-8 message; base64url (DER natively, raw r||s on the web). */
  sign(alias: string, message: string): Promise<string>
  has(alias: string): Promise<boolean>
  /** True when a key existed. */
  delete(alias: string): Promise<boolean>
}

/** The certificate a device holds for one hub. */
export interface DeviceCertRecord {
  readonly credentialId: string
  readonly certPem: string
  /** Epoch ms. */
  readonly notAfter: number
  /** Epoch ms of the enrollment or the last renewal. */
  readonly issuedAt: number
  /** The account the certificate signs in as. */
  readonly username: string
  /** Consecutive DEFINITIVE refusals seen so far (D855 §7). */
  readonly definitiveRefusals: number
  /**
   * Sign in with it on its own (launch, a session the hub ended). False after
   * an explicit sign-out: the operator then signs in on purpose, with a tap.
   */
  readonly autoLogin: boolean
  /** The key slot holding this certificate's private key (absent on a record from before slots: the base alias). */
  readonly keyAlias?: string
  /** Origin the credential was enrolled through (a route the operator chose). */
  readonly hubOrigin?: string
  /** Whether the private key sits in secure hardware; absent on a record from before it was kept. */
  readonly keyHardwareBacked?: boolean
  /** Epoch ms of the FIRST enrollment (kept across renewals); absent on an older record. */
  readonly enrolledAt?: number
  /** Epoch ms of the last AUTOMATIC certificate sign-in (the cooldown clock). */
  readonly lastAutoReloginAt?: number
}

/**
 * Which hub a certificate operation is for, and where to dial it.
 *
 * `hubKey` is the app's identity of ONE hub — its saved-server id — and stays
 * the same whichever route (LAN, public name, tunnel) reaches it. `serverUrl`
 * is the endpoint to dial NOW: the live one when connected. The hub's
 * challenge must name one of `allowedOrigins`.
 */
export interface DeviceTarget {
  readonly hubKey: string
  readonly serverUrl: string
  readonly allowedOrigins: readonly string[]
}

export interface DeviceSession {
  readonly token: string
  readonly refreshToken: string | null
  readonly username: string
  /** Epoch ms the certificate ends at. */
  readonly certNotAfter: number
}

/**
 * One call to a device endpoint, as the app must tell them apart:
 * a typed refusal is an ANSWER; a transient failure (network, timeout, 5xx,
 * an unreadable body) is no answer at all and never counts towards deletion.
 */
export type DeviceCall<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | {
      readonly kind: 'refused'
      readonly reason: string
      /** True only for `revoked` / `unknown-credential` / `user-gone`. */
      readonly definitive: boolean
      readonly retryAfterSeconds?: number
    }
  | { readonly kind: 'transient'; readonly message: string }
