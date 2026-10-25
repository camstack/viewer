import React, { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { login, verifyTotp } from '../auth/login.js'
import { isValidServerUrl } from '../auth/handoff.js'
import { appFlowErrorKey, redeemBoundHandoffCode } from '../device-cert/app-login-handoff.js'
import { useSessionNotice } from '../auth/session-notice-store.js'
import { useDeviceNotice } from '../device-cert/device-notice-store.js'
import { renewInBackground } from '../device-cert/device-sign-in.js'
import { loginWithCertificate, setAutoLogin } from '../device-cert/device-session.js'
import { deviceTarget, isSecureHub } from '../device-cert/transport.js'
import { fetchLoginMethods, primaryBrowserArms, type BrowserArm, type LoginMethodView } from '../device-cert/login-methods.js'
import { deviceCertDeps, deviceCertificatesSupported } from '../device-cert/deps.js'
import { createHandoffDeps } from '../device-cert/runtime.js'
import { runAppLoginHandoff } from '../device-cert/run-app-login-handoff.js'
import { log } from '../lib/logger.js'
import {
  HubUnreachableError,
  currentPageProtocol,
  hubHostOf,
  isHubUnreachable,
  isMixedContentHub,
  isNotCamstackHub,
} from '../auth/web-reachability.js'
import { loginEnterAction, loginReturnKey, type LoginField } from './login-enter.js'
import { useServer } from '../app/ServerProvider.js'
import { useTheme } from '../theme/theme-provider.js'
import { KeyboardAwareScrollView } from '../components/ui/KeyboardInset.js'
import { SPACING, RADIUS } from '../theme/tokens.js'
import type { ColorTokens } from '../theme/tokens.js'
import { BrandLogo } from '../theme/brand-logo.js'
import { Eye, EyeOff, Scan, Server as ServerIcon } from '../lib/icons.js'
import { sameHubOrigin, serverDisplayName } from '../connection/hub-origin.js'
import { fetchCustomServerName, serverLabelOf } from '../connection/server-name.js'
import type { SavedServer } from '../connection/server-switch.js'
import type { SessionCredentials } from '../connection/server-store.js'

/** Two-phase login state:
 *   • 'credentials' — server URL + username + password form
 *   • 'totp'        — credentials accepted, awaiting 6-digit TOTP code
 */
type LoginPhase = 'credentials' | 'totp'

/** React Native's fetch: a request that got no response. */
function isNativeNetworkFailure(error: unknown): boolean {
  return error instanceof Error && /network request failed/i.test(error.message)
}

/** Props that give a login field its Enter / return-key behaviour. */
interface EnterProps {
  readonly returnKeyType: 'next' | 'go'
  readonly onSubmitEditing: () => void
  /** Web keeps focus on submit (an error leaves the operator in the field);
   *  native keeps the keyboard up while moving to the next field. */
  readonly blurOnSubmit: boolean
  readonly ref: (node: TextInput | null) => void
}

function useEnterProps(onSubmit: () => void): (field: LoginField) => EnterProps {
  const refs = useRef<Partial<Record<LoginField, TextInput | null>>>({})
  return (field) => ({
    ref: (node) => {
      refs.current[field] = node
    },
    returnKeyType: loginReturnKey(field),
    blurOnSubmit: Platform.OS !== 'web' && loginReturnKey(field) === 'go',
    onSubmitEditing: () => {
      const action = loginEnterAction(field, Platform.OS)
      if (action.kind === 'submit') onSubmit()
      else refs.current[action.field]?.focus()
    },
  })
}

/**
 * How long a login request may run before the screen says it is still trying.
 * The request itself is bounded at `LOGIN_REACH_TIMEOUT_MS` (15 s); without
 * this, those 15 s are a spinner and nothing else, which reads as a hang.
 */
export const LOGIN_SLOW_HINT_MS = 5_000

/** One credentials / TOTP request in flight — an object, so two attempts at
 *  the same host are still two attempts. */
interface PendingRequest {
  readonly host: string
}

/**
 * The host a login request is waiting on, once it has waited
 * {@link LOGIN_SLOW_HINT_MS}; null before that and as soon as it ends.
 */
function useSlowHintHost(pending: PendingRequest | null): string | null {
  const [slowFor, setSlowFor] = useState<PendingRequest | null>(null)
  useEffect(() => {
    if (pending === null) return undefined
    const timer = setTimeout(() => setSlowFor(pending), LOGIN_SLOW_HINT_MS)
    return () => clearTimeout(timer)
  }, [pending])
  // Identity, not host: a stale mark from the previous attempt never shows.
  return pending !== null && slowFor === pending ? pending.host : null
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export interface LoginScreenProps {
  /** Prefill for the URL field — a link's hub, or "Add server". Takes the
   *  place of the last-used URL. */
  readonly initialServerUrl?: string
  /** A line above the card ("Add hub.example.com"). */
  readonly heading?: string
  readonly subheading?: string
  /** Signed-in "add a server" flow: a Cancel under the card. Absent on the
   *  auth gate, which has nowhere to go back to. */
  readonly onCancel?: () => void
  /** Runs once a sign-in has been SAVED (the new server is active). */
  readonly onSignedIn?: () => void
}

/** Admin-ui-style login: a centered card on the theme background with the
 *  CamStack logo, a server URL field (the mobile-only addition over admin-ui),
 *  username + password, and a second TOTP phase when the server requires it. */
export function LoginScreen({
  initialServerUrl,
  heading,
  subheading,
  onCancel,
  onSignedIn,
}: LoginScreenProps = {}) {
  const { t } = useTranslation()
  const { save, lastServerUrl, rememberServerUrl, servers, server: activeServer, switchServer } = useServer()
  const { colors } = useTheme()
  // The keyboard shrinks the scroll area; without the insets the centred
  // content slides under the status bar (no header above this screen).
  const insets = useSafeAreaInsets()

  const [phase, setPhase] = useState<LoginPhase>('credentials')
  const [serverUrl, setServerUrl] = useState(initialServerUrl ?? 'https://')
  // Prefill the last-used server URL (persisted on every sign-in ATTEMPT,
  // so it survives sign-out and aborted handoffs). Seed-once-during-render
  // so provider hydration can't clobber in-progress typing. An explicit
  // `initialServerUrl` is the seed already.
  const [urlSeeded, setUrlSeeded] = useState(initialServerUrl !== undefined)
  if (!urlSeeded && lastServerUrl !== null) {
    setUrlSeeded(true)
    if (serverUrl === 'https://' || serverUrl.trim().length === 0) {
      setServerUrl(lastServerUrl)
    }
  }
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [challengeToken, setChallengeToken] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // The host a credentials / TOTP request is waiting on. Only those legs: the
  // native hub sign-in also sets `submitting`, but there the wait is the
  // operator typing in the browser sheet, not the hub being slow.
  const [pending, setPending] = useState<PendingRequest | null>(null)
  const slowHost = useSlowHintHost(pending)

  const trimmedUrl = serverUrl.trim()
  const disconnectedNotice = useDeviceNotice((st) => st.disconnected)
  const endedServer = useSessionNotice((st) => st.endedServer)
  // The saved server this address belongs to (one credential per hub, whichever route is typed).
  const knownServer = servers.find((s) => sameHubOrigin(s.serverUrl, trimmedUrl))
  const knownServerId = knownServer?.id
  // What the hub offers (debounced while the URL is typed), and whether this
  // device already holds a certificate for it.
  const [found, setFound] = useState<{
    readonly url: string
    readonly views: readonly LoginMethodView[] | null
    readonly hasDeviceCert: boolean
    /** The hub's custom name (D861), `null` for the default or an old hub. */
    readonly hubName: string | null
  } | null>(null)
  useEffect(() => {
    if (!isValidServerUrl(trimmedUrl)) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      const certKey = knownServerId
      const usable = deviceCertificatesSupported() && isSecureHub(trimmedUrl)
      void Promise.all([
        fetchLoginMethods(trimmedUrl),
        fetchCustomServerName(trimmedUrl),
        usable && certKey !== undefined ? deviceCertDeps.store.get(certKey) : Promise.resolve(null),
      ]).then(([views, hubName, record]) => {
        if (!cancelled) setFound({ url: trimmedUrl, views, hubName, hasDeviceCert: record !== null })
      })
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmedUrl, knownServerId])
  // An answer belongs to the URL it was asked for; a retyped URL starts over.
  const methods = found?.url === trimmedUrl ? found.views : null
  const hasDeviceCert = found?.url === trimmedUrl && found.hasDeviceCert
  const hubName = found?.url === trimmedUrl ? found.hubName : null
  // The hub's own name heads the sign-in; a caller's heading (the add flow) wins.
  const shownHeading = heading ?? (hubName !== null ? t('v2.login.signInTo', { name: hubName }) : undefined)
  const credentialsReady = trimmedUrl.length > 0 && username.trim().length > 0 && password.length > 0

  const hubKey = knownServer?.id ?? trimmedUrl

  const persist = async (session: SessionCredentials, options: { readonly offerDevice: boolean } = { offerDevice: true }): Promise<void> => {
    await save(
      {
        id: hubKey,
        label: knownServer?.label ?? trimmedUrl,
        serverUrl: knownServer?.serverUrl ?? trimmedUrl,
        ...(hubName !== null ? { name: hubName } : {}),
      },
      session,
    )
    useDeviceNotice.getState().setDisconnected(false)
    useSessionNotice.getState().clear()
    if (options.offerDevice) {
      // Signing in on purpose with a password (or any web method) lifts the pause a sign-out put on the certificate.
      void setAutoLogin(deviceCertDeps, hubKey, true).catch(() => undefined)
      // After any login: offer "Keep this device signed in" once, in the signed-in app.
      useDeviceNotice.getState().setEnrollOfferPending(true)
    }
    onSignedIn?.()
  }

  // Other servers this device is still signed in to — one tap back in after
  // signing out of one. Only on the auth gate; the add flow is for a NEW one.
  const otherSessions =
    onCancel === undefined
      ? servers.filter((s) => s.signedIn && s.id !== activeServer?.id)
      : []
  const handlePickSaved = (target: SavedServer): void => {
    if (submitting) return
    setError('')
    void switchServer(target.id).then((outcome) => {
      if (outcome.status === 'needs-login') setServerUrl(outcome.serverUrl)
    })
  }

  /** A request that never got an answer, or got one that was not a hub's —
   *  named as such, with the host, or null to show the hub's own error (see
   *  auth/web-reachability.ts). On web
   *  that covers the TLS and connection failures a browser reports as a bare
   *  network error; natively, the bounded login wait running out. */
  const reachMessage = (err: unknown): string | null => {
    const host = hubHostOf(trimmedUrl)
    // Something answered, so "can't reach" would be false — and the raw
    // parser error the client raises for it ("Unexpected token '<'…") tells
    // the operator nothing. Checked first: it is a different fact.
    if (isNotCamstackHub(err)) return t('v2.login.notCamstackHub', { host })
    if (Platform.OS === 'web') {
      return isHubUnreachable(err) ? t('v2.login.unreachableFromBrowser', { host }) : null
    }
    return err instanceof HubUnreachableError || isNativeNetworkFailure(err)
      ? t('v2.login.unreachable', { host })
      : null
  }

  const handleSubmitCredentials = async (): Promise<void> => {
    if (!credentialsReady || submitting) return
    // Decided before anything is sent or remembered: `abc` would otherwise be
    // fetched RELATIVE to the page (on web, the PWA's own HTML comes back) and
    // `ftp://x` would fail inside the client with a message about neither.
    if (!isValidServerUrl(trimmedUrl)) {
      setError(t('v2.login.invalidServerUrl'))
      return
    }
    await rememberServerUrl(trimmedUrl)
    if (Platform.OS === 'web' && isMixedContentHub(currentPageProtocol(), trimmedUrl)) {
      setError(t('v2.login.needsHttps'))
      return
    }
    setError('')
    setSubmitting(true)
    setPending({ host: hubHostOf(trimmedUrl) })
    try {
      const out = await login(trimmedUrl, username.trim(), password)
      if (out.status === 'totp-required') {
        setChallengeToken(out.token)
        setPhase('totp')
        return
      }
      await persist({ token: out.token, refreshToken: out.refreshToken })
    } catch (err) {
      log.warn('login', 'Sign-in failed', { message: err instanceof Error ? err.message : String(err) })
      setError(reachMessage(err) ?? getErrorMessage(err, t('v2.login.loginFailed')))
    } finally {
      setSubmitting(false)
      setPending(null)
    }
  }

  /** Native sign-in through one of the hub's browser arms (OIDC, passkey): the
   *  hub's dedicated app flow (D858) in a system auth session, bound to this run
   *  by PKCE S256 and a `state`; the hub bounces back with a one-time code that
   *  only this run's verifier redeems (the session itself never rides the
   *  redirect). The admin-UI login is never opened. Web builds served by the
   *  hub reuse the session directly instead (see HubSessionBootstrap), so this
   *  path is native-only. */
  const handleHubSignIn = async (arm: BrowserArm): Promise<void> => {
    if (submitting) return
    if (!isValidServerUrl(trimmedUrl)) {
      setError(t('v2.login.invalidServerUrl'))
      return
    }
    // Remember the attempt BEFORE the browser redirect — a dismissed or
    // failed sheet must still prefill this URL on the next visit.
    await rememberServerUrl(trimmedUrl)
    setError('')
    setSubmitting(true)
    try {
      const leg = await runAppLoginHandoff(createHandoffDeps(), {
        serverUrl: trimmedUrl,
        startPath: arm.startPath,
        purpose: 'new-session',
      })
      // Operator dismissed the sheet — not an error.
      if (leg.status === 'cancelled') return
      if (leg.status === 'error') {
        log.warn('login', 'Hub sign-in refused', { code: leg.code })
        setError(t(appFlowErrorKey(leg.code)))
        return
      }
      if (leg.status === 'refused') {
        log.warn('login', 'Handoff callback refused', { reason: leg.reason })
        setError(t('v2.login.handoffFailed'))
        return
      }
      const outcome = await redeemBoundHandoffCode(trimmedUrl, leg)
      if (outcome.status !== 'ok') {
        log.warn('login', 'Handoff code redeem failed', { status: outcome.status })
        setError(t('v2.login.handoffFailed'))
        return
      }
      await persist({ token: outcome.token, refreshToken: outcome.refreshToken })
    } catch (err) {
      log.warn('login', 'Hub sign-in handoff failed', {
        message: err instanceof Error ? err.message : String(err),
      })
      setError(getErrorMessage(err, t('v2.login.handoffFailed')))
    } finally {
      setSubmitting(false)
    }
  }

  /** "Sign in with this device": the stored certificate, on purpose (a tap). */
  const handleDeviceSignIn = async (): Promise<void> => {
    if (submitting) return
    await rememberServerUrl(trimmedUrl)
    setError('')
    setSubmitting(true)
    try {
      const target = deviceTarget({
        hubKey,
        liveUrl: trimmedUrl,
        knownUrls: knownServer === undefined ? [] : [knownServer.serverUrl],
      })
      const outcome = await loginWithCertificate(deviceCertDeps, target)
      if (outcome.status === 'signed-in') {
        await persist({ token: outcome.session.token, refreshToken: outcome.session.refreshToken }, { offerDevice: false })
        // Renewal comes after the session, never in front of it.
        renewInBackground(target)
        return
      }
      if (outcome.status === 'disconnected') {
        useDeviceNotice.getState().setDisconnected(true)
        setFound(null)
        return
      }
      setError(
        outcome.status === 'unreachable'
          ? (reachMessage(new HubUnreachableError(trimmedUrl)) ?? t('v2.device.signInFailed'))
          : t('v2.device.signInFailed'),
      )
    } catch (err) {
      log.warn('login', 'Device sign-in failed', { message: err instanceof Error ? err.message : String(err) })
      setError(reachMessage(err) ?? getErrorMessage(err, t('v2.device.signInFailed')))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmitTotp = async (): Promise<void> => {
    if (totpCode.length !== 6 || submitting) return
    setError('')
    setSubmitting(true)
    setPending({ host: hubHostOf(trimmedUrl) })
    try {
      await persist(await verifyTotp(trimmedUrl, challengeToken, totpCode))
    } catch (err) {
      setError(reachMessage(err) ?? getErrorMessage(err, t('v2.login.verifyFailed')))
      setTotpCode('')
    } finally {
      setSubmitting(false)
      setPending(null)
    }
  }

  const handleBack = (): void => {
    setPhase('credentials')
    setChallengeToken('')
    setTotpCode('')
    setError('')
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAwareScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: SPACING['2xl'],
          paddingTop: SPACING['2xl'] + insets.top,
          paddingBottom: SPACING['2xl'] + insets.bottom,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width: '100%', maxWidth: 420, gap: SPACING['2xl'] }}>
          <View style={{ alignItems: 'center' }}>
            <BrandLogo width={220} />
          </View>

          {shownHeading !== undefined && (
            <View style={{ gap: SPACING.sm }}>
              <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>
                {shownHeading}
              </Text>
              {subheading !== undefined && (
                <Text style={{ color: colors.foregroundSubtle, fontSize: 13, textAlign: 'center' }}>
                  {subheading}
                </Text>
              )}
            </View>
          )}

          <View
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: RADIUS.lg,
              padding: SPACING['2xl'],
              gap: SPACING.xl,
            }}
          >
            {endedServer !== null && <ErrorAlert colors={colors} message={t('v2.login.signedOutOf', { server: endedServer })} />}
            {disconnectedNotice && <ErrorAlert colors={colors} message={t('v2.device.disconnectedNotice')} />}
            {error.length > 0 && <ErrorAlert colors={colors} message={error} />}
            {slowHost !== null && (
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: colors.foregroundSubtle, fontSize: 13, textAlign: 'center' }}
              >
                {t('v2.login.stillTrying', { host: slowHost })}
              </Text>
            )}

            {phase === 'credentials' ? (
              <CredentialsForm
                colors={colors}
                serverUrl={serverUrl}
                username={username}
                password={password}
                showPassword={showPassword}
                submitting={submitting}
                canSubmit={credentialsReady}
                onChangeServerUrl={setServerUrl}
                onChangeUsername={setUsername}
                onChangePassword={setPassword}
                onToggleShowPassword={() => setShowPassword((v) => !v)}
                onSubmit={() => void handleSubmitCredentials()}
                methods={loginButtons({
                  views: methods,
                  hasDeviceCert,
                  native: Platform.OS !== 'web',
                  signInWithDevice: t('v2.device.signInWithDevice'),
                  onDevice: () => void handleDeviceSignIn(),
                  onHub: (arm) => void handleHubSignIn(arm),
                })}
              />
            ) : (
              <TotpForm
                colors={colors}
                username={username.trim()}
                totpCode={totpCode}
                submitting={submitting}
                onChangeTotp={(text) => setTotpCode(text.replace(/\D/g, '').slice(0, 6))}
                onSubmit={() => void handleSubmitTotp()}
                onBack={handleBack}
              />
            )}
          </View>

          {Platform.OS !== 'web' && deviceCertificatesSupported() && (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/enroll')}
              style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: SPACING.md }}
            >
              <Scan size={16} color={colors.foregroundSubtle} />
              <Text style={{ color: colors.foregroundSubtle, fontSize: 14 }}>{t('v2.device.scanEnrollment')}</Text>
            </Pressable>
          )}

          {onCancel !== undefined && (
            <Pressable accessibilityRole="button" onPress={onCancel} style={{ alignItems: 'center' }}>
              <Text style={{ color: colors.foregroundSubtle, fontSize: 14 }}>{t('v2.connect.cancel')}</Text>
            </Pressable>
          )}

          {otherSessions.length > 0 && (
            <SavedServersList colors={colors} servers={otherSessions} onPick={handlePickSaved} />
          )}
        </View>
      </KeyboardAwareScrollView>
    </View>
  )
}

