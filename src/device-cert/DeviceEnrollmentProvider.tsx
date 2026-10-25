/**
 * "Keep this device signed in" (D855): the signed-in half of enrollment.
 *
 * The device never enrolls just because a session exists: a stolen or
 * long-refreshed session must not mint a permanent credential. So enrolling
 * asks for a STEP-UP first — the person signs in again right now (their
 * password, or any web method through the app login handoff in `step-up`
 * purpose), the hub answers a single-use proof, and only then does the device
 * generate its key and `auth.enrollSelf`.
 *
 * One provider for the authenticated app: the Settings row and the offer made
 * after a login both call {@link DeviceEnrollmentApi.startEnrollment}.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useServer } from '../app/ServerProvider.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import { useConfirm, useNotice } from '../components/ui/confirm.js'
import { SheetModal } from '../components/ui/SheetModal.js'
import { Field, PanelText } from '../screens/settings/sign-in/form-parts.js'
import { useTheme } from '../theme/theme-provider.js'
import { RADIUS, SPACING } from '../theme/tokens.js'
import { log } from '../lib/logger.js'
import { useDeviceNotice } from './device-notice-store.js'
import { settleSessionAfterDisconnect } from './after-disconnect.js'
import { disconnectThisDevice } from './device-session.js'
import { enrollSelf, proofFromHandoff, proofFromPassword } from './enrollment.js'
import {
  deviceCertificateUsableBy,
  fetchLoginMethods,
  primaryBrowserArms,
  type BrowserArm,
  type LoginMethodView,
} from './login-methods.js'
import { appFlowErrorKey } from './app-login-handoff.js'
import { runAppLoginHandoff } from './run-app-login-handoff.js'
import {
  createHandoffDeps,
  defaultDeviceName,
  deviceClientKind,
  devicePlatform,
} from './runtime.js'
import { SESSION_ENDED_REASON } from './device-wire.js'
import { deviceCertDeps, deviceCertificatesSupported } from './deps.js'
import { deviceTarget, isSecureHub } from './transport.js'
import type { DeviceCertRecord, DeviceTarget } from './types.js'
import { Button } from '../components/ui/Button.js'

export interface DeviceEnrollmentApi {
  /** `undefined` while it is being read; `null` = this device holds no certificate. */
  readonly record: DeviceCertRecord | null | undefined
  /** Can this hub + client enrol by certificate, and has it not refused self-enrollment? */
  readonly available: boolean
  readonly startEnrollment: () => Promise<void>
  readonly disconnect: () => Promise<void>
}

/** Outside the authenticated app (no provider): a device that holds nothing and can enrol nothing. */
const INERT: DeviceEnrollmentApi = {
  record: null,
  available: false,
  startEnrollment: async () => undefined,
  disconnect: async () => undefined,
}

export const EnrollmentContext = createContext<DeviceEnrollmentApi>(INERT)

export function useDeviceEnrollment(): DeviceEnrollmentApi {
  return useContext(EnrollmentContext)
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.length > 0 ? err.message : fallback
}

