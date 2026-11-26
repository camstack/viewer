/**
 * The shell's Account screen (`/account`, D1102): this device's certificate, the tokens this account minted, how
 * the user signs in and every device signed in. It moved here from the viewer's
 * Settings (Account segment and the stacked Sign-in methods screen); the sections
 * are the same components, in the same order. Who is signed in, the hub switch,
 * add / remove a hub and sign out live in the drawer's user block, not here.
 *
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
import { ScreenHeader } from '../../components/ScreenHeader.js'
import { KeyboardAwareScrollView } from '../../components/ui/KeyboardInset.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { SettingsGrid } from '../settings/SettingsGrid.js'
import { ThisDeviceSection } from './ThisDeviceSection.js'
import { TokensSection } from './tokens/TokensSection.js'
import { PasswordSection } from './sign-in/PasswordSection.js'
import { TotpSection } from './sign-in/TotpSection.js'
import { PasskeysSection } from './sign-in/PasskeysSection.js'
import { LinkedAccountsSection } from './sign-in/LinkedAccountsSection.js'
import { ActiveSessionsSection } from './sign-in/ActiveSessionsSection.js'
import { ReauthProvider } from '../settings/sign-in/ReauthSheet.js'

/** The Account route; the drawer opens it and `/settings/sign-in` redirects to it. */
export const ACCOUNT_PATH = '/account'

export function AccountScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <ReauthProvider>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title={t('v2.apps.account')} onBack={() => router.back()} bordered />
        <KeyboardAwareScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: SPACING.xl, paddingBottom: SPACING['3xl'], gap: SPACING['2xl'] }}
        >
          <SettingsGrid>
            <ThisDeviceSection />
            <TokensSection />
            <PasswordSection />
            <TotpSection />
            <PasskeysSection />
            <LinkedAccountsSection />
            <ActiveSessionsSection collapsible />
          </SettingsGrid>
        </KeyboardAwareScrollView>
      </View>
    </ReauthProvider>
  )
}
