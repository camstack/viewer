/**
 * The persisted camera list.
 *
 * `['v2','cameras']` gates the whole cameras tab: nothing on that screen can
 * start until it lands. The cache exists to make a COLD launch paint, and the
 * tests below are almost entirely about the ways it must refuse to — a wrong
 * camera list is worse than a spinner.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const store = new Map<string, string>()

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      store.set(k, v)
    },
  },
}))

const {
  cameraListCacheKey,
  readCameraListCache,
  writeCameraListCache,
  hydrateCameraList,
  CAMERA_LIST_QUERY_KEY,
} = await import('../camera-list-cache.js')

type Cam = {
  id: number
  name: string
  online: boolean
  features: string[]
  type: string
  disabled: boolean
  originalName: string
  hidden: boolean
  location: string | null
}
const cam = (id: number, name = `Cam ${String(id)}`): Cam => ({
  id,
  name,
  online: true,
  features: [],
  type: 'camera',
  disabled: false,
  originalName: name,
  hidden: false, location: null,
})

/** The two QueryClient methods the hydrator uses, plus the options it passes —
 *  `updatedAt` is load-bearing, so the fake has to be able to see it. */
function fakeClient(initial?: unknown) {
  let data: unknown = initial
  let options: unknown
  return {
    getQueryData: () => data,
    setQueryData: (_k: unknown, v: unknown, o?: unknown) => {
      data = v
      options = o
    },
    get data() {
      return data
    },
    get setOptions() {
      return options
    },
  }
}

beforeEach(() => {
  store.clear()
})

describe('the key', () => {
  it('separates hubs', () => {
    // Switching hubs must never show the previous hub's cameras.
    expect(cameraListCacheKey('https://a')).not.toBe(
      cameraListCacheKey('https://b'),
    )
  })

  it('ignores a trailing slash', () => {
    expect(cameraListCacheKey('https://a/')).toBe(cameraListCacheKey('https://a'))
  })
})

describe('round trip', () => {
  it('reads back what it wrote', async () => {
    await writeCameraListCache('https://hub', [cam(1), cam(2)])
    expect(await readCameraListCache('https://hub')).toHaveLength(2)
  })

  it('does not read another hub', async () => {
    await writeCameraListCache('https://hub-a', [cam(1)])
    expect(await readCameraListCache('https://hub-b')).toBeNull()
  })

})

describe('refusing to store or serve nonsense', () => {
  it('never persists an EMPTY list', async () => {
    // A hub answering [] mid-restart would otherwise overwrite a good list
    // with "you have no cameras" — and that is what the user would see on the
    // next cold launch.
    await writeCameraListCache('https://hub', [cam(1)])
    await writeCameraListCache('https://hub', [])
    expect(await readCameraListCache('https://hub')).toHaveLength(1)
  })

  it('discards a row whose shape drifted', async () => {
    store.set(
      cameraListCacheKey('https://hub'),
      JSON.stringify({ savedAt: 1, cameras: [{ id: 1, name: 'ok', online: true, features: [] }, { id: 2 }] }),
    )
    // One bad row poisons the list: a card with `undefined` for a name is
    // worse than a spinner.
    expect(await readCameraListCache('https://hub')).toBeNull()
  })

  it('survives corrupt JSON', async () => {
    store.set(cameraListCacheKey('https://hub'), '{not json')
    expect(await readCameraListCache('https://hub')).toBeNull()
  })

  it('returns null for a hub it has never seen', async () => {
    expect(await readCameraListCache('https://new')).toBeNull()
  })
})

describe('hydration', () => {
  it('seeds an empty query cache', async () => {
    await writeCameraListCache('https://hub', [cam(1)])
    const client = fakeClient()

    const seeded = await hydrateCameraList(
      client as unknown as Parameters<typeof hydrateCameraList>[0],
      'https://hub',
    )

    expect(seeded).toBe(true)
    expect(client.data).toHaveLength(1)
  })

  it('does NOT overwrite data the live query already returned', async () => {
    // By the time AsyncStorage resolves, the network may already have landed.
    // Replacing fresh data with a stored copy is a regression, not a speed-up.
    await writeCameraListCache('https://hub', [cam(1, 'stale')])
    const client = fakeClient([cam(1, 'fresh')])

    const seeded = await hydrateCameraList(
      client as unknown as Parameters<typeof hydrateCameraList>[0],
      'https://hub',
    )

    expect(seeded).toBe(false)
    expect((client.data as Cam[])[0]!.name).toBe('fresh')
  })

  it('is a no-op when nothing is stored', async () => {
    const client = fakeClient()
    expect(
      await hydrateCameraList(
        client as unknown as Parameters<typeof hydrateCameraList>[0],
        'https://hub',
      ),
    ).toBe(false)
    expect(client.data).toBeUndefined()
  })

  it('targets the query key the cameras hook actually uses', () => {
    // A cache that seeds the wrong key is invisible — it would look exactly
    // like a cache that never worked.
    expect(CAMERA_LIST_QUERY_KEY).toEqual(['v2', 'cameras'])
  })
})

describe('the hydrated list is stale on arrival', () => {
  /**
   * REGRESSION (2026-09-05). `hydrateCameraList` used a bare `setQueryData`,
   * which stamps the row as fetched NOW. The cameras query's `staleTime` is
   * `RECONCILE_MS` (5 min), so the list restored from disk counted as FRESH and
   * nothing refetched on mount: the operator opened the app to a camera still
   * marked disabled minutes after re-enabling it, and only a pull-to-refresh
   * corrected it. The cache must paint instantly AND be revalidated at once.
   */
  it('backdates the hydrated data so the query is stale immediately', async () => {
    await writeCameraListCache('https://hub', [cam(1)])
    const client = fakeClient()

    await hydrateCameraList(
      client as unknown as Parameters<typeof hydrateCameraList>[0],
      'https://hub',
    )

    // The rows are there for the first paint …
    expect(client.data).toHaveLength(1)
    // … and stamped old, so any non-zero staleTime treats them as stale.
    expect(client.setOptions).toEqual({ updatedAt: 0 })
  })
})
