/**
 * ClipSourceRow — which ONE of this camera's clip sources the clips list reads.
 *
 * ## The operator's rule
 *
 * > *"La sorgente deve essere selezionata lato viewer dall'utente nelle settings
 * > generali della camera come provider di quella camera. Mai mischiate provider
 * > diversi."*
 *
 * So: per camera, in the camera's own menu, one at a time. It is a SELECTOR and
 * not a set of tick boxes, and not because a multiselect would be ugly —
 * `videoclips.listClips` takes ONE `provider`, so a multi-pick would be a
 * control offering a sum the hub cannot answer (D557 § 4).
 *
 * ## What it writes, and what it must never write
 *
 * It writes the per-camera prefs document and nothing else — the same place
 * `quality` and `audioOn` live, because this is the same kind of fact: what the
 * person holding the phone is LOOKING at.
 *
 * It must never write a hub authority. Sources are not enabled or disabled
 * here: each one exists because of a configuration that lives somewhere else —
 * HKSV because the camera is exported to HomeKit, the Reolink source because
 * Reolink is that camera's provider, CamStack's because it is always there. A
 * knob over somebody else's decision is D62's failure reached from the
 * direction D62 does not describe, and D557 § 3 rejected exactly this control
 * on the admin side for exactly this reason.
 *
 * ## Why it can be absent
 *
 * With fewer than two sources there is nothing to choose. Drawing an empty or
 * single-entry selector reads as a defect, and the fix is then looked for in
 * the UI rather than in the binding store where it is (D557 § 4). And while
 * `listSources` has not answered there are no rows at all — not-yet-known must
 * never look like not-installed (D315).
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Clapperboard } from '../../lib/icons.js'

import { SelectRow, type SelectOption } from '../ui/SelectRow.js'
import { useCameraClipProvider } from '../../data/use-camera-prefs.js'
import { useClipSourceRows } from '../../data/use-camera-clips.js'
import { clipSourcePickerOptions, CLIP_PROVIDER_CAMSTACK_SOURCE } from '../../clips/clip-sources.js'

export interface ClipSourceRowProps {
  readonly deviceId: number
  readonly last?: boolean
}

export function ClipSourceRow({ deviceId, last }: ClipSourceRowProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const pref = useCameraClipProvider(deviceId)
  const sources = useClipSourceRows(deviceId)

  const options = useMemo<readonly SelectOption<string>[]>(
    () =>
      clipSourcePickerOptions(sources).map((option) => ({
        value: option.value,
        label: option.label,
        // The source's own words when it gave any, else our name for the
        // state. A client that paraphrases a server's prose drifts the first
        // time a word changes (D563), so the prose wins where it exists.
        ...(option.detail !== undefined
          ? { detail: option.detail }
          : option.stateKey !== null
            ? { detail: t(option.stateKey) }
            : {}),
      })),
    [sources, t],
  )

  if (options.length < 2) return null

  // Absence means CamStack, which is also what the clips list defaults to. The
  // row shows that rather than an empty value, so the control never looks
  // unset when it is merely at its default.
  const value = pref.chosen ?? CLIP_PROVIDER_CAMSTACK_SOURCE

  return (
    <SelectRow
      icon={Clapperboard}
      label={t('v2.clips.sourceSetting')}
      options={options}
      value={value}
      onChange={(next) =>
        // The default is stored as ABSENCE, so a camera left on CamStack carries
        // no document at all — and a future change to that default is not
        // silently pinned to today's value on every camera ever opened.
        pref.setChosen(next === CLIP_PROVIDER_CAMSTACK_SOURCE ? undefined : next)
      }
      {...(last !== undefined ? { last } : {})}
    />
  )
}
