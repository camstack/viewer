/**
 * Settings → Account: who is signed in, how they sign in, which hubs this
 * device knows (switch / add / remove / sign out), and — folded under their
 * titles (operator-approved layout, 2026-10-21) — the tokens this account
 * minted and the devices signed in to it.
 *
 * "Integration access" (the account links Home Assistant and other apps hold)
 * is not listed: the hub has no way yet to list one user's own account links.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import { useServer } from '../../app/ServerProvider.js'
import { useMe } from '../../data/use-me.js'
import { SettingsGrid } from './SettingsGrid.js'
import { ServersSection } from './ServersSection.js'
import { ThisDeviceSection } from './ThisDeviceSection.js'
import { TokensSection } from './tokens/TokensSection.js'
import { ActiveSessionsSection } from './sign-in/ActiveSessionsSection.js'
import { ReauthProvider } from './sign-in/ReauthSheet.js'

/** The stacked Sign-in methods screen (`app/(app)/settings/sign-in.tsx`). */
export const SIGN_IN_METHODS_PATH = '/settings/sign-in'

export function AccountSegment() {
  const { t } = useTranslation()
  const { signOut } = useServer()
  const { data: me } = useMe()

  return (
    // The admin-token mint asks for a fresh re-authentication.
    <ReauthProvider>
      <SettingsGrid>
        <ServersSection
          accountValue={
            me == null
              ? t('v2.settings.accountUnknown')
              : `${me.username} · ${me.isAdmin ? t('v2.settings.roleAdmin') : t('v2.settings.roleViewer')}`
          }
          onOpenSignInMethods={() => router.push(SIGN_IN_METHODS_PATH)}
          onSignOut={() => {
            void signOut()
          }}
        />
        <ThisDeviceSection />
        <TokensSection />
        <ActiveSessionsSection collapsible />
      </SettingsGrid>
    </ReauthProvider>
  )
}
