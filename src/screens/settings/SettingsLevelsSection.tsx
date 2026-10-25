/**
 * Settings → App: the two levels every setting lives at (operator-approved
 * layout, 2026-10-21) — what stays on THIS device, and what belongs to the
 * operator's ACCOUNT on the active hub, with the account sync's status and a
 * copy from another signed-in hub.
 */
import React from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Cloud, Copy, TriangleAlert } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { Section } from '../../components/ui/Section.js'
import { Row } from '../../components/ui/Row.js'
import { useConfirm } from '../../components/ui/confirm.js'
import { useServer } from '../../app/ServerProvider.js'
import { serverLabelOf } from '../../connection/server-name.js'
import { useAccountSyncStore } from '../../account/account-sync-store.js'
import { copySourceHubs, syncStatusLine } from './settings-levels-model.js'

/** The muted explanation at the top of a section card (the same block the
 *  General section's labels use). */
interface SectionHintProps {
  readonly text: string
  readonly last?: boolean
}

function SectionHint({ text, last }: SectionHintProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View style={{ paddingHorizontal: SPACING.xl, paddingTop: SPACING.lg, paddingBottom: last ? SPACING.lg : SPACING.sm }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 18 }}>{text}</Text>
    </View>
  )
}

export function SettingsLevelsSection(): React.JSX.Element {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const { server, servers } = useServer()
  const status = useAccountSyncStore((s) => s.status)
  const sync = useAccountSyncStore((s) => s.sync)
  const hubName = server === null ? '' : serverLabelOf(server)
  const sources = copySourceHubs(servers, server?.id ?? null)
  const line = syncStatusLine(status, Date.now())

  const handleCopy = (sourceId: string, sourceName: string): void => {
    void (async (): Promise<void> => {
      const ok = await confirm({
        title: t('v2.settings.levels.copyTitle', { from: sourceName }),
        message: t('v2.settings.levels.copyBody', { from: sourceName, to: hubName }),
        confirmLabel: t('v2.settings.levels.copyConfirm'),
        cancelLabel: t('v2.settings.cancel'),
        destructive: true,
      })
      if (ok) await sync?.copyFrom(sourceId)
    })()
  }

  return (
    <>
      <Section title={t('v2.settings.levels.deviceTitle')}>
        <SectionHint text={t('v2.settings.levels.deviceHint')} last />
      </Section>
      {server === null ? null : (
        <Section title={t('v2.settings.levels.accountTitle', { hub: hubName })}>
          <SectionHint text={t('v2.settings.levels.accountHint')} />
          <Row
            icon={line.danger ? TriangleAlert : Cloud}
            label={t(line.key, line.args)}
            danger={line.danger}
            last={sources.length === 0}
          />
          {sources.map((hub, i) => {
            const name = serverLabelOf(hub)
            return (
              <Row
                key={hub.id}
                icon={Copy}
                label={t('v2.settings.levels.copyFrom', { hub: name })}
                onPress={() => handleCopy(hub.id, name)}
                last={i === sources.length - 1}
              />
            )
          })}
        </Section>
      )}
    </>
  )
}
