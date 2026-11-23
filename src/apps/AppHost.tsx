/**
 * AppHost — mounts the app drawer and the framed apps (Admin, a node's UI) over
 * the viewer, and settles which app opens at launch.
 *
 * The viewer stays mounted underneath: its navigation, and the bottom bar or
 * side rail that belongs to it, are simply covered while Admin is on screen.
 * The launch resolution runs once per session, after the device settings are
 * read and — when the wanted app is Admin — after `auth.me` has answered.
 */
import React, { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

import { useServer } from '../app/ServerProvider.js'
import { useAdminVerdict } from '../data/use-me.js'
import { useTheme } from '../theme/theme-provider.js'
import { adminSurfacesOffered, launchResolvable, resolveLaunchApp } from './app-launch.js'
import { useAppStore } from './app-store.js'
import { AdminApp } from './AdminApp.js'
import { AppDrawer } from './AppDrawer.js'
import { NodeApp } from './NodeApp.js'

export function AppHost(): React.JSX.Element {
  const { colors } = useTheme()
  const { server } = useServer()
  const verdict = useAdminVerdict()
  const hydrated = useAppStore((s) => s.hydrated)
  const settled = useAppStore((s) => s.launchSettled)
  const preference = useAppStore((s) => s.launchPreference)
  const lastApp = useAppStore((s) => s.lastApp)
  const active = useAppStore((s) => s.active)

  useEffect(() => {
    void useAppStore.getState().hydrate()
  }, [])

  // Another server is another session: leave Admin and node UIs, resolve afresh.
  const serverId = server?.id ?? null
  const previous = useRef(serverId)
  useEffect(() => {
    if (previous.current !== serverId) {
      previous.current = serverId
      useAppStore.getState().resetSession()
    }
  }, [serverId])

  // Launch resolution: once, when it can be decided.
  useEffect(() => {
    if (!hydrated || settled || !launchResolvable(preference, lastApp, verdict)) return
    useAppStore.getState().settleLaunch(resolveLaunchApp(preference, lastApp, verdict))
  }, [hydrated, settled, preference, lastApp, verdict])

  // Admin was lost (the session is no longer an admin one): fall back to the viewer.
  useEffect(() => {
    if ((active.kind === 'admin' || active.kind === 'node') && verdict === 'not-admin') {
      useAppStore.getState().open({ kind: 'viewer' })
    }
  }, [active.kind, verdict])

  const framed = (active.kind === 'admin' || active.kind === 'node') && adminSurfacesOffered(verdict)

  return (
    <>
      {framed ? (
        <View style={[styles.overlay, { backgroundColor: colors.background }]} testID="app-host-frame">
          {active.kind === 'admin' ? <AdminApp /> : active.kind === 'node' ? <NodeApp key={active.nodeId} nodeId={active.nodeId} nodeName={active.nodeName} /> : null}
        </View>
      ) : null}
      <AppDrawer />
    </>
  )
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 40 },
})
