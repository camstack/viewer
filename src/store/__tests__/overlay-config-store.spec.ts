/**
 * The ONE global overlay document: read per hub, written only when it differs
 * from the defaults, and validated whatever put it there (storage or account).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { OVERLAY_CONFIG_STORAGE_KEY, useOverlayConfigStore } from '../overlay-config-store.js'
import { scopedStorageKey, useServerScopeStore } from '../server-scope.js'
import {
  OVERLAY_DEFAULTS,
  placeOverlay,
  setFade,
} from '../../components/camera/overlay/overlay-config.js'

const KEY = scopedStorageKey(OVERLAY_CONFIG_STORAGE_KEY, 'hub-a')

beforeEach(async () => {
  await AsyncStorage.clear()
  useServerScopeStore.setState({ serverId: 'hub-a' })
  useOverlayConfigStore.setState({ overlay: OVERLAY_DEFAULTS, hydrated: false, serverId: 'hub-a' })
})

describe('overlay config store', () => {
  it('an unconfigured install reads the defaults, for every stream', async () => {
    await useOverlayConfigStore.getState().hydrate()
    const { overlay, hydrated } = useOverlayConfigStore.getState()
    expect(hydrated).toBe(true)
    expect(overlay).toEqual(OVERLAY_DEFAULTS)
    expect(overlay.cameraName).toBe('top-left')
    expect(overlay.fade.cameraName).toBe(true)
    expect(overlay.controlsLeft).toBe('bottom-left')
    expect(overlay.controlsRight).toBe('bottom-right')
  })

  it('persists a changed document under the hub-scoped key and reads it back', async () => {
    useOverlayConfigStore.getState().setOverlay(placeOverlay(OVERLAY_DEFAULTS, 'stats', 'top-right'))
    await new Promise((r) => setTimeout(r, 0))
    expect(await AsyncStorage.getItem(KEY)).not.toBeNull()
    useOverlayConfigStore.setState({ overlay: OVERLAY_DEFAULTS, hydrated: false })
    await useOverlayConfigStore.getState().hydrate()
    expect(useOverlayConfigStore.getState().overlay.stats).toBe('top-right')
  })

  it('a document equal to the defaults stores nothing', async () => {
    useOverlayConfigStore.getState().setOverlay(setFade(OVERLAY_DEFAULTS, 'stats', true))
    await new Promise((r) => setTimeout(r, 0))
    expect(await AsyncStorage.getItem(KEY)).not.toBeNull()
    useOverlayConfigStore.getState().setOverlay(OVERLAY_DEFAULTS)
    await new Promise((r) => setTimeout(r, 0))
    expect(await AsyncStorage.getItem(KEY)).toBeNull()
  })

  it('the account value is validated, never trusted', () => {
    useOverlayConfigStore.getState().applyAccount({ cameraName: 'nowhere', stats: 'top-left', junk: 1 })
    const { overlay } = useOverlayConfigStore.getState()
    expect(overlay.cameraName).toBe('top-left')
    expect(overlay.stats).toBe('top-left')
    useOverlayConfigStore.getState().applyAccount('garbage')
    expect(useOverlayConfigStore.getState().overlay).toEqual(OVERLAY_DEFAULTS)
  })

  it('a corrupt stored value falls back to the defaults', async () => {
    await AsyncStorage.setItem(KEY, '{not json')
    await useOverlayConfigStore.getState().hydrate()
    expect(useOverlayConfigStore.getState().overlay).toEqual(OVERLAY_DEFAULTS)
  })
})
