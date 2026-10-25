import AsyncStorage from '@react-native-async-storage/async-storage'
import { Image } from 'expo-image'
import type { QueryClient } from '@tanstack/react-query'

/** Conservative AsyncStorage key prefixes considered "cache" and safe to drop.
 *  We deliberately do NOT touch auth/server keys (`@camstack/v2/server*`,
 *  tokens) nor user prefs (`v2.language`, theme, `@camstack/v2/settings`,
 *  `@camstack/v2/grids`). Only ephemeral, regenerable data lives here. */
const CACHE_KEY_PREFIXES: readonly string[] = ['@camstack/v2/cache/', '@camstack/v2/snapshot/']

/** Best-effort cache clear: react-query cache + expo-image disk/memory caches +
 *  any AsyncStorage keys under known cache prefixes. Never throws — failures are
 *  logged so the UI can still report a (partial) success. */
export async function clearAppCache(queryClient: QueryClient): Promise<void> {
  try {
    queryClient.clear()
  } catch (e) {
    console.error('[clear-cache] react-query clear failed', e)
  }

  try {
    await Image.clearMemoryCache()
    await Image.clearDiskCache()
  } catch (e) {
    console.error('[clear-cache] image cache clear failed', e)
  }

  try {
    const keys = await AsyncStorage.getAllKeys()
    const cacheKeys = keys.filter((k) => CACHE_KEY_PREFIXES.some((p) => k.startsWith(p)))
    if (cacheKeys.length > 0) await AsyncStorage.multiRemove(cacheKeys)
  } catch (e) {
    console.error('[clear-cache] AsyncStorage cache clear failed', e)
  }
}
