/**
 * The embed does not share the app's React Query cache — an iframe has its
 * own `System`. It reads `displayPalette.getPalette` on that client, the same
 * router the app uses, and writes the shared paint store. A reconnect of this
 * system refreshes the row for its server URL.
 */
import { useEffect } from 'react'
import type { BackendConnectionState, System } from '@camstack/sdk'
import { emitHost } from './host-bridge'
import {
  bundledView,
  failureReason,
  resolvePalettePaint,
  setPaletteView,
  withServer,
  type PaletteView,
} from '../../../shared/palette'

const cache = new Map<string, PaletteView>()
const logged = new Set<string>()

function noteUnknown(serverUrl: string, reason: string | null): void {
  const key = `${serverUrl}|${reason ?? ''}`
  if (logged.has(key)) return
  logged.add(key)
  emitHost({
    type: 'log',
    scope: 'palette',
    msg: 'display palette unknown; painting the bundled preset',
    data: { reason, serverUrl },
  })
}

async function loadPalette(system: System): Promise<PaletteView> {
  const serverUrl = system.serverUrl
  try {
    const raw: unknown = await system.trpcClient.displayPalette.getPalette.query()
    const view = withServer(resolvePalettePaint(raw), serverUrl)
    if (view.origin === 'unknown') noteUnknown(serverUrl, view.reason)
    else cache.set(serverUrl, view)
    return view
  } catch (err) {
    const reason = failureReason(err)
    noteUnknown(serverUrl, reason)
    return bundledView('unknown', reason, serverUrl)
  }
}

export function resetEmbedPaletteCache(): void {
  cache.clear()
  logged.clear()
}

export function useEmbedPalette(system: System): void {
  useEffect(() => {
    const cached = cache.get(system.serverUrl)
    if (cached !== undefined) setPaletteView(cached)
    let cancelled = false
    void loadPalette(system).then((view) => {
      if (!cancelled) setPaletteView(view)
    })
    return () => {
      cancelled = true
    }
  }, [system])

  useEffect(() => {
    let previous: BackendConnectionState | null = null
    return system.subscribeConnectionEvents((state) => {
      const was = previous
      previous = state
      if (was !== null && was !== 'connected' && state === 'connected') {
        void loadPalette(system).then((view) => setPaletteView(view))
      }
    })
  }, [system])
}
