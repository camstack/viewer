/**
 * AudioField — the sustained-sound condition (`valueType: 'audio'`), in the two
 * EXCLUSIVE modes the hub reads (server decision D157).
 *
 * The widget used to show four controls at once — labels, a level floor, a hit
 * percentage and a window — as if they composed. They do not, and pretending
 * they did shipped a rule that could never fire: the classifier puts a macro
 * label on one to three frames of an entire episode, so the 60%-of-the-window
 * default was a question no label rule could ever answer. The live "baby
 * crying" rule sat there for two days notifying nothing, and said nothing about
 * why.
 *
 * So the mode comes first and the fields follow it:
 *
 *  - **Sounds** — the rule names sounds and fires on the FIRST labelled frame.
 *    `hitPercent` and `samplingSeconds` are not merely hidden, they do not
 *    apply, and the hint says so.
 *  - **Volume** — the rule names a level floor and the sampling window IS the
 *    condition, exactly as before.
 *
 * The mode is not stored: it is which filter the condition carries, read
 * through `audioModeOf` and written through `patchAudio`, which clears the
 * other filter on every write. The form therefore never SENDS both — the hub
 * would normalize it anyway, but a save that writes a window the editor no
 * longer shows is a knob that disagrees with the authority it describes, and
 * this repo has shipped that twice.
 *
 * Two older behaviours survive unchanged, because both are still load-bearing:
 * dBFS is negative-going (every write clamped into `[-96, 0]`), and a stored
 * label neither the hub nor this build knows renders as an explicitly-unknown,
 * removable chip rather than disappearing.
 */
import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { X } from '../../lib/icons.js'
import { hapticTap } from '../../lib/haptics.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import { SegmentedControl, type SegmentOption } from '../ui/SegmentedControl.js'
import { NumericStepper } from './NumericStepper.js'
import {
  NC_AUDIO_DB_MAX,
  NC_AUDIO_DB_MIN,
  NC_AUDIO_DB_OFFERED,
  NC_AUDIO_DB_STEP,
  NC_AUDIO_CONFIRM_HITS_DEFAULT,
  NC_AUDIO_CONFIRM_HITS_MAX,
  NC_AUDIO_CONFIRM_HITS_MIN,
  NC_AUDIO_CONFIRM_WINDOW_MAX_SEC,
  NC_AUDIO_CONFIRM_WINDOW_MIN_SEC,
  NC_AUDIO_CONFIRM_WINDOW_SEC_DEFAULT,
  NC_AUDIO_HIT_PERCENT_MAX,
  NC_AUDIO_HIT_PERCENT_MIN,
  NC_AUDIO_SAMPLING_MAX_SEC,
  NC_AUDIO_SAMPLING_MIN_SEC,
  audioIsFailClosed,
  audioLabelChoices,
  audioModeOf,
  audioOrDefaults,
  isAudioLabelSelected,
  patchAudio,
  toggleAudioLabel,
  type NcAudioMode,
  type NcAudioPatch,
} from './audio-condition.js'
import type { NcAudioCondition, NcTaxonomy } from '../../data/notification-center.js'

interface AudioFieldProps {
  /** Server audio vocabulary; absent → the local macro catalog is offered. */
  readonly taxonomy: NcTaxonomy | undefined
  readonly value: NcAudioCondition | undefined
  readonly onChange: (next: NcAudioCondition | undefined) => void
}

