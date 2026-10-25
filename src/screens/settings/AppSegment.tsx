/**
 * Settings → App: what is set once at install and rarely again.
 *
 *   • General          — theme, language, press feedback.
 *   • This device / Account on «hub» — the two levels every setting lives at,
 *                        the account sync status, and a copy from another hub.
 *   • About & updates  — version facts, what's new, the OTA check and the
 *                        native build behind it.
 *
 * The four EVENT-haptic rows were deleted on 2026-09-13; the mechanism is
 * still wired and forced off in `HAPTICS_DEFAULTS` — off, not deleted.
 */
import React, { useState } from 'react'
import { Linking, Platform, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import { Info, RefreshCcw, Vibrate } from '../../lib/icons.js'
import { nativeReleaseState, storeUrlFor } from '../../app/native-release.js'
import { runningBuildNumber } from '../../app/running-bundle.js'
import { whatsNewHistory, type WhatsNewHistory } from '../../app/whats-new.js'
import { WhatsNewModal } from '../../app/WhatsNewModal.js'
import { useNativeRelease } from '../../data/use-native-release.js'
import { reloadRuntimeForUpdate } from '../../lib/reload-runtime.js'
import { useTheme } from '../../theme/theme-provider.js'
import type { ThemePreference } from '../../theme/resolve-theme.js'
import { Section } from '../../components/ui/Section.js'
import { Row } from '../../components/ui/Row.js'
import { ToggleRow } from '../../components/ui/ToggleRow.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { useConfirm, useNotice } from '../../components/ui/confirm.js'
import { useLanguage, type LanguagePreference } from '../../data/use-language.js'
import { useSettings } from '../../data/use-settings.js'
import { SPACING } from '../../theme/tokens.js'
import { SettingsGrid } from './SettingsGrid.js'
import { SettingsLevelsSection } from './SettingsLevelsSection.js'
import { NATIVE_BINARY, runningVersionRows, versionValue } from './running-version.js'

export function AppSegment() {
  const { t } = useTranslation()
  const { colors, preference, setPreference } = useTheme()
  const { preference: langPreference, setPreference: setLangPreference } = useLanguage()
  const { settings, setHaptics } = useSettings()

  const themeOptions: readonly { value: ThemePreference; label: string }[] = [
    { value: 'system', label: t('v2.settings.themeSystem') },
    { value: 'dark', label: t('v2.settings.themeDark') },
    { value: 'light', label: t('v2.settings.themeLight') },
  ]
  const languageOptions: readonly { value: LanguagePreference; label: string }[] = [
    { value: 'system', label: t('v2.settings.langSystem') },
    { value: 'it', label: 'Italiano' },
    { value: 'en', label: 'English' },
  ]

  return (
    <>
      <SettingsGrid>
        <Section title={t('v2.settings.general')}>
          <View style={{ padding: SPACING.xl, gap: SPACING.md }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{t('v2.settings.theme')}</Text>
            <SegmentedControl options={themeOptions} value={preference} onChange={setPreference} />
            <Text style={{ color: colors.foregroundMuted, fontSize: 13, marginTop: SPACING.md }}>
              {t('v2.settings.language')}
            </Text>
            <SegmentedControl options={languageOptions} value={langPreference} onChange={setLangPreference} />
          </View>
          <ToggleRow
            icon={Vibrate}
            label={t('v2.settings.hapticsUiFeedback')}
            description={t('v2.settings.hapticsUiFeedbackHint')}
            value={settings.haptics.uiFeedback}
            // ToggleRow fires the confirming haptic itself, AFTER the change —
            // so this row demonstrates exactly what it controls.
            onValueChange={(v) => setHaptics('uiFeedback', v)}
            last
          />
        </Section>

        <SettingsLevelsSection />

        <AboutSection />
      </SettingsGrid>
      <Text
        style={{
          color: colors.foregroundSubtle,
          fontSize: 12,
          textAlign: 'center',
          lineHeight: 17,
          paddingHorizontal: SPACING.lg,
        }}
      >
        {t('v2.settings.footerNote')}
      </Text>
    </>
  )
}

function AboutSection() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const notice = useNotice()
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [whatsNew, setWhatsNew] = useState<WhatsNewHistory | null>(null)
  const versionRows = runningVersionRows()

  // The newest native build the hub publishes, against the one we run in.
  const { data: latestNative = null } = useNativeRelease()
  const nativeState = nativeReleaseState(
    { version: Constants.expoConfig?.version, buildNumber: runningBuildNumber() },
    latestNative,
  )
  const nativeRowValue =
    nativeState === 'newer-available' && latestNative
      ? t('v2.updates.nativeNewer', { version: latestNative.version, build: latestNative.buildNumber })
      : nativeState === 'up-to-date'
        ? t('v2.updates.nativeUpToDate')
        : t('v2.updates.nativeUnknown')
  const handleOpenNativeRelease = (): void => {
    if (!latestNative || nativeState !== 'newer-available') return
    const url = storeUrlFor(
      latestNative,
      Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
      Constants.expoConfig?.ios?.bundleIdentifier ?? '',
    )
    if (url !== null) void Linking.openURL(url)
  }

  /**
   * Ask the update server RIGHT NOW instead of waiting for the launch check.
   * The reload is offered rather than performed: unlike `OtaUpdateGate` — which
   * may reload only within seconds of mount — this can fire at any point in a
   * session, so discarding the user's place has to be their choice.
   */
  const handleCheckForUpdates = (): void => {
    if (!Updates.isEnabled) {
      notice({ title: t('v2.settings.updatesDisabled') })
      return
    }
    setCheckingUpdate(true)
    void (async () => {
      try {
        const check = await Updates.checkForUpdateAsync()
        if (!check.isAvailable) {
          notice({ title: t('v2.settings.updateUpToDate') })
          return
        }
        await Updates.fetchUpdateAsync()
        const ok = await confirm({
          title: t('v2.settings.updateReadyTitle'),
          message: t('v2.settings.updateReadyBody'),
          confirmLabel: t('v2.settings.confirm'),
          cancelLabel: t('v2.settings.cancel'),
        })
        if (ok) await reloadRuntimeForUpdate('settings')
      } catch (e: unknown) {
        // Offline, or the update server is unreachable — say so, rather than
        // leaving the operator with a button that appears to do nothing.
        notice({
          title: t('v2.settings.updateCheckFailed'),
          message: e instanceof Error ? e.message : String(e),
        })
      } finally {
        setCheckingUpdate(false)
      }
    })()
  }

  return (
    <>
      <Section title={t('v2.settings.aboutUpdates')}>
        <Row icon={Info} label={t('v2.settings.app')} value="CamStack Viewer" />
        <Row label={t('v2.settings.version')} value={versionValue(versionRows, 'app')} />
        {NATIVE_BINARY ? (
          <>
            <Row label={t('v2.settings.buildNumber')} value={versionValue(versionRows, 'build')} />
            <Row label={t('v2.settings.runtimeVersion')} value={versionValue(versionRows, 'runtime')} />
            <Row label={t('v2.settings.runningBundle')} value={versionValue(versionRows, 'update')} />
          </>
        ) : null}
        {/* The SAME panel the launch announcement opens: the running build
            highlighted, every earlier one listed under it. */}
        <Row
          label={t('v2.updates.whatsNewRow')}
          onPress={() => setWhatsNew(whatsNewHistory(Constants.expoConfig?.version ?? null))}
        />
        <Row
          icon={RefreshCcw}
          label={checkingUpdate ? t('v2.settings.checkingUpdates') : t('v2.settings.checkUpdates')}
          onPress={handleCheckForUpdates}
          last={!NATIVE_BINARY}
        />
        {/* The native build is the one thing an OTA cannot deliver. Meaningless
            off a native binary: there is no binary to be behind, and no store. */}
        {NATIVE_BINARY ? (
          <Row
            label={t('v2.updates.nativeRow')}
            value={nativeRowValue}
            {...(nativeState === 'newer-available' ? { onPress: handleOpenNativeRelease } : {})}
            last
          />
        ) : null}
      </Section>
      <WhatsNewModal
        visible={whatsNew !== null}
        latest={whatsNew?.latest ?? null}
        past={whatsNew?.past ?? []}
        onClose={() => {
          setWhatsNew(null)
        }}
      />
    </>
  )
}
