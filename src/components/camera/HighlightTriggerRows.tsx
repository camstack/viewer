/**
 * HighlightTriggerRows — the highlight-trigger editor rows shared by every
 * surface that edits a `GridHighlightSettings` object: the camera-detail
 * overlay panel (the border section), the grid menu and the grid share dialog.
 *
 * Purely presentational: motion toggle, audio toggle + level (meter rungs
 * 2 / 4 / 6, 5s hold), detection toggle + class chips + hold. State +
 * persistence are owned by the caller and driven through `onSetHighlight`
 * patches. The section title (if any) is the caller's — this renders ONLY the
 * rows.
 *
 * ## Every trigger is a switch, and its detail sits behind it
 *
 * Audio used to be the exception: a four-way Off/Low/Mid/High picker between two
 * toggles, which is why it read as a different KIND of control from its
 * neighbours. It is now a switch with the level picker underneath, revealed when
 * on — exactly the shape `detection` already had with its class chips and hold.
 * The stored vocabulary is unchanged (`'off' | 'sensor' | 'level'` + `audioDb`),
 * so nothing needed migrating: `audioLevelFromStored` reads the rung back out of
 * `audioDb` whether the trigger is on or off (see `audio-level`), and the switch
 * re-pins it on the way past, so an off → on round trip lands where it started.
 *
 * The cluster-label select is deliberately NOT one of these rows: it styles the
 * timeline's cluster cards, not the border, so it renders where the timeline is
 * configured (`ClusterLabelRow` below) — bundling it here once put a card
 * setting inside the camera view's border editor.
 */
import React from 'react'
import { View, Text, Switch, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Zap, Volume2, Box, Tag, type LucideIcon } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { SelectRow, type SelectOption } from '../ui/SelectRow.js'
import { HighlightClassChips } from '../grid/HighlightClassChips.js'
import {
  AUDIO_HIGHLIGHT_HOLD_SEC,
  AUDIO_HIGHLIGHT_LEVEL_ORDER,
  audioLevelFromStored,
  dbfsForAudioUi,
  type AudioHighlightLevel,
} from './audio-level.js'
import type { GridHighlightSettings, GridClusterLabelMode } from '../../store/grid-store.js'

export interface HighlightTriggerRowsProps {
  readonly highlight: GridHighlightSettings
  readonly onSetHighlight: (patch: Partial<GridHighlightSettings>) => void
}

export function HighlightTriggerRows({ highlight, onSetHighlight }: HighlightTriggerRowsProps) {
  const { t } = useTranslation()

  // The audio trigger is a SWITCH with its level behind it — the same shape as
  // `detection` below, and for the same reason: "does this light the border?"
  // and "how loud does it have to be?" are two questions, and folding them into
  // one four-way picker made audio the only trigger on the panel that was not a
  // toggle. The stored mode stays `'off' | 'sensor' | 'level'`; the rung lives in
  // `audioDb` and is read back regardless of the mode, so it survives an off/on.
  const audioOn = highlight.audio !== 'off'
  const audioLevel = audioLevelFromStored(highlight.audio, highlight.audioDb)
  const levelLabel: Readonly<Record<AudioHighlightLevel, string>> = {
    low: t('v2.gridBuilder.highlightAudioLow'),
    mid: t('v2.gridBuilder.highlightAudioMid'),
    high: t('v2.gridBuilder.highlightAudioHigh'),
  }
  const audioLevelOptions: readonly SelectOption<AudioHighlightLevel>[] =
    AUDIO_HIGHLIGHT_LEVEL_ORDER.map((ui) => ({ value: ui, label: levelLabel[ui] }))
  // Every audio edit — the switch in EITHER direction, and the level picker —
  // writes the same three fields. Off pins the rung it was showing rather than
  // writing the mode alone: a legacy `'sensor'` carries a dB number that never
  // meant anything, and leaving it standing would bring the trigger back one
  // rung away from where the operator last saw it.
  const setAudio = (on: boolean, ui: AudioHighlightLevel): void =>
    onSetHighlight({
      audio: on ? 'level' : 'off',
      audioDb: dbfsForAudioUi(ui),
      audioHoldSec: AUDIO_HIGHLIGHT_HOLD_SEC,
    })
  const holdOptions: readonly SelectOption<number>[] = [2, 3, 5, 8].map((v) => ({ value: v, label: `${v}s` }))

  return (
    <>
      <PanelToggleRow
        icon={Zap}
        label={t('v2.gridBuilder.highlightMotion')}
        value={highlight.motion}
        onValueChange={() => onSetHighlight({ motion: !highlight.motion })}
      />
      <PanelToggleRow
        icon={Volume2}
        label={t('v2.gridBuilder.highlightAudio')}
        value={audioOn}
        onValueChange={() => setAudio(!audioOn, audioLevel)}
      />
      {audioOn ? (
        <SelectRow
          icon={Volume2}
          label={t('v2.gridBuilder.highlightAudioLevel')}
          options={audioLevelOptions}
          value={audioLevel}
          onChange={(ui) => setAudio(true, ui)}
        />
      ) : null}
      <PanelToggleRow
        icon={Box}
        label={t('v2.gridBuilder.highlightDetection')}
        value={highlight.detection}
        onValueChange={() => onSetHighlight({ detection: !highlight.detection })}
      />
      {highlight.detection ? (
        <>
          <HighlightClassChips
            selected={highlight.detectionClasses}
            onChange={(next) => onSetHighlight({ detectionClasses: next })}
          />
          <SelectRow
            icon={Box}
            label={t('v2.gridBuilder.highlightHold')}
            options={holdOptions}
            value={highlight.detectionHoldSec}
            onChange={(v) => onSetHighlight({ detectionHoldSec: v })}
          />
        </>
      ) : null}
    </>
  )
}

export interface ClusterLabelRowProps {
  readonly value: GridClusterLabelMode
  readonly onChange: (mode: GridClusterLabelMode) => void
}

/** The cluster-card label mode (icon vs text). A TIMELINE-presentation setting
 *  that shares the `GridHighlightSettings` document with the border triggers —
 *  rendered by the surfaces that configure the timeline/grid cards, never by
 *  the overlay's border section. */
export function ClusterLabelRow({ value, onChange }: ClusterLabelRowProps) {
  const { t } = useTranslation()
  const clusterLabelOptions: readonly SelectOption<GridClusterLabelMode>[] = [
    { value: 'icon', label: t('v2.gridBuilder.clusterLabelIcon') },
    { value: 'text', label: t('v2.gridBuilder.clusterLabelText') },
  ]
  return (
    <SelectRow
      icon={Tag}
      label={t('v2.gridBuilder.clusterLabel')}
      options={clusterLabelOptions}
      value={value}
      onChange={onChange}
    />
  )
}

/** Compact icon + label + switch row used inside floating panels/dialogs.
 *  (Distinct from `ui/ToggleRow`, whose card paddings/hairline don't fit a
 *  popover.) Shared by `CameraMenuPanel` and `GridShareDialog`. */
export function PanelToggleRow({
  icon: Icon,
  label,
  value,
  onValueChange,
}: {
  readonly icon: LucideIcon
  readonly label: string
  readonly value: boolean
  readonly onValueChange: () => void
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.row}>
      <Icon size={18} color={value ? colors.primary : colors.foregroundMuted} />
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#ffffff"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  label: { flex: 1, fontSize: 14, fontWeight: '500' },
})
