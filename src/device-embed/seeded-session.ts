/**
 * The admin session the web viewer seeds on the hub's origin for the framed
 * device card (`DeviceCardEmbed.web.tsx`), and its removal on sign-out.
 *
 * The viewer writes the admin's access-token key only when the origin holds
 * none, and remembers WHICH token it wrote. Sign-out removes the key only
 * while it still holds that token: a session the admin UI signed in on its
 * own (or refreshed since) belongs to the admin and is left alone.
 */
import { ADMIN_ACCESS_TOKEN_KEY } from './device-embed-url.js'

/** Where the viewer remembers the token it seeded. */
export const VIEWER_SEEDED_TOKEN_KEY = 'camstack_viewer_seeded_access_token'

/** The part of `Storage` this module uses. */
export interface SessionStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Seed the admin session when the origin holds none; true when it wrote. */
export function seedSessionIfAbsent(storage: SessionStorageLike, token: string | null): boolean {
  if (token === null || token.length === 0) return false
  if (storage.getItem(ADMIN_ACCESS_TOKEN_KEY) !== null) return false
  storage.setItem(ADMIN_ACCESS_TOKEN_KEY, token)
  storage.setItem(VIEWER_SEEDED_TOKEN_KEY, token)
  return true
}

/** Remove the session the viewer seeded, if the origin still holds it; true when it removed. */
export function clearSeededSession(storage: SessionStorageLike): boolean {
  const seeded = storage.getItem(VIEWER_SEEDED_TOKEN_KEY)
  if (seeded === null) return false
  storage.removeItem(VIEWER_SEEDED_TOKEN_KEY)
  if (storage.getItem(ADMIN_ACCESS_TOKEN_KEY) !== seeded) return false
  storage.removeItem(ADMIN_ACCESS_TOKEN_KEY)
  return true
}

/** `window.localStorage`, or null where there is none or it is blocked. */
export function browserStorage(): SessionStorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}