export function DeviceEnrollmentProvider({ children }: { readonly children: React.ReactNode }) {
  const { t } = useTranslation()
  const { server, token, endpoints, switchToCertificateSession, renewSession } = useServer()
  const { controller } = useConnection()
  const confirm = useConfirm()
  const notice = useNotice()
  // ONE credential per hub (the saved server); every operation dials the route
  // the app is connected through RIGHT NOW, and only over https.
  const hubKey = server?.id ?? null
  const liveUrl = controller.getSystem()?.serverUrl ?? server?.serverUrl ?? null
  const serverUrl = liveUrl !== null && isSecureHub(liveUrl) ? liveUrl : null
  const origin = hubKey
  const knownKey = endpoints.map((e) => e.baseUrl).join('|')
  const target = useMemo<DeviceTarget | null>(
    () =>
      hubKey === null || serverUrl === null
        ? null
        : deviceTarget({ hubKey, liveUrl: serverUrl, knownUrls: [server?.serverUrl ?? serverUrl, ...knownKey.split('|').filter(Boolean)] }),
    [hubKey, serverUrl, server?.serverUrl, knownKey],
  )

  // Answers are filed under the hub they were read for, so a switch starts unread.
  const [read, setRead] = useState<{ readonly origin: string | null; readonly value: DeviceCertRecord | null } | null>(null)
  const [asked, setAsked] = useState<{ readonly url: string; readonly views: readonly LoginMethodView[] | null } | null>(null)
  const record = read !== null && read.origin === origin ? read.value : undefined
  const views = asked !== null && asked.url === serverUrl ? asked.views : null
  const refusedOrigins = useDeviceNotice((s) => s.selfEnrollmentOff)
  const offerPending = useDeviceNotice((s) => s.enrollOfferPending)
  const onSessionEnded = useCallback((): void => {
    // The session under the sheet is dead: let the renewal path settle it (a
    // refused renewal signs out to the login screen) and say why.
    notice({ title: t('v2.device.sessionEndedTitle'), message: t('v2.device.sessionEnded') })
    void renewSession('unauthorized')
  }, [notice, renewSession, t])
  const stepUp = useStepUpSheet(views, onSessionEnded)
  const requestStepUp = stepUp.request

  const reload = useCallback(async (): Promise<void> => {
    const value = origin === null ? null : await deviceCertDeps.store.get(origin)
    setRead({ origin, value })
  }, [origin])

  useEffect(() => {
    let cancelled = false
    const stored = origin === null ? Promise.resolve(null) : deviceCertDeps.store.get(origin)
    void stored
      .catch(() => null)
      .then((value) => {
        if (!cancelled) setRead({ origin, value })
      })
    return () => {
      cancelled = true
    }
  }, [origin])

  useEffect(() => {
    if (serverUrl === null) return undefined
    let cancelled = false
    void fetchLoginMethods(serverUrl).then((found) => {
      if (!cancelled) setAsked({ url: serverUrl, views: found })
    })
    return () => {
      cancelled = true
    }
  }, [serverUrl])

  const available =
    deviceCertificatesSupported() &&
    target !== null &&
    views !== null &&
    deviceCertificateUsableBy(views, deviceClientKind()) &&
    !refusedOrigins.includes(hubKey ?? '')

  const startEnrollment = useCallback(async (): Promise<void> => {
    if (target === null || token === null || hubKey === null) return
    const proof = await requestStepUp({ serverUrl: target.serverUrl, bearer: token })
    if (proof === null) return
    const outcome = await enrollSelf(deviceCertDeps, {
      target,
      bearer: token,
      proof,
      deviceName: defaultDeviceName(),
      platform: devicePlatform(),
    })
    if (outcome.status === 'enrolled') {
      await reload()
      // Continue under the certificate at once; the password session ends only if that worked.
      const switched = await switchToCertificateSession()
      notice({
        title: t('v2.device.enrolledTitle'),
        message: switched === 'switched' ? t('v2.device.enrolledBody') : t('v2.device.switchRetryNotice'),
      })
      return
    }
    if (outcome.status === 'refused' && outcome.reason === 'self-enrollment-disabled') {
      useDeviceNotice.getState().markSelfEnrollmentOff(hubKey)
    }
    log.warn('device-cert', 'Self enrollment did not complete', {
      reason: outcome.status === 'refused' ? outcome.reason : outcome.message,
    })
    notice({
      title: t('v2.device.enrollFailedTitle'),
      message:
        outcome.status === 'refused'
          ? t(`v2.device.refusal.${refusalKey(outcome.reason)}`)
          : outcome.message,
    })
  }, [target, token, hubKey, requestStepUp, reload, switchToCertificateSession, notice, t])

  const disconnect = useCallback(async (): Promise<void> => {
    if (target === null) return
    const ok = await confirm({
      title: t('v2.device.disconnectTitle'),
      message: t('v2.device.disconnectBody'),
      confirmLabel: t('v2.device.disconnect'),
      destructive: true,
    })
    if (!ok) return
    const outcome = await disconnectThisDevice(deviceCertDeps, target)
    await reload()
    if (outcome.status === 'failed') {
      notice({ title: t('v2.device.disconnectFailedTitle'), message: t('v2.device.disconnectFailedBody') })
      return
    }
    // The hub ended every session this credential minted. When the active one
    // was such a session it is dead now: renewing it finds out (a refusal
    // signs out to the login screen); a session opened by password survives.
    await settleSessionAfterDisconnect({
      renewSession,
      markDisconnected: () => useDeviceNotice.getState().setDisconnected(true),
    })
  }, [target, confirm, notice, reload, renewSession, t])

  // The offer after a successful login: once, only where it can work.
  const offering = useRef(false)
  useEffect(() => {
    if (!offerPending || record === undefined || views === null || offering.current) return
    useDeviceNotice.getState().setEnrollOfferPending(false)
    if (record !== null || !available) return
    offering.current = true
    void confirm({
      title: t('v2.device.offerTitle'),
      message: t('v2.device.offerBody'),
      confirmLabel: t('v2.device.offerConfirm'),
      cancelLabel: t('v2.device.offerLater'),
    })
      .then((ok) => (ok ? startEnrollment() : undefined))
      .finally(() => {
        offering.current = false
      })
  }, [offerPending, record, views, available, confirm, startEnrollment, t])

  const api = useMemo<DeviceEnrollmentApi>(
    // Over plain http (or with no key module) the whole feature is hidden, a held certificate included.
    () => ({ record: target === null || !deviceCertificatesSupported() ? null : record, available, startEnrollment, disconnect }),
    [record, target, available, startEnrollment, disconnect],
  )

  return (
    <EnrollmentContext.Provider value={api}>
      {children}
      {stepUp.sheet}
    </EnrollmentContext.Provider>
  )
}

