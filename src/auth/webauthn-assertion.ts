/**
 * A passkey assertion run by the BROWSER, for re-authentication (D813) in the
 * hub-served web viewer.
 *
 * The hub answers `@simplewebauthn/server` options as JSON (binary fields
 * base64url) and verifies a JSON answer; `navigator.credentials.get` takes and
 * returns ArrayBuffers. These are the two conversions, nothing more — the
 * viewer does not ship `@simplewebauthn/browser` for one call.
 *
 * Web only. A passkey is bound to the hub's origin (the relying party): the
 * native app cannot run this ceremony for it, and offers the password alone.
 */

export function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function bytesToBase64Url(value: ArrayBuffer | ArrayBufferView): string {
  const view =
    value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  let binary = ''
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function toBuffer(value: string): ArrayBuffer {
  const decoded = base64UrlToBytes(value)
  const copy = new ArrayBuffer(decoded.byteLength)
  new Uint8Array(copy).set(decoded)
  return copy
}

function stringField(json: Record<string, unknown>, key: string): string | undefined {
  const value = json[key]
  return typeof value === 'string' ? value : undefined
}

function allowedCredentials(raw: unknown): PublicKeyCredentialDescriptor[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.flatMap((item): PublicKeyCredentialDescriptor[] => {
    if (typeof item !== 'object' || item === null) return []
    const id: unknown = Reflect.get(item, 'id')
    if (typeof id !== 'string') return []
    const transports: unknown = Reflect.get(item, 'transports')
    return [
      {
        id: toBuffer(id),
        type: 'public-key',
        ...(Array.isArray(transports)
          ? { transports: transports.filter((t): t is AuthenticatorTransport => typeof t === 'string') }
          : {}),
      },
    ]
  })
}

/** The hub's `optionsJSON` as `navigator.credentials.get` takes it. */
export function requestOptionsFromJSON(json: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  const challenge = stringField(json, 'challenge')
  if (challenge === undefined) throw new Error('Passkey options without a challenge')
  const rpId = stringField(json, 'rpId')
  const userVerification = stringField(json, 'userVerification')
  const allow = allowedCredentials(json.allowCredentials)
  return {
    challenge: toBuffer(challenge),
    ...(rpId !== undefined ? { rpId } : {}),
    ...(typeof json.timeout === 'number' ? { timeout: json.timeout } : {}),
    ...(userVerification === 'required' || userVerification === 'preferred' || userVerification === 'discouraged'
      ? { userVerification }
      : {}),
    ...(allow !== undefined ? { allowCredentials: allow } : {}),
  }
}

/** The slice of a `PublicKeyCredential` (assertion) that is sent back. */
export interface AssertionCredential {
  readonly id: string
  readonly rawId: ArrayBuffer
  readonly type: string
  readonly authenticatorAttachment?: string | null
  readonly response: {
    readonly clientDataJSON: ArrayBuffer
    readonly authenticatorData: ArrayBuffer
    readonly signature: ArrayBuffer
    readonly userHandle: ArrayBuffer | null
  }
  getClientExtensionResults(): unknown
}

/** The browser's assertion as the hub's verifier reads it. */
export function assertionToJSON(credential: AssertionCredential): Record<string, unknown> {
  const { response } = credential
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    type: credential.type,
    ...(credential.authenticatorAttachment ? { authenticatorAttachment: credential.authenticatorAttachment } : {}),
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      authenticatorData: bytesToBase64Url(response.authenticatorData),
      signature: bytesToBase64Url(response.signature),
      ...(response.userHandle !== null ? { userHandle: bytesToBase64Url(response.userHandle) } : {}),
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  }
}

/** True in a browser that can run a WebAuthn assertion. */
export function passkeyCeremonyAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials?.get === 'function'
  )
}

function isAssertion(value: unknown): value is AssertionCredential {
  if (typeof value !== 'object' || value === null) return false
  const response: unknown = Reflect.get(value, 'response')
  return (
    typeof Reflect.get(value, 'id') === 'string' &&
    typeof response === 'object' &&
    response !== null &&
    Reflect.get(response, 'signature') instanceof ArrayBuffer
  )
}

/** Run the ceremony; resolves with the JSON the hub's `reauthenticate` takes. */
export async function runPasskeyAssertion(optionsJSON: Record<string, unknown>): Promise<Record<string, unknown>> {
  const credential = await navigator.credentials.get({ publicKey: requestOptionsFromJSON(optionsJSON) })
  if (!isAssertion(credential)) throw new Error('No passkey was used')
  return assertionToJSON(credential)
}