export function AudioField({ taxonomy, value, onChange }: AudioFieldProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const current = audioOrDefaults(value)
  const patch = (next: NcAudioPatch): void => onChange(patchAudio(value, next))

  // An unauthored condition opens on `label`: it is the mode that needs no
  // number to work, so the operator can finish the rule by tapping one chip.
  const mode: NcAudioMode = audioModeOf(value) ?? 'label'
  const modeOptions: readonly SegmentOption<NcAudioMode>[] = [
    { value: 'label', label: t('v2.nc.rules.editor.audio.modeLabelOption') },
    { value: 'level', label: t('v2.nc.rules.editor.audio.modeLevelOption') },
  ]

  const { choices, unknownLabels } = audioLabelChoices(taxonomy, current.labels)

  return (
    <View style={{ gap: SPACING.lg }}>
      <View style={{ gap: SPACING.sm }}>
        <FieldLabel text={t('v2.nc.rules.editor.audio.modeLabel')} />
        <SegmentedControl
          options={modeOptions}
          value={mode}
          onChange={(next) => patch({ mode: next })}
        />
        <Hint
          text={t(
            mode === 'label'
              ? 'v2.nc.rules.editor.audio.modeLabelHint'
              : 'v2.nc.rules.editor.audio.modeLevelHint',
          )}
        />
      </View>

      {mode === 'label' ? (
        <View style={{ gap: SPACING.sm }}>
          <FieldLabel text={t('v2.nc.rules.editor.audio.labelsLabel')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
            {choices.map((choice) => {
              const on = isAudioLabelSelected(current.labels, choice.value)
              return (
                <Pressable
                  key={choice.value}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => {
                    hapticTap()
                    patch({ labels: toggleAudioLabel(current.labels, choice.value) })
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: SPACING.xs,
                    borderRadius: RADIUS.md,
                    paddingVertical: SPACING.xs,
                    paddingHorizontal: SPACING.sm,
                    borderWidth: 1,
                    borderStyle: choice.unknown ? 'dashed' : 'solid',
                    borderColor: choice.unknown
                      ? colors.warning
                      : on
                        ? colors.primary
                        : colors.border,
                    backgroundColor: on ? `${colors.primary}1f` : colors.background,
                  }}
                >
                  <Text style={{ fontSize: 13 }}>{choice.icon}</Text>
                  <Text
                    style={{
                      color: choice.unknown
                        ? colors.warning
                        : on
                          ? colors.primary
                          : colors.foreground,
                      fontSize: 13,
                    }}
                  >
                    {choice.label}
                  </Text>
                  {on ? (
                    <X size={12} color={choice.unknown ? colors.warning : colors.primary} />
                  ) : null}
                </Pressable>
              )
            })}
          </View>
          {unknownLabels.length > 0 ? (
            <Warning
              text={t('v2.nc.rules.editor.audio.labelsUnknown', {
                labels: unknownLabels.join(', '),
              })}
            />
          ) : (
            <Hint text={t('v2.nc.rules.editor.audio.labelsHint')} />
          )}
          <View style={{ gap: SPACING.sm }}>
            <FieldLabel text={t('v2.nc.rules.editor.audio.confirmHitsLabel')} />
            <NumericStepper
              value={current.confirmHits ?? NC_AUDIO_CONFIRM_HITS_DEFAULT}
              min={NC_AUDIO_CONFIRM_HITS_MIN}
              max={NC_AUDIO_CONFIRM_HITS_MAX}
              step={1}
              decimals={0}
              clearable={false}
              onChange={(next) =>
                patch({ confirmHits: next ?? NC_AUDIO_CONFIRM_HITS_DEFAULT })
              }
            />
            <Hint text={t('v2.nc.rules.editor.audio.confirmHitsHint')} />
          </View>
          <View style={{ gap: SPACING.sm }}>
            <FieldLabel text={t('v2.nc.rules.editor.audio.confirmWindowLabel')} />
            <NumericStepper
              value={current.confirmWindowSec ?? NC_AUDIO_CONFIRM_WINDOW_SEC_DEFAULT}
              min={NC_AUDIO_CONFIRM_WINDOW_MIN_SEC}
              max={NC_AUDIO_CONFIRM_WINDOW_MAX_SEC}
              step={1}
              decimals={0}
              clearable={false}
              onChange={(next) =>
                patch({ confirmWindowSec: next ?? NC_AUDIO_CONFIRM_WINDOW_SEC_DEFAULT })
              }
            />
            <Hint text={t('v2.nc.rules.editor.audio.confirmWindowHint')} />
          </View>
        </View>
      ) : (
        <>
          <View style={{ gap: SPACING.sm }}>
            <FieldLabel text={t('v2.nc.rules.editor.audio.dbLabel')} />
            <NumericStepper
              // Switching into this mode already seeded the floor; the fallback
              // is only for a condition that reached here some other way, and
              // it seeds the SAME offered value rather than the −96 minimum.
              value={current.dbThreshold ?? NC_AUDIO_DB_OFFERED}
              min={NC_AUDIO_DB_MIN}
              max={NC_AUDIO_DB_MAX}
              step={NC_AUDIO_DB_STEP}
              decimals={0}
              clearable={false}
              onChange={(next) => patch({ dbThreshold: next ?? NC_AUDIO_DB_OFFERED })}
            />
            <Hint text={t('v2.nc.rules.editor.audio.dbHint')} />
          </View>

          <View style={{ gap: SPACING.sm }}>
            <FieldLabel text={t('v2.nc.rules.editor.audio.hitPercentLabel')} />
            <NumericStepper
              value={current.hitPercent}
              min={NC_AUDIO_HIT_PERCENT_MIN}
              max={NC_AUDIO_HIT_PERCENT_MAX}
              step={5}
              decimals={0}
              clearable={false}
              onChange={(next) => patch({ hitPercent: next ?? NC_AUDIO_HIT_PERCENT_MIN })}
            />
            <Hint text={t('v2.nc.rules.editor.audio.hitPercentHint')} />
          </View>

          <View style={{ gap: SPACING.sm }}>
            <FieldLabel text={t('v2.nc.rules.editor.audio.samplingLabel')} />
            <NumericStepper
              value={current.samplingSeconds}
              min={NC_AUDIO_SAMPLING_MIN_SEC}
              max={NC_AUDIO_SAMPLING_MAX_SEC}
              step={5}
              decimals={0}
              clearable={false}
              onChange={(next) => patch({ samplingSeconds: next ?? NC_AUDIO_SAMPLING_MIN_SEC })}
            />
            <Hint text={t('v2.nc.rules.editor.audio.samplingHint')} />
          </View>
        </>
      )}

      {audioIsFailClosed(value) ? (
        <Warning text={t('v2.nc.rules.editor.audio.failClosedHint')} />
      ) : null}

      <Hint text={t('v2.nc.rules.editor.audio.hint')} />

      {value !== undefined ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            hapticTap()
            onChange(undefined)
          }}
          hitSlop={6}
        >
          <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>
            {t('v2.nc.rules.editor.clear')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function FieldLabel({ text }: { readonly text: string }) {
  const { colors } = useTheme()
  return (
    <Text style={{ color: colors.foregroundSubtle, fontSize: 12, fontWeight: '600' }}>{text}</Text>
  )
}

function Hint({ text }: { readonly text: string }) {
  const { colors } = useTheme()
  return <Text style={{ color: colors.foregroundSubtle, fontSize: 11, lineHeight: 15 }}>{text}</Text>
}

function Warning({ text }: { readonly text: string }) {
  const { colors } = useTheme()
  return <Text style={{ color: colors.warning, fontSize: 11, lineHeight: 15 }}>{text}</Text>
}
