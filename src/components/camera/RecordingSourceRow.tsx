/**
 * RecordingSourceRow — which ONE of this camera's recording sources the
 * timeline bar is painted from.
 *
 * The twin of {@link ClipSourceRow}, on a deliberately separate axis: a camera
 * whose CLIPS come from its card may still have its continuous bar painted by
 * us, and folding the two into one control would make one answer decide two
 * questions.
 *
 * ## The default is ours, and it is structural
 *
 * The operator's ruling is *"Il default va SEMPRE su quello attuale di
 * sistema"*. That is not a sort order here: `camstack` is a RESERVED source id
 * only the recorder may mint (D625), absence of a pick MEANS it, and clearing
 * the pick stores ABSENCE rather than the string. So a future change to the
 * default is not silently pinned to today's value on every camera ever opened.
 *
 * ## What it writes, and what it must never write
 *
 * The per-camera prefs document and nothing else — the same kind of fact as
 * a camera's local name: what the person holding the phone is LOOKING at
 * (and, unlike its stream tier and audio memory, an account setting). It never writes a hub authority: a source
 * exists because of a configuration that lives elsewhere, and a second knob
 * over somebody else's decision is D62's failure (D557 § 3).
 *
 * ## Why it can be absent
 *
 * With fewer than two sources there is nothing to choose, and an empty or
 * single-entry selector reads as a defect — the fix is then looked for in the
 * UI rather than in the binding store where it is (D557 § 4). While
 * `listSources` has not answered there is only our row, so the control is
 * absent rather than claiming the camera has no other source (D315).
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { HardDrive } from '../../lib/icons.js'

import { SelectRow, type SelectOption } from '../ui/SelectRow.js'
import { useCameraRecordingProvider } from '../../data/use-camera-prefs.js'
import { useRecordingSourceRows } from '../../data/use-recording-provider-plan.js'
import {
  RECORDING_SOURCE_CAMSTACK,
  recordingSourcePickerOptions,
} from '../../data/recording-sources.js'

export interface RecordingSourceRowProps {
  readonly deviceId: number
  readonly last?: boolean
}

export function RecordingSourceRow({
  deviceId,
  last,
}: RecordingSourceRowProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const pref = useCameraRecordingProvider(deviceId)
  const sources = useRecordingSourceRows(deviceId)

  const options = useMemo<readonly SelectOption<string>[]>(
    () =>
      recordingSourcePickerOptions(sources, t('v2.clips.recordingSourceOurs')).map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [sources, t],
  )

  if (options.length < 2) return null

  // Absence means ours, which is what the timeline already draws. Showing that
  // rather than an empty value keeps the control from looking unset when it is
  // merely at its default.
  const value = pref.chosen ?? RECORDING_SOURCE_CAMSTACK

  return (
    <SelectRow
      icon={HardDrive}
      label={t('v2.clips.recordingSourceSetting')}
      options={options}
      value={value}
      onChange={(next) =>
        pref.setChosen(next === RECORDING_SOURCE_CAMSTACK ? undefined : next)
      }
      {...(last !== undefined ? { last } : {})}
    />
  )
}
