/**
 * Settings → Account → This device: whether this phone stays signed in with a
 * device certificate (D855) — when it expires, when it was last renewed — and
 * the two actions: keep this device signed in, or disconnect it.
 *
 * "Disconnect this device" revokes the certificate on the hub (signed by the
 * device itself) and deletes the key here; the next launch asks for a login.
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Smartphone, ShieldCheck, ShieldOff, FileText } from '../../lib/icons.js'
import { Section } from '../../components/ui/Section.js'
import { Row } from '../../components/ui/Row.js'
import { useDateLocale } from '../../lib/date-locale.js'
import { useServer } from '../../app/ServerProvider.js'
import { CertificateDetailsSheet } from './CertificateDetailsSheet.js'
import { useDeviceEnrollment } from '../../device-cert/DeviceEnrollmentProvider.js'

export function ThisDeviceSection() {
  const { t } = useTranslation()
  const locale = useDateLocale()
  const { server } = useServer()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const { record, available, startEnrollment, disconnect } = useDeviceEnrollment()
  const day = (ms: number): string =>
    new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })

  // Nothing to say about a hub that cannot do it, on a device that holds nothing.
  if (record === undefined || (record === null && !available)) return null

  return (
    <Section title={t('v2.device.title')}>
      {record === null ? (
        <Row
          icon={Smartphone}
          label={t('v2.device.keepSignedIn')}
          value={t('v2.device.notSignedInForever')}
          onPress={() => void startEnrollment()}
          last
        />
      ) : (
        <>
          <Row icon={ShieldCheck} label={t('v2.device.status')} value={t('v2.device.statusActive')} />
          <Row label={t('v2.device.expires')} value={day(record.notAfter)} />
          <Row label={t('v2.device.lastRenewed')} value={day(record.issuedAt)} />
          <Row
            icon={FileText}
            label={t('v2.device.certificateDetails')}
            onPress={() => setDetailsOpen(true)}
          />
          <Row
            icon={ShieldOff}
            label={t('v2.device.disconnect')}
            danger
            onPress={() => void disconnect()}
            last
          />
        </>
      )}
      {record !== null ? (
        <CertificateDetailsSheet
          visible={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          record={record}
          hubName={server?.label ?? null}
        />
      ) : null}
    </Section>
  )
}
