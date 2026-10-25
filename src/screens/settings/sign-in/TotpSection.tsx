/**
 * Sign-in methods → Authenticator app (TOTP).
 *
 * Off → Set up: the hub mints a secret (`auth.setupOwnTotp`, NOT yet active);
 * the operator adds it to an authenticator — "Open in authenticator" on a
 * phone (the `otpauth://` link is what authenticator apps register for), the
 * secret to copy anywhere, and the QR on the web, where the authenticator is on
 * ANOTHER device — then types the current code to confirm. Only the confirm
 * turns it on.
 *
 * On → Turn off, behind a confirmation and "Confirm it's you" (D813).
 */
import React, { useState } from 'react'
import { Linking, Platform, Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import Svg, { Path } from 'react-native-svg'
import { Copy, ShieldCheck } from '../../../lib/icons.js'
import { Section } from '../../../components/ui/Section.js'
import { Row } from '../../../components/ui/Row.js'
import { useConfirm, useNotice } from '../../../components/ui/confirm.js'
import { copyText } from '../../../lib/copy-text.js'
import { useDateLocale } from '../../../lib/date-locale.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { useConfirmTotp, useDisableTotp, useSetupTotp, useTotpStatus } from '../../../data/use-sign-in-methods.js'
import { TOTP_CODE_LENGTH, groupSecret, normalizeTotpCode, type TotpEnrollment } from '../../../data/sign-in-methods.js'
import { Field, Panel, PanelText } from './form-parts.js'
import { qrPath } from './qr-path.js'
import { useReauth } from './ReauthSheet.js'
import { Button } from '../../../components/ui/Button.js'

const QR_SIZE_PT = 184

export function TotpSection() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const notice = useNotice()
  const locale = useDateLocale()
  const status = useTotpStatus()
  const setup = useSetupTotp()
  const disable = useDisableTotp()
  const reauth = useReauth()
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null)

  const handleSetup = (): void => {
    setup.mutate(undefined, {
      onSuccess: setEnrollment,
      onError: (err) => notice({ title: t('v2.signIn.totp.setupFailed'), message: err.message }),
    })
  }

  const handleDisable = (): void => {
    void confirm({
      title: t('v2.signIn.totp.disableTitle'),
      message: t('v2.signIn.totp.disableBody'),
      confirmLabel: t('v2.signIn.totp.disable'),
      destructive: true,
    })
      .then((ok) => (ok ? reauth(t('v2.signIn.reauth.actionDisableTotp')) : null))
      .then((proof) => {
        if (proof === null) return
        disable.mutate(proof.reauthToken, {
          onError: (err) => notice({ title: t('v2.signIn.totp.disableFailed'), message: err.message }),
        })
      })
  }

  const enabled = status.data?.enabled === true
  const confirmedAt = status.data?.confirmedAt ?? null
  const statusValue = status.isPending
    ? '…'
    : enabled
      ? confirmedAt !== null
        ? t('v2.signIn.totp.onSince', { date: new Date(confirmedAt).toLocaleDateString(locale) })
        : t('v2.signIn.on')
      : t('v2.signIn.off')

  return (
    <Section title={t('v2.signIn.totp.title')}>
      <Row icon={ShieldCheck} label={t('v2.signIn.totp.status')} value={statusValue} last={status.isPending} />
      {status.isPending ? null : enrollment !== null ? (
        <EnrollmentPanel enrollment={enrollment} onDone={() => setEnrollment(null)} />
      ) : enabled ? (
        <Row label={t('v2.signIn.totp.disable')} danger onPress={handleDisable} last />
      ) : (
        <Row
          label={setup.isPending ? t('v2.signIn.working') : t('v2.signIn.totp.setup')}
          onPress={handleSetup}
          last
        />
      )}
    </Section>
  )
}

function EnrollmentPanel({ enrollment, onDone }: { readonly enrollment: TotpEnrollment; readonly onDone: () => void }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const notice = useNotice()
  const confirmTotp = useConfirmTotp()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  // On the web the authenticator is on another device: the QR is the way in.
  // On a phone it is the same device, and a QR on the screen it would have to
  // photograph is useless — the link and the secret are.
  const web = Platform.OS === 'web'

  const handleConfirm = (): void => {
    if (code.length !== TOTP_CODE_LENGTH) {
      setError(t('v2.signIn.totp.codeLength', { count: TOTP_CODE_LENGTH }))
      return
    }
    setError(null)
    confirmTotp.mutate(code, {
      onSuccess: () => {
        onDone()
        notice({ title: t('v2.signIn.totp.enabled') })
      },
      onError: (err) => setError(err.message),
    })
  }

  const handleCopy = (): void => {
    void copyText(enrollment.secret).then((ok) => {
      notice({ title: ok ? t('v2.signIn.totp.secretCopied') : t('v2.signIn.totp.copyFailed') })
    })
  }

  return (
    <Panel>
      <PanelText>{web ? t('v2.signIn.totp.stepScan') : t('v2.signIn.totp.stepOpen')}</PanelText>
      {web ? <TotpQr url={enrollment.otpauthUrl} /> : null}
      {!web ? (
        <Button
          label={t('v2.signIn.totp.openAuthenticator')}
          onPress={() => {
            void Linking.openURL(enrollment.otpauthUrl).catch(() => {
              notice({ title: t('v2.signIn.totp.noAuthenticator') })
            })
          }}
          testID="totp-open"
        />
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SPACING.md,
          padding: SPACING.md,
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text
          selectable
          testID="totp-secret"
          style={{ flex: 1, color: colors.foreground, fontSize: 15, fontFamily: 'monospace' }}
        >
          {groupSecret(enrollment.secret)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('v2.signIn.totp.copySecret')}
          hitSlop={8}
          onPress={handleCopy}
          testID="totp-copy"
        >
          <Copy size={18} color={colors.foregroundMuted} />
        </Pressable>
      </View>
      <Field
        label={t('v2.signIn.totp.code')}
        value={code}
        onChangeText={(v) => setCode(normalizeTotpCode(v))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        maxLength={TOTP_CODE_LENGTH}
        testID="totp-code"
      />
      {error !== null ? <PanelText tone="danger">{error}</PanelText> : null}
      <Button
        label={confirmTotp.isPending ? t('v2.signIn.working') : t('v2.signIn.totp.confirm')}
        onPress={handleConfirm}
        disabled={confirmTotp.isPending}
        testID="totp-confirm"
      />
      <Button label={t('v2.settings.cancel')} kind="secondary" onPress={onDone} />
    </Panel>
  )
}

function TotpQr({ url }: { readonly url: string }) {
  const { size, d } = qrPath(url)
  // Dark modules on WHITE regardless of theme, with a quiet zone: a QR inverted
  // for dark mode is one many authenticator scanners refuse.
  return (
    <View
      testID="totp-qr"
      // ui-check-ok: a QR code needs pure white behind pure black modules on every theme (scanner contrast)
      style={{ alignSelf: 'center', backgroundColor: '#ffffff', padding: SPACING.md, borderRadius: RADIUS.md }}
    >
      <Svg width={QR_SIZE_PT} height={QR_SIZE_PT} viewBox={`0 0 ${size} ${size}`}>
        {/* ui-check-ok: QR modules are pure black on every theme (scanner contrast) */}
        <Path d={d} fill="#000000" />
      </Svg>
    </View>
  )
}
