/** Settings → App, the two level sections: the sync line and the copy sources. */
import { describe, expect, it } from 'vitest'
import en from '../../../../locales/en.json'
import it_ from '../../../../locales/it.json'
import { copySourceHubs, syncStatusLine } from '../settings-levels-model.js'

const NOW = 1_800_000_000_000

describe('syncStatusLine', () => {
  it('names each state, with the age of the last sync', () => {
    expect(syncStatusLine({ state: 'local-only', lastSyncedAt: null, error: null }, NOW).key).toBe(
      'v2.settings.levels.localOnly',
    )
    expect(syncStatusLine({ state: 'local-only', lastSyncedAt: null, error: null, unavailable: 'hub' }, NOW).key).toBe(
      'v2.settings.levels.localOnlyHub',
    )
    expect(
      syncStatusLine({ state: 'local-only', lastSyncedAt: null, error: null, unavailable: 'credential' }, NOW).key,
    ).toBe('v2.settings.levels.localOnlyCredential')
    expect(syncStatusLine({ state: 'synced', lastSyncedAt: NOW - 5_000, error: null }, NOW).key).toBe(
      'v2.settings.levels.syncedNow',
    )
    expect(syncStatusLine({ state: 'synced', lastSyncedAt: NOW - 7 * 60_000, error: null }, NOW)).toEqual({
      key: 'v2.settings.levels.syncedMinutes',
      args: { count: 7 },
      danger: false,
    })
    expect(syncStatusLine({ state: 'synced', lastSyncedAt: NOW - 3 * 3_600_000, error: null }, NOW).args).toEqual({
      count: 3,
    })
    expect(syncStatusLine({ state: 'error', lastSyncedAt: null, error: 'hub unreachable' }, NOW)).toEqual({
      key: 'v2.settings.levels.syncError',
      args: { error: 'hub unreachable' },
      danger: true,
    })
  })

  it('every key it can return exists in both locales', () => {
    const keys = [
      'localOnly',
      'localOnlyHub',
      'localOnlyCredential',
      'syncing',
      'syncError',
      'syncedNow',
      'syncedMinutes',
      'syncedHours',
      'syncedDays',
      'deviceTitle',
      'deviceHint',
      'accountTitle',
      'accountHint',
      'copyFrom',
      'copyTitle',
      'copyBody',
      'copyConfirm',
    ]
    for (const k of keys) {
      expect(Reflect.get(en.v2.settings.levels, k), `en ${k}`).toBeTypeOf('string')
      expect(Reflect.get(it_.v2.settings.levels, k), `it ${k}`).toBeTypeOf('string')
    }
  })
})

describe('copySourceHubs', () => {
  it('lists the signed-in hubs other than this one', () => {
    const hubs = [
      { id: 'a', signedIn: true },
      { id: 'b', signedIn: true },
      { id: 'c', signedIn: false },
    ]
    expect(copySourceHubs(hubs, 'a').map((h) => h.id)).toEqual(['b'])
    expect(copySourceHubs(hubs, null).map((h) => h.id)).toEqual(['a', 'b'])
  })
})
