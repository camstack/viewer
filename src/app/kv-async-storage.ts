import AsyncStorage from '@react-native-async-storage/async-storage'
import type { KvStore } from '../connection/server-store.js'

/** `ServerStore`-compatible KV backed by AsyncStorage (the app runtime).
 *  Tests inject an in-memory mock satisfying the same `KvStore` surface. */
export const asyncKvStore: KvStore = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
}
