/**
 * "Confirm it's you" (D813) — the re-authentication in front of the
 * sensitive self-service actions: linking a sign-in account, turning off the
 * authenticator, removing a passkey. The hub refuses them (FORBIDDEN) without
 * a fresh 5-minute proof, bound to this user AND this session, even though the
 * app is signed in. Same wording as admin-ui's `ReauthDialog`.
 *
 * The current password everywhere; a passkey too in the hub-served web viewer,
 * where the browser can run the ceremony for the hub's origin. The native app
 * cannot (the passkey's relying party is the hub's web origin), so it offers
 * the password alone.
 *
 * `useReauth().requestProof(action)` resolves with the proof — `reauthToken:
 * null` on an older hub that has no re-authentication — or `null` when the
 * operator cancels. One sheet for the whole screen (`ReauthProvider`).
 */
import React, { createContext, useCallback, useContext, useRef, useState } from 'react'
import { Platform, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SheetModal } from '../../../components/ui/SheetModal.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { useReauthCalls } from '../../../data/use-sign-in-methods.js'
import type { ReauthProof } from '../../../data/sign-in-actions.js'
import { passkeyCeremonyAvailable, runPasskeyAssertion } from '../../../auth/webauthn-assertion.js'
import { Field, PanelText } from './form-parts.js'
import { Button } from '../../../components/ui/Button.js'

type RequestProof = (action: string) => Promise<ReauthProof | null>

const ReauthContext = createContext<RequestProof | null>(null)

export function useReauth(): RequestProof {
  const request = useContext(ReauthContext)
  if (request === null) throw new Error('useReauth must be used within ReauthProvider')
  return request
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.length > 0 ? err.message : fallback
}

export function ReauthProvider({ children }: { readonly children: React.ReactNode }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const calls = useReauthCalls()
  const [action, setAction] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'password' | 'passkey' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<((proof: ReauthProof | null) => void) | null>(null)
  const passkey = Platform.OS === 'web' && passkeyCeremonyAvailable()

  const settle = useCallback((proof: ReauthProof | null) => {
    pending.current?.(proof)
    pending.current = null
    setAction(null)
    setPassword('')
    setBusy(null)
    setError(null)
  }, [])

  const requestProof = useCallback<RequestProof>(
    (next) =>
      new Promise<ReauthProof | null>((resolve) => {
        pending.current?.(null)
        pending.current = resolve
        setError(null)
        setAction(next)
      }),
    [],
  )

  const withPassword = (): void => {
    if (password.length === 0 || busy !== null) return
    setBusy('password')
    setError(null)
    calls.prove({ password }).then(settle, (err: unknown) => {
      setError(errorMessage(err, t('v2.signIn.reauth.wrongPassword')))
      setBusy(null)
    })
  }

  const withPasskey = (): void => {
    if (busy !== null) return
    setBusy('passkey')
    setError(null)
    calls
      .passkeyOptions()
      .then(runPasskeyAssertion)
      .then((passkeyResponse) => calls.prove({ passkeyResponse }))
      .then(settle, (err: unknown) => {
        setError(errorMessage(err, t('v2.signIn.reauth.passkeyFailed')))
        setBusy(null)
      })
  }

  return (
    <ReauthContext.Provider value={requestProof}>
      {children}
      <SheetModal
        visible={action !== null}
        onClose={() => settle(null)}
        testID="reauth-sheet"
        sheetStyle={{
          backgroundColor: colors.background,
          borderTopLeftRadius: RADIUS.xl,
          borderTopRightRadius: RADIUS.xl,
          padding: SPACING.xl,
          paddingBottom: SPACING['3xl'],
          gap: SPACING.md,
        }}
      >
        <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: '600' }}>{t('v2.signIn.reauth.title')}</Text>
        <PanelText>
          {t(passkey ? 'v2.signIn.reauth.bodyPasskey' : 'v2.signIn.reauth.body', { action: action ?? '' })}
        </PanelText>
        <Field
          label={t('v2.signIn.reauth.password')}
          value={password}
          onChangeText={setPassword}
          secure
          autoComplete="current-password"
          testID="reauth-password"
        />
        {error !== null ? <PanelText tone="danger">{error}</PanelText> : null}
        <View style={{ gap: SPACING.sm }}>
          <Button
            label={busy === 'password' ? t('v2.signIn.working') : t('v2.signIn.reauth.confirm')}
            onPress={withPassword}
            disabled={password.length === 0 || busy !== null}
            testID="reauth-confirm"
          />
          {passkey ? (
            <Button
              label={busy === 'passkey' ? t('v2.signIn.working') : t('v2.signIn.reauth.usePasskey')}
              kind="secondary"
              onPress={withPasskey}
              disabled={busy !== null}
              testID="reauth-passkey"
            />
          ) : null}
          <Button label={t('v2.settings.cancel')} kind="secondary" onPress={() => settle(null)} testID="reauth-cancel" />
        </View>
      </SheetModal>
    </ReauthContext.Provider>
  )
}
