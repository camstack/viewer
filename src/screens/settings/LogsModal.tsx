/** In-app logs viewer — renders the live ring buffer (newest first). The same
 *  entries are batch-shipped to the connected server when debug mode is on.
 *
 *  It opens in the ONE sheet frame (operator, 2026-10-21): a full-height sheet
 *  on a phone, a centred dialog on the web, with the kit's sheet header and
 *  empty state; each line's level is a theme token (`levelTone`). */
import React from 'react'
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Download, ScrollText, Trash2 } from '../../lib/icons.js'
import { useLogStore, logEntryToLine, type LogEntry } from '../../lib/logger.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, TYPOGRAPHY, type ColorTokens } from '../../theme/tokens.js'
import { EmptyState } from '../../components/ui/EmptyState.js'
import { SheetHeader, SheetIconButton } from '../../components/ui/SheetHeader.js'
import { SheetModal } from '../../components/ui/SheetModal.js'

/** Newest lines shown, so the list stays responsive on a big buffer. */
const SHOWN_LINES = 500

/** The token a log level is written in. */
export function levelTone(level: LogEntry['level'], colors: ColorTokens): string {
  switch (level) {
    case 'error':
      return colors.danger
    case 'warn':
      return colors.warning
    case 'info':
      return colors.foregroundMuted
    default:
      return colors.foregroundSubtle
  }
}

export function LogsModal({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const entries = useLogStore((s) => s.entries)
  const clear = useLogStore((s) => s.clear)
  const ordered = entries.slice(-SHOWN_LINES).reverse()

  const onShare = (): void => {
    void Share.share({ message: entries.map(logEntryToLine).join('\n') })
  }

  return (
    <SheetModal
      visible={open}
      onClose={onClose}
      testID="logs-sheet"
      sheetStyle={[
        styles.sheet,
        { backgroundColor: colors.backgroundElevated, paddingTop: insets.top + SPACING.md, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.header}>
        <SheetHeader
          title={t('v2.settings.viewLogs')}
          onClose={onClose}
          actions={
            entries.length > 0 ? (
              <>
                <SheetIconButton icon={Download} label={t('v2.settings.logsShare')} onPress={onShare} />
                <SheetIconButton icon={Trash2} tone="danger" label={t('v2.settings.logsClear')} onPress={clear} />
              </>
            ) : null
          }
        />
      </View>
      {ordered.length === 0 ? (
        <EmptyState icon={ScrollText} title={t('v2.settings.logsEmpty')} />
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {ordered.map((e) => (
            <Text key={e.id} selectable style={[styles.line, { color: levelTone(e.level, colors) }]}>
              {logEntryToLine(e)}
            </Text>
          ))}
        </ScrollView>
      )}
    </SheetModal>
  )
}

const styles = StyleSheet.create({
  // Full height on a phone; the web dialog frame caps it at 90% of the window.
  sheet: { height: '100%' },
  header: { paddingHorizontal: SPACING.xl },
  list: { flex: 1 },
  listContent: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xl, gap: SPACING.xs },
  // ui-check-ok: a log line is code, so it is monospace (the platform's)
  line: { fontSize: TYPOGRAPHY.size.xs, lineHeight: 15, fontFamily: 'monospace' },
})
