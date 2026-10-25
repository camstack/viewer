/**
 * `/enroll` — link this device to a hub with an admin's one-shot code (D855).
 *
 * The code arrives as a deep link (`camstack://enroll?hub=…&code=…`, scanned
 * with the system camera) or by scanning the QR here. Either way the device
 * generates its own key, the hub signs the public half, and the certificate
 * opens the first session — no password typed on a phone nobody can log in on.
 *
 * A link or a QR is whatever someone put in front of the phone, so NOTHING
 * starts by itself: the screen names the target hub, warns when it is one this
 * device does not know, and waits for an explicit tap — signed in or not.
 */
import React, { useRef, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { parseDeviceEnrollmentLink } from '@camstack/types/client'
import { useServer } from '../app/ServerProvider.js'
import { log } from '../lib/logger.js'
import { useTheme } from '../theme/theme-provider.js'
import { RADIUS, SPACING } from '../theme/tokens.js'
import { BrandLogo } from '../theme/brand-logo.js'
import { resolveEnrollTarget } from '../device-cert/enroll-target.js'
import { ConfirmTarget } from './EnrollConfirm.js'
import { useQrScanner } from './use-qr-scanner.js'
import { useNotice } from '../components/ui/confirm.js'
import { enrollByCodeAndSignIn, enrollWithCode } from '../device-cert/enrollment.js'
import { deviceTarget } from '../device-cert/transport.js'
import { renewInBackground } from '../device-cert/device-sign-in.js'
import { deviceCertDeps } from '../device-cert/deps.js'
import { defaultDeviceName, devicePlatform } from '../device-cert/runtime.js'

type Phase = 'scan' | 'confirm' | 'working' | 'error'

interface EnrollLink {
  readonly hub: string | null
  readonly code: string
}

function firstParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value
  return first !== undefined && first.length > 0 ? first : null
}

