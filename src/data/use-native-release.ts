/**
 * The newest native build, as the hub publishes it
 * (`/viewer/camstack/native-release.json`, written by `scripts/release-ios.js`).
 * Native only — a browser has no binary to be behind on. One read per hour;
 * an unreachable hub is `null`, never an error the UI has to explain.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { Platform } from 'react-native'
import { useServer } from '../app/ServerProvider.js'
import { isNativeRelease, nativeReleasePath, type NativeRelease } from '../app/native-release.js'

const NATIVE_RELEASE_STALE_MS = 60 * 60_000

export function useNativeRelease(): UseQueryResult<NativeRelease | null> {
  const { server } = useServer()
  const serverUrl = server?.serverUrl ?? null
  return useQuery<NativeRelease | null>({
    queryKey: ['v2', 'native-release', serverUrl],
    enabled: Platform.OS !== 'web' && serverUrl !== null,
    staleTime: NATIVE_RELEASE_STALE_MS,
    queryFn: async () => {
      if (serverUrl === null) return null
      const res = await fetch(nativeReleasePath(serverUrl), { cache: 'no-store' })
      if (!res.ok) return null
      const raw: unknown = await res.json()
      return isNativeRelease(raw) ? raw : null
    },
  })
}
