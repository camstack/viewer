/**
 * PKCE (RFC 7636, S256) for the app login handoff (D855).
 *
 * The verifier stays in memory for the one sign-in that made it; only its
 * SHA-256 challenge travels in the login URL. The hub redeems a handoff code
 * only with the matching verifier, so a code intercepted on the way back
 * through the custom scheme is worthless to whoever caught it.
 */
import { bytesToBase64Url } from './base64url.js'

/** Where randomness and SHA-256 come from (expo-crypto in the app). */
export interface PkcePrimitives {
  randomBytes(length: number): Uint8Array
  sha256(bytes: Uint8Array): Promise<Uint8Array>
}

export interface PkcePair {
  /** Kept in memory; sent only to the redeem call. */
  readonly codeVerifier: string
  /** `BASE64URL(SHA256(verifier))`, sent in the login URL. */
  readonly codeChallenge: string
  /** Echoed by the hub on the callback; a mismatch aborts the sign-in. */
  readonly state: string
}

/** 32 random bytes → 43 characters, the RFC minimum. */
const VERIFIER_BYTES = 32
const STATE_BYTES = 24

export async function challengeFor(verifier: string, sha256: PkcePrimitives['sha256']): Promise<string> {
  return bytesToBase64Url(await sha256(new TextEncoder().encode(verifier)))
}

export async function createPkcePair(primitives: PkcePrimitives): Promise<PkcePair> {
  const codeVerifier = bytesToBase64Url(primitives.randomBytes(VERIFIER_BYTES))
  return {
    codeVerifier,
    codeChallenge: await challengeFor(codeVerifier, primitives.sha256),
    state: bytesToBase64Url(primitives.randomBytes(STATE_BYTES)),
  }
}
