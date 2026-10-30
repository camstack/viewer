/**
 * useShareTrackMedia — "send this one stored image out" for a track.
 *
 * The one place the share of a track's media is wired: ask the hub for the
 * bytes of ONE entry (`useTrackMediaEntry`, base64 only on this explicit ask,
 * never to display), then hand them to `shareImageBase64` — the OS share sheet
 * on native, a download on the web. The track detail's share button and the
 * timeline's event download both go through it, so the two cannot disagree on
 * what a share fetches or when a failed read gives up.
 *
 * A failed or absent read ends the wait with `result: 'failed'`; the caller is
 * told, never left on a spinner.
 */
import { useCallback, useEffect, useState } from 'react'

import { shareImageBase64 } from '../lib/share-image.js'
import type { MediaFileLite } from './track-events.js'
import { useTrackMediaEntry } from './use-track-media-entry.js'

export type ShareTrackMediaResult = 'idle' | 'done' | 'failed'

export interface ShareTrackMedia {
  /** Fetch `file`'s bytes and share them as `<filenameBase>.jpg`. */
  readonly share: (file: MediaFileLite, filenameBase: string) => void
  /** The bytes are being read or handed over. */
  readonly busy: boolean
  /** How the last request ended; `idle` before any. */
  readonly result: ShareTrackMediaResult
}

interface PendingShare {
  readonly file: MediaFileLite
  readonly filenameBase: string
}

export function useShareTrackMedia(deviceId: number, trackId: string | null): ShareTrackMedia {
  const [pending, setPending] = useState<PendingShare | null>(null)
  const [result, setResult] = useState<ShareTrackMediaResult>('idle')
  const entry = useTrackMediaEntry(deviceId, trackId, pending?.file ?? null)
  const status = entry.state.status
  const bytes = entry.state.status === 'ready' ? entry.state.base64 : null

  useEffect(() => {
    if (pending === null) return
    if (bytes !== null) {
      setPending(null)
      void shareImageBase64(bytes, pending.filenameBase).then((ok) => {
        setResult(ok ? 'done' : 'failed')
      })
    } else if (status === 'error' || status === 'absent') {
      setPending(null)
      setResult('failed')
    }
  }, [pending, bytes, status])

  const share = useCallback((file: MediaFileLite, filenameBase: string): void => {
    setResult('idle')
    setPending({ file, filenameBase })
  }, [])

  return { share, busy: pending !== null, result }
}
