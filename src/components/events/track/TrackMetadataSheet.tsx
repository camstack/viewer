/**
 * TrackMetadataSheet — the track detail's METADATA view (slide-up sheet):
 * every identifying/diagnostic field in one place, each row with a copy
 * button. Holds what the operator moved OUT of the detail's main body
 * ("why notable", confidence) plus ids, timestamps, class, importance,
 * zones/audio and the stored media keys.
 *
 * Presentational + self-contained copy feedback: tapping a row's copy icon
 * writes the raw value via `copyText` and flashes a transient check.
 */
import React, { memo, useCallback, useEffect, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { X, Copy, Check } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { SheetModal } from '../../ui/SheetModal.js'
import { copyText } from '../../../lib/copy-text.js'
import type { TrackSummary } from '../../../data/track-events.js'
import type { MediaIdRef } from '../../../data/use-track-detail-media.js'
import { formatPlacement, placementRows, type PlacementRowKind } from '../../../data/track-placement.js'
import { SectionLabel } from '../../ui/SectionLabel.js'
import { SheetHeader } from '../../ui/SheetHeader.js'

export interface TrackMetadataSheetProps {
  /** The track whose metadata to show; null hides the sheet. */
  readonly track: TrackSummary | null
  /** The RESOLVED camera display name (client renames included). The summary's
   *  own `cameraName` is often '' (cluster events, embed clicks), so the caller
   *  passes what it resolved; the raw field remains the fallback. */
  readonly cameraName?: string
  /** Best-detection confidence [0,1], when loaded (fetched lazily by the caller). */
  readonly confidence?: number
  /** Stored media row ids (event + track owned), from useTrackDetailMedia. */
  readonly mediaIds: readonly MediaIdRef[]
  /** Visited zones resolved to display NAMES (falls back to ids). When omitted,
   *  the raw `track.zonesVisited` ids are shown. */
  readonly zoneLabels?: readonly string[]
  /** Show where the track was inferred (node · device (model)). Diagnostic:
   *  the caller passes it for a confirmed admin only. Defaults to false. */
  readonly showPlacement?: boolean
  readonly onClose: () => void
}

/** i18n key of each placement row's label. */
const PLACEMENT_LABEL_KEYS: Readonly<Record<PlacementRowKind, string>> = {
  detectedOn: 'v2.tracks.meta.detectedOn',
  openedOn: 'v2.tracks.meta.openedOn',
  closedOn: 'v2.tracks.meta.closedOn',
}

/** One metadata entry: a label key, the display value, and the raw copy text. */
interface MetaEntry {
  readonly key: string
  readonly label: string
  readonly value: string
  /** Raw text the copy button writes (defaults to `value`). */
  readonly copyValue?: string
}

function isoWithEpoch(ms: number): string {
  return `${new Date(ms).toLocaleString()} (${ms})`
}

/** The placement rows (none unless `show`, none when the track names no node). */
function placementEntries(track: TrackSummary, show: boolean, t: (key: string) => string): MetaEntry[] {
  if (!show) return []
  return placementRows(track.openedPlacement, track.closedPlacement).map((row) => ({
    key: row.kind,
    label: t(PLACEMENT_LABEL_KEYS[row.kind]),
    value: formatPlacement(row.placement),
  }))
}

/** Build the entry list from the track + lazy extras. Skips absent optionals. */
function buildEntries(
  track: TrackSummary,
  cameraName: string | undefined,
  confidence: number | undefined,
  zoneLabels: readonly string[] | undefined,
  t: (key: string) => string,
  showPlacement = false,
): MetaEntry[] {
  // Display zone NAMES (raw ids remain the copy value for diagnostics).
  const zoneDisplay = zoneLabels !== undefined && zoneLabels.length > 0 ? zoneLabels : track.zonesVisited
  const entries: MetaEntry[] = [
    { key: 'trackId', label: t('v2.tracks.meta.trackId'), value: track.trackId },
    { key: 'bestEventId', label: t('v2.tracks.meta.eventId'), value: track.bestEventId },
    { key: 'deviceId', label: t('v2.tracks.meta.deviceId'), value: String(track.deviceId) },
    { key: 'camera', label: t('v2.tracks.meta.camera'), value: cameraName ?? track.cameraName },
    { key: 'className', label: t('v2.tracks.meta.className'), value: track.className },
    ...(track.label !== undefined
      ? [{ key: 'label', label: t('v2.tracks.meta.label'), value: track.label }]
      : []),
    {
      key: 'firstSeen',
      label: t('v2.tracks.meta.firstSeen'),
      value: isoWithEpoch(track.firstSeen),
      copyValue: String(track.firstSeen),
    },
    {
      key: 'lastSeen',
      label: t('v2.tracks.meta.lastSeen'),
      value: isoWithEpoch(track.lastSeen),
      copyValue: String(track.lastSeen),
    },
    { key: 'state', label: t('v2.tracks.meta.state'), value: track.state },
    ...placementEntries(track, showPlacement, t),
    ...(typeof track.importance === 'number'
      ? [{
          key: 'importance',
          label: t('v2.tracks.meta.importance'),
          value: `${Math.round(track.importance * 100)}%`,
          copyValue: String(track.importance),
        }]
      : []),
    ...(track.importanceReason !== undefined
      ? [{ key: 'reason', label: t('v2.tracks.reason'), value: track.importanceReason }]
      : []),
    ...(typeof confidence === 'number'
      ? [{
          key: 'confidence',
          label: t('v2.tracks.meta.confidence'),
          value: `${Math.round(confidence * 100)}%`,
          copyValue: String(confidence),
        }]
      : []),
    ...(track.zonesVisited.length > 0
      ? [{
          key: 'zones',
          label: t('v2.tracks.zones'),
          value: zoneDisplay.join(', '),
          copyValue: track.zonesVisited.join(', '),
        }]
      : []),
    ...(track.audioLabels.length > 0
      ? [{ key: 'audio', label: t('v2.tracks.audio'), value: track.audioLabels.join(', ') }]
      : []),
  ]
  return entries
}

export const TrackMetadataSheet = memo(function TrackMetadataSheet({
  track, cameraName, confidence, mediaIds, zoneLabels, showPlacement = false, onClose,
}: TrackMetadataSheetProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()

  return (
    <SheetModal
      visible={track !== null}
      onClose={onClose}
      sheetStyle={[styles.sheet, { backgroundColor: colors.backgroundElevated }]}
    >
      <SheetHeader
        title={t('v2.tracks.metadata')}
        onClose={onClose}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.md }}>
        {track !== null
          ? buildEntries(track, cameraName, confidence, zoneLabels, t, showPlacement).map((e) => (
              <MetaRow key={e.key} label={e.label} value={e.value} copyValue={e.copyValue ?? e.value} />
            ))
          : null}
        {mediaIds.length > 0 ? (
          <>
            <SectionLabel style={styles.sectionLabel}>
              {t('v2.tracks.meta.mediaKeys')}
            </SectionLabel>
            {mediaIds.map((m) => (
              <MetaRow
                key={m.mediaId}
                label={m.kind}
                value={String(m.mediaId)}
                copyValue={String(m.mediaId)}
              />
            ))}
          </>
        ) : null}
      </ScrollView>
    </SheetModal>
  )
})

