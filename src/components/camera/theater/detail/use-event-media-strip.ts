/**
 * useEventMediaStrip — which additional kinds an event HAS (crop, faceCrop,
 * plateCrop). The fullFrame is already shown by the pager and is excluded.
 *
 * HEAD-probes the HTTP data-plane per kind; a 404 is an honest miss and the
 * tile is omitted. Never `getEventMedia` — that path shipped JPEG through
 * hub-main for a strip that then re-fetched the same bytes as `<Image src>`.
 *
 * Re-fetches whenever `eventId` changes. Never throws; returns [] on error.
 */

import { useEffect, useRef, useState } from 'react'
import { useConnection } from '../../../../connection/ConnectionProvider.js'
import { useServer } from '../../../../app/ServerProvider.js'
import { buildMediaOwnerUrl } from '../../../../data/event-media-url.js'
import { isHonestEventMediaMiss } from '../../../../data/event-media-fallback.js'
import { log } from '../../../../lib/logger.js'

export interface MediaStripItem {
  readonly kind: string
  /** HTTP URI for the stored kind — render with the session Bearer header. */
  readonly uri: string
  readonly label: string
}

/** The media kinds surfaced in the strip (fullFrame is shown by the pager). */
const STRIP_KINDS: readonly string[] = ['crop', 'faceCrop', 'plateCrop', 'confirmationCrop']

function kindLabel(kind: string): string {
  if (kind === 'crop') return 'Crop'
  if (kind === 'faceCrop') return 'Face'
  if (kind === 'plateCrop') return 'Plate'
  // The pixels the confirmation gate judged, kept only when it refused to
  // confirm a birth. Present on a handful of tracks and absent everywhere
  // else — which is the point: it is there to be argued with.
  if (kind === 'confirmationCrop') return 'Gate crop'
  return kind
}

export interface EventMediaStripResult {
  readonly items: MediaStripItem[]
  readonly loading: boolean
}

export function useEventMediaStrip(
  eventId: string | undefined,
  deviceId: number,
): EventMediaStripResult {
  const { controller } = useConnection()
  const { token } = useServer()
  const [items, setItems] = useState<MediaStripItem[]>([])
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!eventId) {
      setItems([])
      setLoading(false)
      return
    }

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setLoading(true)
    setItems([])

    void (async () => {
      try {
        const system = controller.getSystem()
        if (!system) {
          setLoading(false)
          return
        }
        const found: MediaStripItem[] = []
        for (const kind of STRIP_KINDS) {
          // No importer reaches this hook. Kept type-correct for a green
          // build: `eventId` is treated as a track owner id (D482).
          const uri = buildMediaOwnerUrl(system.serverUrl, 'track', eventId, { kind })
          try {
            const probe = await fetch(uri, {
              method: 'HEAD',
              signal: ac.signal,
              ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
            })
            if (probe.ok) found.push({ kind, uri, label: kindLabel(kind) })
            else if (!isHonestEventMediaMiss(probe.status)) {
              log.warn('theater:detail:strip', 'event-media HEAD unexpected', {
                eventId,
                deviceId,
                kind,
                status: probe.status,
              })
            }
          } catch (err) {
            if (ac.signal.aborted) return
            log.warn('theater:detail:strip', 'event-media HEAD failed', {
              eventId,
              deviceId,
              kind,
              error: String(err),
            })
          }
        }
        if (ac.signal.aborted) return
        setItems(found)
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    })()

    return () => {
      ac.abort()
    }
  }, [controller, eventId, deviceId, token])

  return { items, loading }
}
