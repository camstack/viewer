/** In-memory AsyncStorage. Persisted zustand stores hydrate through this. */
const store = new Map<string, string>()

const AsyncStorage = {
  getItem: (key: string): Promise<string | null> => Promise.resolve(store.get(key) ?? null),
  setItem: (key: string, value: string): Promise<void> => {
    store.set(key, value)
    return Promise.resolve()
  },
  removeItem: (key: string): Promise<void> => {
    store.delete(key)
    return Promise.resolve()
  },
  multiGet: (keys: readonly string[]): Promise<[string, string | null][]> =>
    Promise.resolve(keys.map((k) => [k, store.get(k) ?? null])),
  multiRemove: (keys: readonly string[]): Promise<void> => {
    keys.forEach((k) => store.delete(k))
    return Promise.resolve()
  },
  getAllKeys: (): Promise<string[]> => Promise.resolve([...store.keys()]),
  clear: (): Promise<void> => {
    store.clear()
    return Promise.resolve()
  },
}

export default AsyncStorage