function SavedServersList({
  colors,
  servers,
  onPick,
}: {
  colors: ColorTokens
  servers: readonly SavedServer[]
  onPick: (server: SavedServer) => void
}) {
  const { t } = useTranslation()
  return (
    <View style={{ gap: SPACING.md }}>
      <Text style={fieldLabelStyle(colors)}>{t('v2.servers.savedTitle')}</Text>
      {servers.map((saved) => (
        <Pressable
          key={saved.id}
          accessibilityRole="button"
          onPress={() => onPick(saved)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SPACING.lg,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: RADIUS.md,
            paddingVertical: SPACING.lg,
            paddingHorizontal: SPACING.xl,
          }}
        >
          <ServerIcon size={18} color={colors.foregroundMuted} />
          <Text style={{ flex: 1, color: colors.foreground, fontSize: 15 }} numberOfLines={1}>
            {serverLabelOf(saved)}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

function ErrorAlert({ colors, message }: { colors: ColorTokens; message: string }) {
  return (
    <View
      style={{
        backgroundColor: colors.danger + '1a',
        borderColor: colors.danger + '40',
        borderWidth: 1,
        borderRadius: RADIUS.md,
        paddingVertical: SPACING.lg,
        paddingHorizontal: SPACING.xl,
      }}
    >
      <Text style={{ color: colors.danger, fontSize: 13 }}>{message}</Text>
    </View>
  )
}

function fieldLabelStyle(colors: ColorTokens) {
  return {
    color: colors.foregroundSubtle,
    fontSize: 12,
    fontWeight: '600' as const,
    marginBottom: SPACING.sm,
  }
}

function inputStyle(colors: ColorTokens) {
  return {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    color: colors.foreground,
    fontSize: 15,
  } as const
}

interface CredentialsFormProps {
  colors: ColorTokens
  serverUrl: string
  username: string
  password: string
  showPassword: boolean
  submitting: boolean
  canSubmit: boolean
  onChangeServerUrl: (text: string) => void
  onChangeUsername: (text: string) => void
  onChangePassword: (text: string) => void
  onToggleShowPassword: () => void
  onSubmit: () => void
  /** Extra ways in, under the "or" divider: this device's certificate and the hub's web methods. */
  methods: readonly LoginButton[]
}

/** One button under the "or" divider. */
interface LoginButton {
  readonly key: string
  readonly label: string
  readonly onPress: () => void
}

/**
 * The buttons beside the password form. The hub's own list decides: one button
 * per browser arm it offers (OIDC provider, passkey, …), each through its own
 * app flow; an unknown list (an older hub, offline) shows none and the password
 * form stays. A stored device certificate adds its own button, first.
 */
function loginButtons(input: {
  readonly views: readonly LoginMethodView[] | null
  readonly hasDeviceCert: boolean
  readonly native: boolean
  readonly signInWithDevice: string
  readonly onDevice: () => void
  readonly onHub: (arm: BrowserArm) => void
}): readonly LoginButton[] {
  const buttons: LoginButton[] = []
  if (input.hasDeviceCert) buttons.push({ key: 'device', label: input.signInWithDevice, onPress: input.onDevice })
  if (input.native) {
    const arms = input.views === null ? [] : primaryBrowserArms(input.views)
    for (const arm of arms) buttons.push({ key: arm.id, label: arm.label, onPress: () => input.onHub(arm) })
  }
  return buttons
}

function CredentialsForm({
  colors,
  serverUrl,
  username,
  password,
  showPassword,
  submitting,
  canSubmit,
  onChangeServerUrl,
  onChangeUsername,
  onChangePassword,
  onToggleShowPassword,
  onSubmit,
  methods,
}: CredentialsFormProps) {
  const { t } = useTranslation()
  const enter = useEnterProps(onSubmit)
  return (
    <>
      <View>
        <Text style={fieldLabelStyle(colors)}>{t('v2.login.serverUrl')}</Text>
        <TextInput
          {...enter('serverUrl')}
          value={serverUrl}
          onChangeText={onChangeServerUrl}
          placeholder="https://hub.local:4443"
          placeholderTextColor={colors.foregroundSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={inputStyle(colors)}
        />
      </View>

      <View>
        <Text style={fieldLabelStyle(colors)}>{t('v2.login.username')}</Text>
        <TextInput
          {...enter('username')}
          value={username}
          onChangeText={onChangeUsername}
          placeholder={t('v2.login.username')}
          placeholderTextColor={colors.foregroundSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          style={inputStyle(colors)}
        />
      </View>

      <View>
        <Text style={fieldLabelStyle(colors)}>{t('v2.login.password')}</Text>
        <View style={{ position: 'relative', justifyContent: 'center' }}>
          <TextInput
            {...enter('password')}
            value={password}
            onChangeText={onChangePassword}
            placeholder={t('v2.login.password')}
            placeholderTextColor={colors.foregroundSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!showPassword}
            style={{ ...inputStyle(colors), paddingRight: 48 }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showPassword ? t('v2.login.hidePassword') : t('v2.login.showPassword')}
            onPress={onToggleShowPassword}
            hitSlop={8}
            style={{ position: 'absolute', right: SPACING.xl }}
          >
            {showPassword ? (
              <EyeOff color={colors.foregroundSubtle} size={20} />
            ) : (
              <Eye color={colors.foregroundSubtle} size={20} />
            )}
          </Pressable>
        </View>
      </View>

      <PrimaryButton
        colors={colors}
        disabled={!canSubmit || submitting}
        submitting={submitting}
        label={t('v2.login.signIn')}
        loadingLabel={t('v2.login.signingIn')}
        onPress={onSubmit}
      />

      {methods.length > 0 && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.lg }}>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            <Text style={{ color: colors.foregroundSubtle, fontSize: 11, letterSpacing: 1 }}>
              {t('v2.login.or').toUpperCase()}
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          </View>
          {methods.map((method) => (
            <Pressable
              key={method.key}
              accessibilityRole="button"
              disabled={serverUrl.trim().length === 0 || submitting}
              onPress={method.onPress}
              style={{
                borderColor: colors.border,
                borderWidth: 1,
                opacity: serverUrl.trim().length === 0 || submitting ? 0.5 : 1,
                borderRadius: RADIUS.md,
                paddingVertical: SPACING.lg,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '600' }}>{method.label}</Text>
            </Pressable>
          ))}
        </>
      )}
    </>
  )
}

interface TotpFormProps {
  colors: ColorTokens
  username: string
  totpCode: string
  submitting: boolean
  onChangeTotp: (text: string) => void
  onSubmit: () => void
  onBack: () => void
}

function TotpForm({
  colors,
  username,
  totpCode,
  submitting,
  onChangeTotp,
  onSubmit,
  onBack,
}: TotpFormProps) {
  const { t } = useTranslation()
  const enter = useEnterProps(onSubmit)
  return (
    <>
      <View style={{ gap: SPACING.sm }}>
        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '600' }}>
          {t('v2.login.twoFactor')}
        </Text>
        <Text style={{ color: colors.foregroundSubtle, fontSize: 13 }}>
          {t('v2.login.totpHint')}
          <Text style={{ color: colors.foreground }}>{username}</Text>.
        </Text>
      </View>

      <View>
        <Text style={fieldLabelStyle(colors)}>{t('v2.login.verificationCode')}</Text>
        <TextInput
          {...enter('totp')}
          value={totpCode}
          onChangeText={onChangeTotp}
          placeholder="123456"
          placeholderTextColor={colors.foregroundSubtle}
          keyboardType="numeric"
          maxLength={6}
          textContentType="oneTimeCode"
          autoFocus
          style={{
            ...inputStyle(colors),
            textAlign: 'center',
            fontSize: 24,
            letterSpacing: 8,
          }}
        />
      </View>

      <PrimaryButton
        colors={colors}
        disabled={totpCode.length !== 6 || submitting}
        submitting={submitting}
        label={t('v2.login.verifyAndSignIn')}
        loadingLabel={t('v2.login.verifying')}
        onPress={onSubmit}
      />

      <Pressable accessibilityRole="button" onPress={onBack} style={{ alignItems: 'center' }}>
        <Text style={{ color: colors.foregroundSubtle, fontSize: 13 }}>{t('v2.login.back')}</Text>
      </Pressable>
    </>
  )
}

interface PrimaryButtonProps {
  colors: ColorTokens
  disabled: boolean
  submitting: boolean
  label: string
  loadingLabel: string
  onPress: () => void
}

function PrimaryButton({
  colors,
  disabled,
  submitting,
  label,
  loadingLabel,
  onPress,
}: PrimaryButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: colors.primary,
        opacity: disabled ? 0.5 : 1,
        borderRadius: RADIUS.md,
        paddingVertical: SPACING.lg,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
        gap: SPACING.md,
      }}
    >
      {submitting && <ActivityIndicator size="small" color={colors.primaryForeground} />}
      <Text style={{ color: colors.primaryForeground, fontSize: 16, fontWeight: '600' }}>
        {submitting ? loadingLabel : label}
      </Text>
    </Pressable>
  )
}