export function EnrollScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const params = useLocalSearchParams<Record<string, string | string[]>>()
  const { loading, server, token, servers, lastServerUrl, save, switchToCertificateSession } = useServer()
  const notice = useNotice()
  const scanner = useQrScanner()
  const [phase, setPhase] = useState<Phase>('scan')
  const [errorText, setErrorText] = useState('')
  const [pending, setPending] = useState<EnrollLink | null>(null)
  const busy = useRef(false)

  const linkCode = firstParam(params.code)
  const linkHub = firstParam(params.hub)
  // A deep link only PROPOSES: it fills the confirmation, it never starts.
  const proposal: EnrollLink | null = pending ?? (linkCode !== null ? { hub: linkHub, code: linkCode } : null)
  const target = proposal === null ? null : resolveEnrollTarget({
    linkHub: proposal.hub,
    servers,
    signedInServerUrl: server !== null && token !== null ? server.serverUrl : null,
    lastServerUrl,
  })
  const showConfirm = proposal !== null && (phase === 'scan' || phase === 'confirm')

  const run = async (): Promise<void> => {
    if (busy.current || proposal === null || target === null || target.status !== 'ready') return
    busy.current = true
    try {
      setPhase('working')
      const hubKey = target.knownServerId ?? target.origin
      const enrollTarget = deviceTarget({
        hubKey,
        liveUrl: target.origin,
        knownUrls: target.knownServerUrl === null ? [] : [target.knownServerUrl],
      })
      if (server !== null && token !== null && server.id === hubKey) {
        // Paired from a signed-in session on this hub: switch to the certificate, old session ends last.
        const enrolled = await enrollWithCode(deviceCertDeps, {
          target: enrollTarget,
          code: proposal.code,
          deviceName: defaultDeviceName(),
          platform: devicePlatform(),
        })
        if (enrolled.status !== 'enrolled') {
          log.warn('device-cert', 'QR enrollment did not complete', { status: enrolled.status })
          setErrorText(
            enrolled.status === 'refused'
              ? t(`v2.device.refusal.${enrolled.reason === 'code-invalid' ? 'code-invalid' : 'other'}`)
              : t('v2.device.enroll.failed'),
          )
          setPhase('error')
          return
        }
        if ((await switchToCertificateSession()) === 'kept') {
          notice({ title: t('v2.device.enrolledTitle'), message: t('v2.device.switchRetryNotice') })
        }
        router.replace('/cameras')
        return
      }
      const result = await enrollByCodeAndSignIn(deviceCertDeps, {
        target: enrollTarget,
        code: proposal.code,
        deviceName: defaultDeviceName(),
        platform: devicePlatform(),
      })
      if (result.status !== 'signed-in') {
        log.warn('device-cert', 'QR enrollment did not complete', { status: result.status })
        setErrorText(
          result.status === 'enrolment-failed' && result.outcome.status === 'refused'
            ? t(`v2.device.refusal.${result.outcome.reason === 'code-invalid' ? 'code-invalid' : 'other'}`)
            : t('v2.device.enroll.failed'),
        )
        setPhase('error')
        return
      }
      await save(
        {
          id: hubKey,
          label: target.knownLabel ?? target.origin,
          serverUrl: target.knownServerUrl ?? target.origin,
        },
        { token: result.login.session.token, refreshToken: result.login.session.refreshToken },
      )
      renewInBackground(enrollTarget)
      router.replace('/cameras')
    } catch (err) {
      log.warn('device-cert', 'QR enrollment threw', { message: err instanceof Error ? err.message : String(err) })
      setErrorText(t('v2.device.enroll.failed'))
      setPhase('error')
    } finally {
      busy.current = false
    }
  }

  const onScanned = (data: string): void => {
    const link = parseDeviceEnrollmentLink(data)
    if (link === null) {
      setErrorText(t('v2.device.enroll.notAnEnrollmentCode'))
      return
    }
    setErrorText('')
    setPending(link)
    setPhase('confirm')
  }

  const cancel = (): void => {
    if (pending !== null || linkCode !== null) {
      // Back to scanning (or out, when a link opened this screen).
      setPending(null)
      setPhase('scan')
      if (linkCode !== null) router.replace('/')
      return
    }
    router.replace('/')
  }

  const scanning = phase === 'scan' && proposal === null && Platform.OS !== 'web' && scanner.available

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING['2xl'] }}
    >
      <View style={{ width: '100%', maxWidth: 420, gap: SPACING['2xl'] }}>
        <View style={{ alignItems: 'center' }}>
          <BrandLogo width={220} />
        </View>
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
          <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: '700' }}>{t('v2.device.enroll.title')}</Text>
          {phase === 'working' && (
            <View style={{ alignItems: 'center', gap: SPACING.lg }}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ color: colors.foregroundSubtle, fontSize: 14 }}>{t('v2.device.enroll.working')}</Text>
            </View>
          )}
          {scanning && (
            <>
              <Text style={{ color: colors.foregroundSubtle, fontSize: 14 }}>{t('v2.device.enroll.scanBody')}</Text>
              {scanner.granted ? (
                <View style={{ aspectRatio: 1, borderRadius: RADIUS.md, overflow: 'hidden' }}>{scanner.render(onScanned)}</View>
              ) : (
                <ActionButton colors={colors} label={t('v2.device.enroll.allowCamera')} onPress={scanner.request} />
              )}
            </>
          )}
          {showConfirm && target !== null && (
            <ConfirmTarget colors={colors} target={target} loading={loading} onConfirm={() => void run()} />
          )}
          {errorText.length > 0 && <Text style={{ color: colors.danger, fontSize: 13 }}>{errorText}</Text>}
          {phase === 'error' && (
            <ActionButton
              colors={colors}
              label={t('v2.device.enroll.tryAgain')}
              onPress={() => {
                setErrorText('')
                setPhase('scan')
                setPending(null)
                if (linkCode !== null) router.replace('/enroll')
              }}
            />
          )}
          <Pressable accessibilityRole="button" onPress={cancel} style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.foregroundSubtle, fontSize: 14 }}>{t('v2.connect.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  )
}

function ActionButton({
  colors,
  label,
  onPress,
}: {
  colors: { primary: string; primaryForeground: string }
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ backgroundColor: colors.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.lg, alignItems: 'center' }}
    >
      <Text style={{ color: colors.primaryForeground, fontSize: 16, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  )
}
