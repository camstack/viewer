/**
 * The shell's Account screen (`/account`, D1102): who is signed in, the hubs this
 * device knows, this device's certificate, the tokens this account minted, how
 * the user signs in and every device signed in. It moved here from the viewer's
 * Settings (Account segment and the stacked Sign-in methods screen); the sections
 * are the same components, in the same order.
 *
 *   • Servers          — signed in as, switch / add / remove a hub, sign out.
 *   • This device      — the device certificate and "Keep this device signed in".
 *   • Tokens           — the tokens this account minted.
 *   • Password         — change it (`auth.changeOwnPassword`).
 *   • Authenticator    — TOTP status, set up, confirm, turn off.
 *   • Passkeys         — list, remove, second-factor switch, add.
 *   • Linked accounts  — external identities: list, unlink, link.
 *   • Active sessions  — every device signed in (D812): sign one out, or all.
 *
 * Linking, turning the authenticator off, removing a passkey and minting an
 * admin token ask "Confirm it's you" first (D813): one sheet for the screen.
 *
 * Every call is the hub's SELF-SERVICE family, bound to the caller's session, so
 * this screen can never read or change another user. A stacked route over the
 * tabs (`app/(app)/account.tsx`); the old `/settings/sign-in` redirects here.
 */
import React from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import { useServer } from '../../app/ServerProvider.js'
import { ScreenHeader } from '../../components/ScreenHeader.js'
import { KeyboardAwareScrollView } from '../../components/ui/KeyboardInset.js'
import { useMe } from '../../data/use-me.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { SettingsGrid } from '../settings/SettingsGrid.js'
import { ServersSection } from '../settings/ServersSection.js'
import { ThisDeviceSection } from '../settings/ThisDeviceSection.js'
import { TokensSection } from '../settings/tokens/TokensSection.js'
import { PasswordSection } from '../settings/sign-in/PasswordSection.js'
import { TotpSection } from '../settings/sign-in/TotpSection.js'
import { PasskeysSection } from '../settings/sign-in/PasskeysSection.js'
import { LinkedAccountsSection } from '../settings/sign-in/LinkedAccountsSection.js'
import { ActiveSessionsSection } from '../settings/sign-in/ActiveSessionsSection.js'
import { ReauthProvider } from '../settings/sign-in/ReauthSheet.js'

/** The Account route; the drawer opens it and `/settings/sign-in` redirects to it. */
export const ACCOUNT_PATH = '/account'

export function AccountScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { signOut } = useServer()
  const { data: me } = useMe()
  return (
    <ReauthProvider>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title={t('v2.settings.segments.account')} onBack={() => router.back()} bordered />
        <KeyboardAwareScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: SPACING.xl, paddingBottom: SPACING['3xl'], gap: SPACING['2xl'] }}
        >
          <SettingsGrid>
            <ServersSection
              accountValue={
                me == null
                  ? t('v2.settings.accountUnknown')
                  : `${me.username} · ${me.isAdmin ? t('v2.settings.roleAdmin') : t('v2.settings.roleViewer')}`
              }
              onSignOut={() => {
                void signOut()
              }}
            />
            <ThisDeviceSection />
            <TokensSection />
            <PasswordSection />
            <TotpSection />
            <PasskeysSection />
            <LinkedAccountsSection />
            <ActiveSessionsSection />
          </SettingsGrid>
        </KeyboardAwareScrollView>
      </View>
    </ReauthProvider>
  )
}
