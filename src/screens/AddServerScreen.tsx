/**
 * "Add server" — the login for ANOTHER hub, opened while signed in to one.
 *
 * Outside the `(app)` group (a root-stack route), so the connected app stays
 * mounted underneath and nothing is signed out: the current server keeps its
 * token, and a successful sign-in here makes the new server active through the
 * same `save` the auth gate uses. Cancel goes back to where it was opened.
 */
import React from 'react'
import { router, useLocalSearchParams, type Href } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { LoginScreen } from './LoginScreen.js'
import { useServer } from '../app/ServerProvider.js'
import { deepLinkLanding } from '../navigation/pending-deep-link.js'
import { parseHubOrigin } from '../connection/hub-origin.js'
import { serverLabelForUrl } from '../connection/server-name.js'

export function AddServerScreen() {
  const { t } = useTranslation()
  const params = useLocalSearchParams<{ url?: string; then?: string }>()
  const { servers } = useServer()
  // A URL in the route may have come from a link: only a bare https origin,
  // or the exact URL of a server already saved here (Settings re-signing a
  // LAN http hub), is used as a prefill; anything else starts empty.
  const saved = servers.find((s) => s.serverUrl === params.url)
  const prefill = saved?.serverUrl ?? parseHubOrigin(params.url)
  const landing = deepLinkLanding(params.then)

  return (
    <LoginScreen
      initialServerUrl={prefill ?? 'https://'}
      heading={prefill !== null ? t('v2.connect.addTitle', { name: serverLabelForUrl(servers, prefill) }) : t('v2.servers.add')}
      subheading={t('v2.connect.addBody')}
      onCancel={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/')
      }}
      // Documented type boundary: `landing` is constrained to the app's
      // route families by `deepLinkLanding`; expo-router's Href is a
      // template-literal union no runtime string satisfies structurally.
      onSignedIn={() => router.replace(landing as Href)}
    />
  )
}
