/**
 * The grid round trip: set a view setting → close the app → reopen → it is
 * still there.
 *
 * The reducers are unit-tested next door; what is NOT covered there is the part
 * that actually broke — a setting the grid screen held in `useState` never
 * reached this store at all, so every reopen re-seeded it from a literal. A
 * reducer test cannot see that, and neither can a test that only asserts the
 * in-memory store: the store survives a screen reopen for free. So every case
 * below writes through the STORE, drops the in-memory state the way a cold
 * launch does, and re-reads through `hydrate()`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

/** Stand-in for the device's AsyncStorage — survives the simulated restart. */
const disk = new Map<string, string>()

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => disk.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      disk.set(k, v)
    },
  },
}))

const { useGridStore, GRIDS_STORAGE_KEY, resolveGridOptions, withHighlightDefaults } = await import(
  '../grid-store.js'
)

/** Let the fire-and-forget `persist()` promise settle. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Cold launch: nothing in memory, everything still on disk. */
async function reopenApp(): Promise<void> {
  useGridStore.setState({ grids: [], hydrated: false })
  await useGridStore.getState().hydrate()
}

beforeEach(async () => {
  disk.clear()
  useGridStore.setState({ grids: [], hydrated: false })
  await useGridStore.getState().hydrate()
})

describe('grid settings survive a reopen', () => {
  it('a grid created in this session is on disk before the restart', async () => {
    const id = useGridStore.getState().createGrid('Piano terra', 'Grid', 'hub-a')
    await flush()
    expect(disk.get(GRIDS_STORAGE_KEY)).toContain('Piano terra')

    await reopenApp()
    expect(useGridStore.getState().grids.map((g) => g.name)).toEqual(['Piano terra'])
    expect(id).toBeTruthy()
  })

  it('the border highlight switched OFF stays off across the restart', async () => {
    const id = useGridStore.getState().createGrid('Esterno', 'Grid', 'hub-a')
    useGridStore.getState().setGridOptions(id, { highlightOn: false })
    await flush()

    await reopenApp()
    const grid = useGridStore.getState().grids.find((g) => g.id === id)
    expect(grid?.options?.highlightOn).toBe(false)
    // …and the default must not put it back on.
    expect(resolveGridOptions(grid?.options).highlightOn).toBe(false)
  })

  it('a grid that never answered the highlight question opens WITH the border', async () => {
    const id = useGridStore.getState().createGrid('Garage', 'Grid', 'hub-a')
    useGridStore.getState().setGridOptions(id, { showName: true })
    await flush()

    await reopenApp()
    const grid = useGridStore.getState().grids.find((g) => g.id === id)
    expect(grid?.options?.highlightOn).toBeUndefined()
    expect(resolveGridOptions(grid?.options).highlightOn).toBe(true)
  })

  it('the whole account view set — active-only, layers, names — survives', async () => {
    const id = useGridStore.getState().createGrid('Sala', 'Grid', 'hub-a')
    useGridStore.getState().setGridOptions(id, { activeOnly: true, layers: ['objects', 'discarded'] })
    useGridStore.getState().setGridOptions(id, { showName: true })
    await flush()

    await reopenApp()
    const grid = useGridStore.getState().grids.find((g) => g.id === id)
    expect(resolveGridOptions(grid?.options, 3)).toEqual({
      showName: true,
      layout: 3,
      highlightOn: true,
      activeOnly: true,
      layers: ['objects', 'discarded'],
    })
  })

  it('the highlight triggers survive', async () => {
    const id = useGridStore.getState().createGrid('Vialetto', 'Grid', 'hub-a')
    useGridStore.getState().setGridCameras(id, [7, 9])
    useGridStore
      .getState()
      .setGridHighlight(id, withHighlightDefaults({ motion: false, detection: true, detectionClasses: ['person'] }))
    await flush()

    await reopenApp()
    const grid = useGridStore.getState().grids.find((g) => g.id === id)
    expect(grid?.highlight).toMatchObject({ motion: false, detection: true, detectionClasses: ['person'] })
  })

  it('a grid persisted before the view keys existed still parses (forward-compat)', async () => {
    disk.set(
      GRIDS_STORAGE_KEY,
      JSON.stringify([{ id: 'legacy', name: 'Vecchia', cameraIds: [1, 2], options: { quality: 'high' } }]),
    )

    await reopenApp()
    const grid = useGridStore.getState().grids.find((g) => g.id === 'legacy')
    expect(grid).toBeDefined()
    expect(resolveGridOptions(grid?.options)).toMatchObject({
      highlightOn: true,
      activeOnly: false,
      layers: [],
    })
  })
})
