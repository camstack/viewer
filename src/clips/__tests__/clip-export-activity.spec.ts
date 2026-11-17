/**
 * @vitest-environment jsdom
 *
 * A keep started from the clip download modal is an Activity row (#567).
 *
 * The timeline selection's Save (`use-run-export.ts`) adds an export item to
 * the Activity list the moment the hub answers with a record; the hub-driven
 * reconcile (`use-activity-host.ts`) then only UPDATES items already in the
 * list — it never adds one. `useClipExport`, the hook behind the shared
 * `ClipExportModal`, created the record and never added it, so the file was
 * produced and the Activity monitor never heard of it. The hook now adds the
 * same item, so every surface that opens that modal gets the row from the one
 * place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { CLIP_SOURCE_ANALYTICS, type Clip } from '../clip-model.js'
import type { ExportRecord } from '../../data/use-exports.js'
import { createActivityStore, type ActivityKv } from '../../activity/activity-store.js'

const memoryKv: ActivityKv = {
  getItem: () => Promise.resolve(null),
  setItem: () => Promise.resolve(),
}
const store = createActivityStore(memoryKv)

const RECORD: ExportRecord = {
  id: 'exp-1',
  deviceId: 107,
  profile: 'high',
  fromMs: 1_789_935_554_000,
  toMs: 1_789_935_582_000,
  options: { includeAudio: true, maxLifeMs: 86_400_000, deleteAfterDownload: false },
  state: 'queued',
  progressPct: null,
  fileBytes: null,
  expiresAt: 1_790_000_000_000,
  deleteAfterDownload: false,
  downloadedAt: null,
  createdAt: 1_789_935_600_000,
  createdBy: 'admin',
  error: null,
}

const createState: { result: ExportRecord | null } = { result: RECORD }

vi.mock('../../activity/activity-instance.js', () => ({ useActivityStore: store }))
vi.mock('../../data/use-exports.js', () => ({
  useCreateExport: () => ({
    mutateAsync: () => Promise.resolve(createState.result),
    isPending: false,
  }),
  useExport: () => ({ data: null }),
}))

const { useClipExport } = await import('../use-clip-export.js')

function recordedClip(): Clip {
  return {
    clipId: 'rec:107:1789935554000',
    deviceId: 107,
    startMs: RECORD.fromMs,
    endMs: RECORD.toMs,
    sourceId: CLIP_SOURCE_ANALYTICS,
    kind: 'motion',
    playback: { kind: 'recorded', deviceId: 107 },
  }
}

beforeEach(() => {
  store.setState({ items: [] })
  createState.result = RECORD
})

describe('the clip keep registers in the Activity list', () => {
  it('adds the export the hub created, named after the camera', async () => {
    const { result } = renderHook(() => useClipExport('Front door'))
    await act(async () => {
      result.current.startRecorded(recordedClip())
      await Promise.resolve()
    })
    const item = store.getState().items.find((i) => i.id === 'export:exp-1')
    expect(item).toBeDefined()
    expect(item?.kind).toBe('export')
    if (item?.kind === 'export') {
      expect(item.cameraName).toBe('Front door')
      expect(item.exportId).toBe('exp-1')
    }
  })

  it('adds nothing when the hub created no record', async () => {
    createState.result = null
    const { result } = renderHook(() => useClipExport('Front door'))
    await act(async () => {
      result.current.startRecorded(recordedClip())
      await Promise.resolve()
    })
    expect(store.getState().items).toHaveLength(0)
  })
})
