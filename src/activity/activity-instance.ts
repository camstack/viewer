/** The app's Activity store, over AsyncStorage. Specs build their own with
 *  `createActivityStore` and an in-memory key-value store. */
import { asyncKvStore } from '../app/kv-async-storage.js'
import { createActivityStore } from './activity-store.js'

export const useActivityStore = createActivityStore(asyncKvStore)
