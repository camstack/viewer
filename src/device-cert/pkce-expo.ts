import type { PkcePrimitives } from './pkce.js'
import { optionalModule } from './optional-module.js'

type ExpoCrypto = typeof import('expo-crypto')

/**
 * The app's randomness and SHA-256 (native and web). `expo-crypto` is loaded
 * on first use, never at import: a binary built before it was added must still
 * launch (the sign-in that needs it fails with a message instead).
 */
function crypto(): ExpoCrypto {
  // Native-backed and possibly absent from the installed binary: loaded on demand (see optional-module.ts).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = optionalModule<ExpoCrypto>(() => require('expo-crypto'))
  if (loaded === null) throw new Error('expo-crypto is not part of this app build')
  return loaded
}

export const expoPkcePrimitives: PkcePrimitives = {
  randomBytes: (length) => crypto().getRandomBytes(length),
  sha256: async (bytes) => {
    const c = crypto()
    return new Uint8Array(await c.digest(c.CryptoDigestAlgorithm.SHA256, Uint8Array.from(bytes)))
  },
}
