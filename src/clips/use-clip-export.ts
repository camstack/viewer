/**
 * use-clip-export — ask the hub to KEEP one clip, and watch the job.
 *
 * It replaces the interim direct fetch — a `getClipPlayback` mint followed by
 * `useMediaDownload`, which lived in `use-clip-save.ts` and has been deleted
 * rather than left beside this one: two ways to keep a clip is how the two
 * diverge, and the dead one reads as a supported alternative. The difference
 * is the whole point:
 *
 *  - the bytes are produced by the addon that owns the camera and pulled ONCE,
 *    by handle, by the recorder — never streamed through this device;
 *  - what comes out is an `ExportRecord`: it survives, it has a lifetime, it is
 *    collectable later and from another phone, and it is listed in the Library
 *    beside every other artifact;
 *  - and the progress is the RECORD's, so it is the same on web and native and
 *    it keeps going when the modal is dismissed.
 *
 * ## What this hook does NOT do
 *
 * It does not download. A finished export is collected from the Library /
 * Exports surface, which already owns the download plane, the retention and
 * the janitor — and which this modal must not grow a second copy of.
 *
 * ## One request is one wake
 *
 * A clip export may wake a sleeping camera, and the authority for that is an
 * explicit operator flag on the subject (absent here — this build never asks
 * for a wake). A failed job is therefore retried only by an operator asking
 * again, never by this hook.
 */
import { useCallback, useState } from 'react'

import { useCreateExport, useExport } from '../data/use-exports.js'
import { log } from '../lib/logger.js'
import { buildClipExportInput, type ClipExportRequest } from './clip-export-subject.js'
import {
  IDLE_CLIP_EXPORT,
  resolveClipExportPhase,
  type ClipExportPhase,
} from './clip-export-progress.js'

export interface UseClipExport {
  /** Queue the export for this clip at this profile. */
  readonly start: (request: ClipExportRequest) => void
  /** Where the job is. `idle` until something is asked. */
  readonly phase: ClipExportPhase
  /** The clip the current job is for, so a second tile cannot read it. */
  readonly clipId: string | null
  /** Forget the job — the modal closing, or a retry. The JOB is untouched. */
  readonly reset: () => void
}

export function useClipExport(): UseClipExport {
  const createExport = useCreateExport()
  const [exportId, setExportId] = useState<string | null>(null)
  const [clipId, setClipId] = useState<string | null>(null)
  /**
   * A creation that never produced a record.
   *
   * Its own state rather than reading the mutation's: a `createExport` that
   * throws and a `createExport` that resolves to `null` (the cap absent, a
   * shape this build cannot read) are the same thing to the operator — the ask
   * did not take — and both must stop the modal claiming the job is running.
   */
  const [askFailed, setAskFailed] = useState<string | null>(null)

  // Polls while the job is active; disabled until there is an id.
  const tracked = useExport(exportId)

  const start = useCallback(
    (request: ClipExportRequest): void => {
      setClipId(request.clip.clipId)
      setExportId(null)
      setAskFailed(null)
      void (async () => {
        try {
          const record = await createExport.mutateAsync(buildClipExportInput(request))
          if (record === null) {
            // A branch that accepts work and produces nothing says so (D391).
            log.warn('clips', 'clip export create returned no record', {
              deviceId: request.clip.deviceId,
              clipId: request.clip.clipId,
              profile: request.profile,
            })
            setAskFailed('no-record')
            return
          }
          log.info('clips', 'clip export queued', {
            deviceId: request.clip.deviceId,
            clipId: request.clip.clipId,
            profile: request.profile,
            exportId: record.id,
          })
          setExportId(record.id)
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e)
          log.warn('clips', 'clip export create failed', {
            deviceId: request.clip.deviceId,
            clipId: request.clip.clipId,
            profile: request.profile,
            error: detail,
          })
          setAskFailed(detail)
        }
      })()
    },
    [createExport],
  )

  const reset = useCallback((): void => {
    setExportId(null)
    setClipId(null)
    setAskFailed(null)
  }, [])

  const phase = ((): ClipExportPhase => {
    if (clipId === null) return IDLE_CLIP_EXPORT
    // The ask itself failed: there is no record and there never will be. Not a
    // clip-export failure token — nothing in that vocabulary produced it — so
    // it travels as the prose it is.
    if (askFailed !== null) return { kind: 'failed', failure: { code: null, detail: askFailed } }
    if (exportId === null) return { kind: 'asked' }
    return resolveClipExportPhase(tracked.data ?? null)
  })()

  return { start, phase, clipId, reset }
}

export type { ClipExportRequest }
