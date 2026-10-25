import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import type { KvStore } from '../connection/server-store.js'
import { asyncKvStore } from './kv-async-storage.js'
import { log } from '../lib/logger.js'

/**
 * Where session tokens live: the platform keychain / keystore on native,
 * browser storage on web (which has no secure store — a hub-served web session
 * rides the hub's httpOnly cookie anyway).
 *
 * `AFTER_FIRST_UNLOCK`: a cold start from a notification on a locked phone
 * must still be able to read the token; `WHEN_UNLOCKED` (the default) would
 * answer `null` there and drop the operator onto the login screen.
 *
 * A READ that throws answers `null` and logs — a keychain hiccup must look
 * like "signed out", never crash the boot. A WRITE that throws propagates, so
 * a sign-in that could not store its token says so instead of pretending.
 */
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
}

const nativeSecureKvStore: KvStore = {
  getItem: async (key) => {
    try {
      return await SecureStore.getItemAsync(key, SECURE_OPTIONS)
    } catch (err) {
      log.warn('server-store', 'Secure token read failed', {
        message: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  },
  setItem: (key, value) => SecureStore.setItemAsync(key, value, SECURE_OPTIONS),
  removeItem: (key) => SecureStore.deleteItemAsync(key, SECURE_OPTIONS),
}

export const secureKvStore: KvStore = Platform.OS === 'web' ? asyncKvStore : nativeSecureKvStore