/** Label + selectable value + copy button (transient check on success). */
const MetaRow = memo(function MetaRow({
  label, value, copyValue,
}: { readonly label: string; readonly value: string; readonly copyValue: string }) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const onCopy = useCallback(async (): Promise<void> => {
    const ok = await copyText(copyValue)
    if (ok) setCopied(true)
  }, [copyValue])

  return (
    <View style={[styles.row, { borderBottomColor: colors.borderSubtle }]}>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.foregroundMuted }]}>{label}</Text>
        <Text selectable style={[styles.rowValue, { color: colors.foreground }]}>{value}</Text>
      </View>
      <Pressable
        onPress={() => { void onCopy() }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={copied ? t('v2.tracks.copied') : t('v2.tracks.copy')}
        style={[styles.copyBtn, { backgroundColor: colors.surface }]}
      >
        {copied ? <Check size={14} color={colors.success} /> : <Copy size={14} color={colors.foregroundMuted} />}
      </Pressable>
    </View>
  )
})

const styles = StyleSheet.create({
  sheet: { maxHeight: '80%', borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, paddingHorizontal: SPACING.md, paddingTop: SPACING.md },
  sectionLabel: { marginTop: SPACING.md, marginBottom: SPACING.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  rowValue: { fontSize: 13, marginTop: 1 },
  copyBtn: { width: 30, height: 30, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
})
