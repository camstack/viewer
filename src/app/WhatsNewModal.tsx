/**
 * What's new — the build that just arrived, and every one before it.
 *
 * Replaces a one-button `notice` whose whole content was the running version's
 * bullets. That dialog was correct and it threw the rest away: an operator who
 * skipped three updates, or dismissed the dialog while walking away from it,
 * had no way back to what changed. `whats-new.ts` has kept every entry since it
 * was written — this is what makes them reachable.
 *
 * ## Shape
 *
 * The latest build is the panel's subject: its own card, accent border, notes
 * in full. Everything before it is behind ONE collapsed panel — closed on
 * open, so the first screenful is the new build and nothing else. Inside it,
 * one collapsed row per version with its date. That ordering is the point —
 * the reason the dialog appeared is the new build, and the history must not
 * compete with it for the first screenful. The operator asked for the outer
 * panel after reading a release long enough that the previous versions pushed
 * it off the screen.
 *
 * A version with no entry (a dev client) highlights nothing and still lists the
 * history: an empty panel would say "nothing ever changed".
 */
import React, { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { ChevronDown, ChevronRight } from '../lib/icons.js'
import { hapticTap } from '../lib/haptics.js'
import { useTheme } from '../theme/theme-provider.js'
import { RADIUS, SPACING } from '../theme/tokens.js'
import { type WhatsNewEntry, whatsNewLines } from './whats-new.js'

export interface WhatsNewModalProps {
  readonly visible: boolean
  /** The running version's entry — highlighted. Null on a version with none. */
  readonly latest: WhatsNewEntry | null
  /** Everything older, newest first. */
  readonly past: readonly WhatsNewEntry[]
  readonly onClose: () => void
}

/** Dates are authored ISO; the operator reads them in their own locale. */
function formatDate(iso: string, language: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return at.toLocaleDateString(language, { day: 'numeric', month: 'short', year: 'numeric' })
}

function Notes({ entry, language }: { readonly entry: WhatsNewEntry; readonly language: string }) {
  const { colors } = useTheme()
  return (
    <View style={styles.notes}>
      {whatsNewLines(entry, language).map((line) => (
        <View key={line} style={styles.note}>
          <Text style={[styles.bullet, { color: colors.primary }]}>•</Text>
          <Text style={[styles.noteText, { color: colors.foreground }]}>{line}</Text>
        </View>
      ))}
    </View>
  )
}

function PastRow({ entry, language }: { readonly entry: WhatsNewEntry; readonly language: string }) {
  const { colors } = useTheme()
  const [open, setOpen] = useState<boolean>(false)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <View style={[styles.pastRow, { borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={entry.version}
        onPress={() => {
          hapticTap()
          setOpen((current) => !current)
        }}
        style={styles.pastHeader}
      >
        <Chevron size={14} color={colors.foregroundMuted} />
        <Text style={[styles.pastVersion, { color: colors.foreground }]}>{entry.version}</Text>
        <Text style={[styles.pastDate, { color: colors.foregroundMuted }]}>
          {formatDate(entry.date, language)}
        </Text>
      </Pressable>
      {open ? <Notes entry={entry} language={language} /> : null}
    </View>
  )
}

/**
 * The whole history behind one disclosure, CLOSED on open.
 *
 * The rows were already collapsed individually, and that was not enough: their
 * headers alone are a screenful once a few versions accumulate, so the release
 * the dialog exists to show was competing with the list of the ones before it.
 * One panel, shut, gives the latest build the room the operator asked for and
 * costs a tap to anyone who wants the rest.
 *
 * The count is on the header because a disclosure that does not say how much
 * is behind it is a door with no handle.
 */
function PastPanel({
  past,
  language,
}: {
  readonly past: readonly WhatsNewEntry[]
  readonly language: string
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [open, setOpen] = useState<boolean>(false)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <View style={styles.pastPanel}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('v2.updates.whatsNewPrevious')}
        onPress={() => {
          hapticTap()
          setOpen((current) => !current)
        }}
        style={styles.pastPanelHeader}
      >
        <Chevron size={14} color={colors.foregroundMuted} />
        <Text style={[styles.pastTitle, { color: colors.foregroundMuted }]}>
          {t('v2.updates.whatsNewPrevious')}
        </Text>
        <Text style={[styles.pastCount, { color: colors.foregroundMuted }]}>
          {String(past.length)}
        </Text>
      </Pressable>
      {open
        ? past.map((entry) => <PastRow key={entry.version} entry={entry} language={language} />)
        : null}
    </View>
  )
}

export function WhatsNewModal({ visible, latest, past, onClose }: WhatsNewModalProps) {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const language = i18n.language
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Tapping outside closes — this panel asks nothing, it only tells. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={t('v2.common.close')}
          onPress={onClose}
        />
        <View
          style={[
            styles.card,
            { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.title, { color: colors.foreground }]}>
            {t('v2.updates.whatsNewHeading')}
          </Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {latest !== null ? (
              <View style={[styles.latest, { borderColor: colors.primary }]}>
                <View style={styles.latestHeader}>
                  <Text style={[styles.latestVersion, { color: colors.primary }]}>
                    {latest.version}
                  </Text>
                  <Text style={[styles.pastDate, { color: colors.foregroundMuted }]}>
                    {formatDate(latest.date, language)}
                  </Text>
                </View>
                <Notes entry={latest} language={language} />
              </View>
            ) : null}
            {past.length > 0 ? (
              <PastPanel past={past} language={language} />
            ) : null}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.close, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.closeLabel}>{t('v2.common.ok')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  card: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '80%',
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
  },
  title: { fontSize: 16, fontWeight: '600', marginBottom: SPACING.md },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingBottom: SPACING.sm },
  latest: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  latestHeader: { flexDirection: 'row', alignItems: 'baseline', gap: SPACING.sm },
  latestVersion: { fontSize: 15, fontWeight: '700' },
  notes: { marginTop: SPACING.sm, gap: SPACING.xs },
  note: { flexDirection: 'row', gap: SPACING.xs },
  bullet: { fontSize: 13, lineHeight: 19 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 19 },
  pastTitle: {
    flex: 1,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  pastPanel: { marginTop: SPACING.sm },
  pastPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  pastCount: { fontSize: 11, fontVariant: ['tabular-nums'] },
  pastRow: { borderTopWidth: 1, paddingVertical: SPACING.sm },
  pastHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  pastVersion: { fontSize: 13, fontWeight: '600' },
  pastDate: { fontSize: 11 },
  close: {
    marginTop: SPACING.md,
    alignSelf: 'flex-end',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  closeLabel: { color: '#fff', fontSize: 13, fontWeight: '600' },
})
