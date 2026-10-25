/**
 * Settings → Advanced: the diagnostic and destructive end of the page.
 *
 *   • Network     — routes, pin, re-probe, diagnosis (`NetworkSection`).
 *   • Diagnostics — debug mode (device-local) and the in-app log viewer.
 *   • Data        — export the settings, clear the cache, reset.
 */
import React, { useState } from 'react'
import { Share } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Bug, Download, RotateCcw, ScrollText, Trash2 } from '../../lib/icons.js'
import { Section } from '../../components/ui/Section.js'
import { Row } from '../../components/ui/Row.js'
import { ToggleRow } from '../../components/ui/ToggleRow.js'
import { useConfirm, useNotice } from '../../components/ui/confirm.js'
import { useSettings } from '../../data/use-settings.js'
import { clearAppCache } from '../../data/clear-cache.js'
import { useDeviceSettingsStore } from '../../store/device-settings-store.js'
import { SettingsGrid } from './SettingsGrid.js'
import { NetworkSection } from './NetworkSection.js'
import { LogsModal } from './LogsModal.js'

export interface AdvancedSegmentProps {
  /** The segment is on screen (tab focused, app foreground, segment shown). */
  readonly active: boolean
}

export function AdvancedSegment({ active }: AdvancedSegmentProps) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const notice = useNotice()
  const queryClient = useQueryClient()
  const { settings, resetSettings } = useSettings()
  // A DEVICE setting — never part of the account settings.
  const debugMode = useDeviceSettingsStore((s) => s.settings.debugMode)
  const setDebugMode = useDeviceSettingsStore((s) => s.setDebugMode)
  const [logsOpen, setLogsOpen] = useState(false)

  const handleClearCache = (): void => {
    void (async (): Promise<void> => {
      const ok = await confirm({
        title: t('v2.settings.clearCacheConfirmTitle'),
        message: t('v2.settings.clearCacheConfirmBody'),
        confirmLabel: t('v2.settings.confirm'),
        cancelLabel: t('v2.settings.cancel'),
        destructive: true,
      })
      if (!ok) return
      await clearAppCache(queryClient)
      notice({ title: t('v2.settings.clearCacheDone') })
    })()
  }

  const handleExportSettings = (): void => {
    const json = JSON.stringify(settings, null, 2)
    void Share.share({ message: json }).catch((e: unknown) => {
      console.error('[settings] export share failed', e)
    })
  }

  const handleResetSettings = (): void => {
    void (async (): Promise<void> => {
      const ok = await confirm({
        title: t('v2.settings.resetConfirmTitle'),
        message: t('v2.settings.resetConfirmBody'),
        confirmLabel: t('v2.settings.confirm'),
        cancelLabel: t('v2.settings.cancel'),
        destructive: true,
      })
      if (!ok) return
      resetSettings()
    })()
  }

  return (
    <>
      <SettingsGrid>
        <NetworkSection active={active} />

        <Section title={t('v2.settings.diagnostics')}>
          <ToggleRow
            icon={Bug}
            label={t('v2.settings.debugMode')}
            description={t('v2.settings.debugModeHint')}
            value={debugMode}
            onValueChange={setDebugMode}
          />
          <Row icon={ScrollText} label={t('v2.settings.viewLogs')} onPress={() => setLogsOpen(true)} last />
        </Section>

        <Section title={t('v2.settings.data')}>
          <Row icon={Download} label={t('v2.settings.exportSettings')} onPress={handleExportSettings} />
          <Row icon={Trash2} label={t('v2.settings.clearCache')} onPress={handleClearCache} />
          <Row
            icon={RotateCcw}
            label={t('v2.settings.resetSettings')}
            danger
            onPress={handleResetSettings}
            last
          />
        </Section>
      </SettingsGrid>
      <LogsModal open={logsOpen} onClose={() => setLogsOpen(false)} />
    </>
  )
}