/** A refusal reason as a locale key; unknown ones read as a generic failure. */
function refusalKey(reason: string): string {
  return ['self-enrollment-disabled', 'step-up-required', 'session-ended', 'rate-limited', 'unavailable', 'bad-public-key'].includes(reason)
    ? reason
    : 'other'
}

interface StepUpRequest {
  readonly serverUrl: string
  readonly bearer: string
}

interface StepUpSheet {
  readonly request: (input: StepUpRequest) => Promise<string | null>
  readonly sheet: React.ReactNode
}

/** "Confirm it's you": password, or any web method through the handoff. Resolves a proof, or null. */
function useStepUpSheet(views: readonly LoginMethodView[] | null, onSessionEnded: () => void): StepUpSheet {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [active, setActive] = useState<StepUpRequest | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'password' | string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<((proof: string | null) => void) | null>(null)
  const arms = Platform.OS === 'web' || views === null ? [] : primaryBrowserArms(views)

  const settle = useCallback((proof: string | null) => {
    pending.current?.(proof)
    pending.current = null
    setActive(null)
    setPassword('')
    setBusy(null)
    setError(null)
  }, [])

  const request = useCallback(
    (input: StepUpRequest) =>
      new Promise<string | null>((resolve) => {
        pending.current?.(null)
        pending.current = resolve
        setError(null)
        setActive(input)
      }),
    [],
  )

  const withPassword = (): void => {
    if (active === null || password.length === 0 || busy !== null) return
    setBusy('password')
    setError(null)
    void proofFromPassword(deviceCertDeps, { serverUrl: active.serverUrl, bearer: active.bearer, password }).then((result) => {
      if (result.kind === 'ok') return settle(result.value)
      if (result.kind === 'refused' && result.reason === SESSION_ENDED_REASON) {
        settle(null)
        return onSessionEnded()
      }
      setError(result.kind === 'transient' ? result.message : t('v2.device.stepUp.failed'))
      setBusy(null)
    })
  }

  const withHandoff = (arm: BrowserArm): void => {
    if (active === null || busy !== null) return
    setBusy(arm.id)
    setError(null)
    void (async () => {
      try {
        const leg = await runAppLoginHandoff(createHandoffDeps(), {
          serverUrl: active.serverUrl,
          startPath: arm.startPath,
          purpose: 'step-up',
        })
        if (leg.status === 'cancelled') return setBusy(null)
        if (leg.status === 'error') {
          log.warn('device-cert', 'Step-up refused by the hub', { code: leg.code })
          setError(t(appFlowErrorKey(leg.code)))
          return setBusy(null)
        }
        if (leg.status === 'refused') {
          log.warn('device-cert', 'Step-up callback refused', { reason: leg.reason })
          setError(t('v2.device.stepUp.failed'))
          return setBusy(null)
        }
        const proof = await proofFromHandoff(deviceCertDeps, { ...leg, serverUrl: active.serverUrl, bearer: active.bearer })
        if (proof.kind === 'ok') return settle(proof.value)
        if (proof.kind === 'refused' && proof.reason === SESSION_ENDED_REASON) {
          settle(null)
          return onSessionEnded()
        }
        setError(t('v2.device.stepUp.failed'))
        setBusy(null)
      } catch (err) {
        setError(messageOf(err, t('v2.device.stepUp.failed')))
        setBusy(null)
      }
    })()
  }

  const sheet = (
    <SheetModal
      visible={active !== null}
      onClose={() => settle(null)}
      testID="device-step-up-sheet"
      sheetStyle={{
        backgroundColor: colors.background,
        borderTopLeftRadius: RADIUS.xl,
        borderTopRightRadius: RADIUS.xl,
        padding: SPACING.xl,
        paddingBottom: SPACING['3xl'],
        gap: SPACING.md,
      }}
    >
      <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: '600' }}>{t('v2.device.stepUp.title')}</Text>
      <PanelText>{t('v2.device.stepUp.body')}</PanelText>
      <Field
        label={t('v2.signIn.reauth.password')}
        value={password}
        onChangeText={setPassword}
        secure
        autoComplete="current-password"
        testID="device-step-up-password"
      />
      {error !== null ? <PanelText tone="danger">{error}</PanelText> : null}
      <View style={{ gap: SPACING.sm }}>
        <Button
          label={busy === 'password' ? t('v2.signIn.working') : t('v2.signIn.reauth.confirm')}
          onPress={withPassword}
          disabled={password.length === 0 || busy !== null}
          testID="device-step-up-confirm"
        />
        {arms.map((arm) => (
          <Button
            key={arm.id}
            label={busy === arm.id ? t('v2.signIn.working') : t('v2.device.stepUp.continueWith', { method: arm.label })}
            kind="secondary"
            onPress={() => withHandoff(arm)}
            disabled={busy !== null}
            testID={`device-step-up-${arm.id}`}
          />
        ))}
        <Button label={t('v2.settings.cancel')} kind="secondary" onPress={() => settle(null)} testID="device-step-up-cancel" />
      </View>
    </SheetModal>
  )

  return { request, sheet }
}
