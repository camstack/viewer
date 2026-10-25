/**
 * use-activity-host — keeps the Activity list true to the hub, once per app.
 *
 * Mounted a single time inside the connected subtree (which is keyed by server
 * id, so a switch re-mounts it): it binds the store to the active server,
 * folds the hub's export records into the list, and asks again when the app
 * comes back to the foreground — an export that finished while the phone slept
 * shows READY the moment the operator returns.
 */
import { useEffect } from 'react'
import { AppState } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'

import { useServer } from '../app/ServerProvider.js'
import { useExportEvents, useExportsList } from '../data/use-exports.js'
import { useActivityStore } from './activity-instance.js'
import { activeExportRecords } from './activity-reconcile.js'

const EXPORTS_KEY = ['v2', 'exports'] as const

export function useActivityHost(): void {
  const { server } = useServer()
  const serverId = server?.id ?? null
  const queryClient = useQueryClient()
  const bind = useActivityStore((s) => s.bind)
  const reconcile = useActivityStore((s) => s.reconcile)
  const { data: records } = useExportsList()
  const live = useExportEvents()

  useEffect(() => {
    void bind(serverId)
  }, [bind, serverId])

  // The hub's list, with the event stream's fresher progress laid over it.
  useEffect(() => {
    if (records === undefined) return
    reconcile(activeExportRecords(records, live))
  }, [records, live, reconcile])

  // Back in front of the operator: ask again rather than wait for a poll tick.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void queryClient.invalidateQueries({ queryKey: EXPORTS_KEY })
    })
    return () => subscription.remove()
  }, [queryClient])
}
