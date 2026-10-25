/**
 * Settings → Account → This device → Certificate details: everything the
 * phone can read from its own certificate, parsed locally from the PEM in the
 * secure store (no request to the hub), plus what the app knows about this
 * device's enrollment. A certificate is public; the private key is not here
 * and cannot be read at all.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SheetModal } from '../../components/ui/SheetModal.js'
import { Copy } from '../../lib/icons.js'
import { copyText } from '../../lib/copy-text.js'
import { useDateLocale } from '../../lib/date-locale.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../theme/tokens.js'
import { daysUntil, parseCertificate } from '../../device-cert/cert-details.js'
import type { DeviceCertRecord } from '../../device-cert/types.js'

type KeyStorageKey = 'secureEnclave' | 'hardware' | 'software' | 'unknown'

/** Where the private key lives, from what enrollment recorded and the platform. */
export function keyStorageOf(os: string, hardwareBacked: boolean | undefined): KeyStorageKey {
  if (hardwareBacked === undefined) return 'unknown'
  if (!hardwareBacked) return 'software'
  return os === 'ios' ? 'secureEnclave' : 'hardware'
}

interface DetailLineProps {
  readonly label: string
  readonly value: string
  readonly copyLabel?: string
}

function DetailLine({ label, value, copyLabel }: DetailLineProps) {
  const { colors } = useTheme()
  return (
    <View style={{ gap: 2, paddingVertical: SPACING.sm }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: TYPOGRAPHY.size.sm }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
        <Text selectable style={{ color: colors.foreground, fontSize: TYPOGRAPHY.size.md, flexShrink: 1 }}>
          {value}
        </Text>
        {copyLabel !== undefined ? (
          <Pressable accessibilityRole="button" accessibilityLabel={copyLabel} hitSlop={8} onPress={() => void copyText(value)}>
            <Copy size={16} color={colors.foregroundMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

interface CertificateDetailsSheetProps {
  readonly visible: boolean
  readonly onClose: () => void
  readonly record: DeviceCertRecord
  /** The saved hub's name, when known. */
  readonly hubName: string | null
}

export function CertificateDetailsSheet({ visible, onClose, record, hubName }: CertificateDetailsSheetProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const locale = useDateLocale()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (visible) setNow(Date.now())
  }, [visible])
  const parsed = useMemo(() => parseCertificate(record.certPem), [record.certPem])
  const stamp = (ms: number): string =>
    new Date(ms).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const remaining = (notAfter: number): string => {
    const days = daysUntil(notAfter, now)
    return days < 0 ? t('v2.device.details.expired') : t('v2.device.details.inDays', { count: days })
  }
  const heading = (text: string) => (
    <Text style={{ color: colors.foreground, fontSize: TYPOGRAPHY.size.lg, fontWeight: TYPOGRAPHY.weight.medium, marginTop: SPACING.md }}>
      {text}
    </Text>
  )

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      testID="cert-details-sheet"
      backdropLabel={t('v2.device.details.close')}
      sheetStyle={{
        backgroundColor: colors.background,
        borderTopLeftRadius: RADIUS.xl,
        borderTopRightRadius: RADIUS.xl,
        padding: SPACING.xl,
        paddingBottom: SPACING['3xl'],
        maxHeight: '90%',
      }}
    >
      <ScrollView>
        <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: TYPOGRAPHY.weight.medium }}>
          {t('v2.device.details.title')}
        </Text>
        {parsed.kind === 'unreadable' ? (
          <>
            <Text testID="cert-unreadable" style={{ color: colors.danger, marginTop: SPACING.md }}>
              {t('v2.device.details.unreadable')}
            </Text>
            <Text testID="cert-unreadable-step" style={{ color: colors.foregroundMuted, fontSize: 12, marginTop: SPACING.xs }}>
              {`unreadable: ${parsed.step}`}
            </Text>
          </>
        ) : (
          <>
            {heading(t('v2.device.details.certificate'))}
            <DetailLine label={t('v2.device.details.serial')} value={parsed.details.serialNumber} />
            <DetailLine
              label={t('v2.device.details.fingerprint')}
              value={parsed.details.fingerprintSha256}
              copyLabel={t('v2.device.details.copyFingerprint')}
            />
            <DetailLine label={t('v2.device.details.subject')} value={parsed.details.subject} />
            <DetailLine label={t('v2.device.details.issuer')} value={parsed.details.issuer} />
            <DetailLine label={t('v2.device.details.validFrom')} value={stamp(parsed.details.notBefore)} />
            <DetailLine
              label={t('v2.device.details.validUntil')}
              value={`${stamp(parsed.details.notAfter)} (${remaining(parsed.details.notAfter)})`}
            />
            <DetailLine
              label={t('v2.device.details.altNames')}
              value={parsed.details.subjectAltNames.join('\n') || t('v2.device.details.none')}
            />
            <DetailLine
              label={t('v2.device.details.keyUsage')}
              value={parsed.details.extendedKeyUsage.join(', ') || t('v2.device.details.none')}
            />
            <DetailLine
              label={t('v2.device.details.publicKey')}
              value={[parsed.details.publicKeyAlgorithm, parsed.details.curve].filter(Boolean).join(' ')}
            />
            <DetailLine label={t('v2.device.details.signature')} value={parsed.details.signatureAlgorithm} />
          </>
        )}
        {heading(t('v2.device.details.thisDevice'))}
        <DetailLine
          label={t('v2.device.details.hub')}
          value={[hubName, record.hubOrigin].filter(Boolean).join(' · ') || t('v2.device.details.unknown')}
        />
        <DetailLine
          label={t('v2.device.details.keyStorage')}
          value={t(`v2.device.details.storage.${keyStorageOf(Platform.OS, record.keyHardwareBacked)}`)}
        />
        <DetailLine
          label={t('v2.device.details.enrolledAt')}
          value={record.enrolledAt === undefined ? t('v2.device.details.unknown') : stamp(record.enrolledAt)}
        />
        <DetailLine label={t('v2.device.lastRenewed')} value={stamp(record.issuedAt)} />
      </ScrollView>
    </SheetModal>
  )
}
