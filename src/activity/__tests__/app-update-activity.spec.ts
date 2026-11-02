import { beforeEach, describe, expect, it, vi } from 'vitest'

const { reload } = vi.hoisted(() => ({ reload: vi.fn<(reason: string) => Promise<void>>(() => Promise.resolve()) }))
vi.mock('../../lib/reload-runtime.js', () => ({ reloadRuntimeForUpdate: reload }))

import { appUpdateDraft, restartForUpdate, type AppUpdateStatus } from '../app-update-activity.js'
import { canCollect, progressPercent, rowState } from '../activity-present.js'
import { upsertAppUpdate } from '../activity-model.js'

const idle: AppUpdateStatus = {
  isChecking: false,
  isDownloading: false,
  isUpdatePending: false,
  downloadProgress: undefined,
  checkError: undefined,
  downloadError: undefined,
}

beforeEach(() => reload.mockClear())

describe('useUpdates state → the activity row', () => {
  it('shows nothing while idle, and nothing for a launch check that is merely looking', () => {
    expect(appUpdateDraft(idle, false)).toBeNull()
    expect(appUpdateDraft({ ...idle, isChecking: true }, false)).toBeNull()
  })

  it('shows "checking" only for a check the operator asked for', () => {
    expect(appUpdateDraft({ ...idle, isChecking: true }, true)).toMatchObject({ state: 'checking', progress: null })
  })

  it('downloads with a real fraction, or none (never 0 for unknown)', () => {
    expect(appUpdateDraft({ ...idle, isDownloading: true, downloadProgress: 0.35 }, false)).toMatchObject({
      state: 'downloading',
      progress: 0.35,
    })
    expect(appUpdateDraft({ ...idle, isDownloading: true }, false)).toMatchObject({ state: 'downloading', progress: null })
  })

  it('is ready once the update is pending', () => {
    expect(appUpdateDraft({ ...idle, isUpdatePending: true }, false)).toMatchObject({ state: 'ready' })
  })

  it('a download error is a failed row with its reason; a launch check error stays silent', () => {
    expect(appUpdateDraft({ ...idle, downloadError: new Error('disk full') }, false)).toMatchObject({
      state: 'failed',
      error: 'disk full',
    })
    expect(appUpdateDraft({ ...idle, checkError: new Error('offline') }, false)).toBeNull()
    expect(appUpdateDraft({ ...idle, checkError: new Error('offline') }, true)).toMatchObject({
      state: 'failed',
      error: 'offline',
    })
  })
})

describe('the row it makes', () => {
  it('is running while it downloads, with a percent, and has nothing to collect', () => {
    const [item] = upsertAppUpdate([], { state: 'downloading', progress: 0.354, version: null, error: null }, 1)
    expect(item).toBeDefined()
    if (item === undefined) return
    expect(rowState(item)).toBe('running')
    expect(progressPercent(item)).toBe(35)
    expect(canCollect(item)).toBe(false)
  })

  it('ready is not a downloadable file', () => {
    const [item] = upsertAppUpdate([], { state: 'ready', progress: null, version: null, error: null }, 1)
    if (item === undefined) throw new Error('no item')
    expect(rowState(item)).toBe('ready')
    expect(canCollect(item)).toBe(false)
  })
})

describe('restart now', () => {
  it('goes through reloadRuntimeForUpdate so the marker and the drain happen', async () => {
    await restartForUpdate()
    expect(reload).toHaveBeenCalledWith('activity')
  })
})
