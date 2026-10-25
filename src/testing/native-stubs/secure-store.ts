/** In-memory expo-secure-store. The mount harness runs as `Platform.OS = 'ios'`,
 *  so session tokens reach this, not the AsyncStorage stub. Keys are checked
 *  against the real module's alphabet so a key the keychain would refuse fails
 *  here too. */
const store = new Map<string, string>()

function checkKey(key: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`Invalid key provided to SecureStore: ${key}`)
}

export interface SecureStoreOptions {
  readonly keychainAccessible?: number
}

export const AFTER_FIRST_UNLOCK = 0

export function getItemAsync(key: string, _options?: SecureStoreOptions): Promise<string | null> {
  checkKey(key)
  return Promise.resolve(store.get(key) ?? null)
}

export function setItemAsync(key: string, value: string, _options?: SecureStoreOptions): Promise<void> {
  checkKey(key)
  store.set(key, value)
  return Promise.resolve()
}

export function deleteItemAsync(key: string, _options?: SecureStoreOptions): Promise<void> {
  checkKey(key)
  store.delete(key)
  return Promise.resolve()
}
