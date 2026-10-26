/**
 * Fetch the hub display palette and publish it to {@link setPaletteView}.
 *
 * One query per server URL. A reconnect invalidates it. `unknown`, an
 * unreadable payload, and a thrown read all paint the bundled CamStack preset
 * and keep the reason — they never pretend the preset was what the hub stored.
 */
import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { log } from '../lib/logger.js'
import {
  bundledView,
  failureReason,
  getPaletteView,
  resolvePalettePaint,
  setPaletteView,
  usePaletteView,
  withServer,
  type PaletteView,
} from '../../shared/palette.js'

export function paletteQueryKey(serverUrl: string | null): readonly [string, string, string | null] {
  return ['v2', 'display-palette', serverUrl]
}

/** True only on the rising edge into `connected`, not on the first observation. */
export function shouldRefreshPalette(previous: string | null, next: string): boolean {
  return previous !== null && previous !== 'connected' && next === 'connected'
}

const logged = new Set<string>()

function noteUnknown(serverUrl: string | null, reason: string | null): void {
  const key = `${serverUrl ?? ''}|${reason ?? ''}`
  if (logged.has(key)) return
  logged.add(key)
  log.warn('palette', 'display palette unknown; painting the bundled preset', {
    reason,
    serverUrl,
  })
}

export function resetPaletteLog(): void {
  logged.clear()
}

async function readPalette(serverUrl: string | null, query: () => Promise<unknown>): Promise<PaletteView> {
  try {
    const raw = await query()
    const view = withServer(resolvePalettePaint(raw), serverUrl)
    if (view.origin === 'unknown') noteUnknown(serverUrl, view.reason)
    return view
  } catch (err) {
    const reason = failureReason(err)
    noteUnknown(serverUrl, reason)
    return bundledView('unknown', reason, serverUrl)
  }
}

export function usePalette(): PaletteView {
  const { state, controller } = useConnection()
  const system = controller.getSystem()
  const serverUrl = system?.serverUrl ?? null
  const queryClient = useQueryClient()
  const previous = useRef<string | null>(null)

  const query = useQuery({
    queryKey: paletteQueryKey(serverUrl),
    enabled: state === 'connected' && serverUrl !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: (): Promise<PaletteView> => {
      const live = controller.getSystem()
      if (live === null) return Promise.resolve(bundledView('unknown', 'disconnected', serverUrl))
      return readPalette(serverUrl, () => live.trpcClient.displayPalette.getPalette.query())
    },
  })

  useEffect(() => {
    if (serverUrl === null) {
      setPaletteView(bundledView('pending', null, null))
      return
    }
    if (query.data === undefined) {
      if (getPaletteView().serverUrl !== serverUrl) {
        setPaletteView(bundledView('pending', null, serverUrl))
      }
      return
    }
    setPaletteView(withServer(query.data, serverUrl))
  }, [serverUrl, query.data])

  useEffect(() => {
    const was = previous.current
    previous.current = state
    if (shouldRefreshPalette(was, state)) {
      void queryClient.invalidateQueries({ queryKey: paletteQueryKey(serverUrl) })
    }
  }, [state, serverUrl, queryClient])

  return usePaletteView()
}
