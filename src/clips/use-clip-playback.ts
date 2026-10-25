/**
 * use-clip-playback — resolve ONE native clip's file, on the tap and never
 * before.
 *
 * `videoclips.getClipPlayback` is not a lookup: it MINTS an entry in the
 * provider's per-device scratch, which is a 10-file / 200 MB LRU. Calling it
 * once per visible card would evict the first card's file on the eleventh —
 * D558 § 4.2 costed that and refused it, and it is the reason `use-camera-clips`
 * has a guard forbidding the call. It is asked here, for the clip that was
 * pressed, with the profile {@link resolveClipTap} derived from the row.
 *
 * `served` is kept. The catalog row is a snapshot with a `catalogAsOf`, so it
 * can be stale about which twins exist; when the provider serves something
 * other than what was asked, the surface says so rather than quietly handing
 * over 30x the bytes (D549 15).
 */
import { useCallback, useState } from 'react'

import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery, isRecord } from '../data/cap-query.js'
import { clipServedMismatch, type ClipProfile, type ClipServedMismatch } from './clip-quality.js'
import { noteClipPlayback } from './clip-telemetry.js'
import { log } from '../lib/logger.js'

/** A resolved clip file, ready for the app's file player. */
export interface ResolvedClipPlayback {
  /** Hub-relative or absolute; the caller joins it to the connected origin. */
  readonly playbackUrl: string
  /** The container the provider produced. Only `mp4` plays in this app. */
  readonly format: string
  /** Set only when the provider served a copy other than the one asked for. */
  readonly mismatch: ClipServedMismatch | null
}

/** What the player stage knows about the clip the operator pressed. */
export type ClipPlaybackState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'resolving'; readonly clipId: string }
  | { readonly kind: 'ready'; readonly clipId: string; readonly playback: ResolvedClipPlayback }
  /** The ask failed, or the provider refused. The REASON is not parsed — it is
   *  carried so the stage can render a sentence instead of staying black. */
  | { readonly kind: 'failed'; readonly clipId: string; readonly reason: string | null }

export interface UseClipPlayback {
  readonly state: ClipPlaybackState
  /** Ask for one clip's file. Replaces whatever was being resolved. */
  readonly open: (deviceId: number, clipId: string, profile: ClipProfile | null) => void
  /** Play a file whose address the LIST already carried — no call at all. */
  readonly openUrl: (clipId: string, url: string) => void
  /** Show the operator a refusal the ROW already carried, with no call at all. */
  readonly refuse: (clipId: string, reason: string | null) => void
  readonly close: () => void
}

function parsePlayback(raw: unknown, asked: ClipProfile | null): ResolvedClipPlayback | null {
  if (!isRecord(raw)) return null
  const { playbackUrl, format, served } = raw
  if (typeof playbackUrl !== 'string' || playbackUrl.length === 0) return null
  return {
    playbackUrl,
    format: typeof format === 'string' && format.length > 0 ? format : 'mp4',
    mismatch: clipServedMismatch(asked, typeof served === 'string' ? served : null),
  }
}

export function useClipPlayback(): UseClipPlayback {
  const { controller } = useConnection()
  const [state, setState] = useState<ClipPlaybackState>({ kind: 'idle' })

  const open = useCallback(
    (deviceId: number, clipId: string, profile: ClipProfile | null): void => {
      setState({ kind: 'resolving', clipId })
      void (async () => {
        const askedAt = Date.now()
        try {
          const system = controller.getSystem()
          if (!system) throw new Error('not connected')
          const raw: unknown = await capQuery(
            system.trpcClient as unknown as Record<string, unknown>,
            'videoclips',
            'getClipPlayback',
            { deviceId, clipId, ...(profile !== null ? { profile } : {}) },
            { rethrow: true },
          )
          const playback = parsePlayback(raw, profile)
          if (playback === null) {
            // A mint that ANSWERED with nothing usable is its own outcome, and
            // it used to be the quietest failure here: no log, no counter.
            noteClipPlayback({ deviceId, ok: false, served: null, ms: Date.now() - askedAt })
            log.warn('clips', 'clip playback resolved to nothing playable', { deviceId, clipId })
            setState({ kind: 'failed', clipId, reason: null })
            return
          }
          noteClipPlayback({
            deviceId,
            ok: true,
            // The container it really produced, plus the quality swap when the
            // provider could not serve what was asked. Both are the answer to
            // "it played, but which copy".
            served: playback.mismatch === null ? playback.format : `${playback.format}:swapped`,
            ms: Date.now() - askedAt,
          })
          setState({ kind: 'ready', clipId, playback })
        } catch (e) {
          // A branch that produces no media names the reason, per the repo's
          // logging rule — and it carries `deviceId`, always, because "why is
          // 102 worse than 101" is the only question ever asked of this.
          const reason = e instanceof Error ? e.message : String(e)
          noteClipPlayback({ deviceId, ok: false, served: null, ms: Date.now() - askedAt })
          log.warn('clips', 'clip playback resolve failed', { deviceId, clipId, error: reason })
          setState({ kind: 'failed', clipId, reason })
        }
      })()
    },
    [controller],
  )

  const openUrl = useCallback((clipId: string, url: string): void => {
    setState({ kind: 'ready', clipId, playback: { playbackUrl: url, format: 'mp4', mismatch: null } })
  }, [])

  const refuse = useCallback((clipId: string, reason: string | null): void => {
    setState({ kind: 'failed', clipId, reason })
  }, [])

  const close = useCallback((): void => setState({ kind: 'idle' }), [])

  return { state, open, openUrl, refuse, close }
}
