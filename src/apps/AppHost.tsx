/**
 * AppHost — mounts the drawer, the account sheet and the framed app over the
 * viewer, and settles which app opens at launch.
 *
 * The viewer stays mounted underneath: its navigation, and the bottom bar or
 * side rail that belongs to it, are simply covered while an embedded app is on
 * screen. Which apps exist is the hub's answer (`apps.listApps`); nothing here
 * names one. The launch resolution runs once per session, after the device
 * settings are read and — when the wanted app is an embedded one — after the
 * list has answered.
 */
import React, { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useServer } from '../app/ServerProvider.js'
import { useAppCatalog } from '../data/use-apps.js'
import { useTheme } from '../theme/theme-provider.js'
import { findApp, isHostedEntry } from './app-catalog.js'
import { launchResolvable, offeredLaunchPreferences, resolveLaunchApp } from './app-launch.js'
import { useAppStore } from './app-store.js'
import { AppDrawer } from './AppDrawer.js'
import { EmbeddedApp } from './EmbeddedApp.js'

export function AppHost(): React.JSX.Element {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const { server } = useServer()
  const { catalog } = useAppCatalog()
  const hydrated = useAppStore((s) => s.hydrated)
  const settled = useAppStore((s) => s.launchSettled)
  const preference = useAppStore((s) => s.launchPreference)
  const lastApp = useAppStore((s) => s.lastApp)
  const active = useAppStore((s) => s.active)

  useEffect(() => {
    void useAppStore.getState().hydrate()
  }, [])

  // Another server is another session: leave the embedded app, resolve afresh.
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
    if (!hydrated || settled || !launchResolvable(preference, lastApp, catalog)) return
    useAppStore.getState().settleLaunch(resolveLaunchApp(preference, lastApp, catalog))
  }, [hydrated, settled, preference, lastApp, catalog])

  // A stored preference the hub no longer offers (a legacy bare id) goes back to "last used".
  // Note: a failed listApps at boot settles the launch to the Viewer for the session.
  useEffect(() => {
    if (catalog.status === 'answered' && !offeredLaunchPreferences(catalog).includes(preference)) {
      useAppStore.getState().setLaunchPreference('last')
    }
  }, [catalog, preference])

  // The app on screen is gone from an ANSWERED list (the session lost it): back to the shell.
  const activeId = active.appId
  useEffect(() => {
    if (activeId !== null && catalog.status === 'answered' && findApp(catalog, activeId) === null) {
      useAppStore.getState().open({ appId: null })
    }
  }, [activeId, catalog])

  const info = activeId === null ? null : findApp(catalog, activeId)
  const framed = info !== null && !isHostedEntry(info.app.entry)

  return (
    <>
      {framed ? (
        <View style={[styles.overlay, { backgroundColor: colors.background }]} testID="app-host-frame">
          <EmbeddedApp key={info.app.id} info={info} title={t(info.app.label.key, { defaultValue: info.app.label.fallback })} />
        </View>
      ) : null}
      <AppDrawer />
    </>
  )
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 40 },
})
