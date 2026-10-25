/**
 * When the Activity icon is in the top bar: only while the Activity centre has
 * something not yet dismissed (queued, running, or finished and not cleared).
 */
import { describe, it, expect } from 'vitest'

import { hasUndismissedItems, snapshotItemFrom, type ActivityList } from '../activity-model.js'
import { dismissFinishedJobs, finishJob, queuedJob, startJob } from '../activity-jobs.js'

const spec = { id: 'job:1', jobKind: 'face-assign', title: 'Assign', now: 100 } as const

describe('the Activity icon visibility rule', () => {
  it('is hidden for an empty centre', () => {
    expect(hasUndismissedItems([])).toBe(false)
  })

  it('shows for a queued job', () => {
    expect(hasUndismissedItems([queuedJob(spec)])).toBe(true)
  })

  it('shows for a running job', () => {
    const list = startJob([queuedJob(spec)], 'job:1', 110)
    expect(hasUndismissedItems(list)).toBe(true)
  })

  it('stays for a finished job until it is dismissed, done or failed', () => {
    const running = startJob([queuedJob(spec)], 'job:1', 110)
    const done = finishJob(running, 'job:1', { summary: 'ok', error: null }, 120)
    const failed = finishJob(running, 'job:1', { summary: null, error: 'boom' }, 120)
    expect(hasUndismissedItems(done)).toBe(true)
    expect(hasUndismissedItems(failed)).toBe(true)
  })

  it('hides once the last finished job is dismissed', () => {
    const running = startJob([queuedJob(spec)], 'job:1', 110)
    const done = finishJob(running, 'job:1', { summary: 'ok', error: null }, 120)
    expect(hasUndismissedItems(dismissFinishedJobs(done))).toBe(false)
  })

  it('shows for a file waiting to be collected (a snapshot)', () => {
    const list: ActivityList = [
      snapshotItemFrom({ uid: 'u', deviceId: 1, cameraName: 'Door', atMs: 1, fileUri: 'file:///a.jpg', mime: 'image/jpeg', now: 1 }),
    ]
    expect(hasUndismissedItems(list)).toBe(true)
  })

  it('is wired into the button: absent from the bar unless something is listed or its popover is open', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const button = readFileSync(join(process.cwd(), 'src/activity/ActivityButton.tsx'), 'utf8')
    expect(button).toContain('hasUndismissedItems(items)')
    expect(button).toContain('if (!present && !open)')
    // Immediately left of the Settings (account) entry: first in the cluster.
    const cluster = readFileSync(join(process.cwd(), 'src/navigation/NavAccountCluster.tsx'), 'utf8')
    expect(cluster.indexOf('<ActivityButton')).toBeGreaterThan(-1)
    expect(cluster.indexOf('<ActivityButton')).toBeLessThan(cluster.indexOf('<UserMenuButton'))
  })
})
