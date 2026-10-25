/**
 * Settings → Account → Sign-in methods: how THIS user signs in to the hub.
 *
 *   • Password         — change it (`auth.changeOwnPassword`).
 *   • Authenticator    — TOTP status, set up (open in authenticator / copy the
 *                        secret / QR on the web), confirm, turn off.
 *   • Passkeys         — list, remove, second-factor switch, add.
 *   • Linked accounts  — external identities: list (unavailable ones too),
 *                        unlink, link.
 *   • Active sessions  — every device signed in (D812): sign one out, or all.
 *
 * Linking, turning the authenticator off and removing a passkey ask "Confirm
 * it's you" first (D813, `ReauthSheet.tsx`): one sheet for the screen.
 *
 * Every call is the hub's SELF-SERVICE family: bound to the caller's session,
 * so this screen can never read or change another user. A stacked route over
 * the tabs (`app/(app)/settings/sign-in.tsx`).
 */
import React from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import { ScreenHeader } from '../../components/ScreenHeader.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { SettingsGrid } from './SettingsGrid.js'
import { PasswordSection } from './sign-in/PasswordSection.js'
import { TotpSection } from './sign-in/TotpSection.js'
import { PasskeysSection } from './sign-in/PasskeysSection.js'
import { LinkedAccountsSection } from './sign-in/LinkedAccountsSection.js'
import { ActiveSessionsSection } from './sign-in/ActiveSessionsSection.js'
import { ReauthProvider } from './sign-in/ReauthSheet.js'
import { KeyboardAwareScrollView } from '../../components/ui/KeyboardInset.js'

export function SignInMethodsScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <ReauthProvider>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title={t('v2.signIn.title')} onBack={() => router.back()} bordered />
        <KeyboardAwareScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: SPACING.xl, paddingBottom: SPACING['3xl'], gap: SPACING['2xl'] }}
        >
          <SettingsGrid>
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
