/**
 * MediaPolicyFields — the whole media policy of a rule, authored: the ONE
 * picture mode (D897), the trigger-zone outline, the linked cameras of a
 * sensor, and the gif / clip cut around the moment.
 */
import React from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { NcRuleKind } from '@camstack/types'
import { SelectRow, type SelectOption } from '../../../../components/ui/SelectRow.js'
import { StepperRow } from '../../../../components/ui/StepperRow.js'
import { ToggleRow } from '../../../../components/ui/ToggleRow.js'
import { ChipMultiselect, type ChipOption } from '../../../../components/ui/ChipMultiselect.js'
import {
  NC_CLIP_SPEED_CHOICES,
  linkedCamerasApplies,
} from '../../../../components/notifications/rule-field-choices.js'
import {
  NC_CLIP_POST_ROLL_DEFAULT_SEC,
  NC_CLIP_PRE_ROLL_DEFAULT_SEC,
  NC_CLIP_ROLL_MAX_SEC,
  NC_CLIP_ROLL_MIN_SEC,
  NC_CLIP_SPEED_DEFAULT,
  NC_MEDIA_PROFILE_VALUES,
  parseMediaImage,
  parseMediaProfile,
  type NcMediaProfileValue,
} from '../../../../components/notifications/rule-editor.js'
import {
  imageModesForKind,
  resolveNcMediaImage,
  subjectPathDrawable,
  triggerZoneDrawable,
} from '../../../../components/notifications/rule-media-image.js'
import {
  NcLinkedCameraModeSchema,
  type NcConditions,
  type NcLinkedCameraMode,
  type NcMediaImage,
  type NcMediaPolicy,
} from '../../../../data/notification-center.js'
import { Hint } from './SectionHint.js'
import { useTheme } from '../../../../theme/theme-provider.js'
import { SPACING } from '../../../../theme/tokens.js'

export interface MediaPolicyFieldsProps {
  readonly media: NcMediaPolicy
  /** The rule's kind — decides which picture modes exist (a sound is never a crop). */
  readonly kind: NcRuleKind
  /** The rule's conditions as they will be SAVED — decide whether a trigger zone can be drawn. */
  readonly conditions: NcConditions
  readonly onChange: (next: NcMediaPolicy) => void
}

/**
 * The whole media policy, authored.
 *
 * Visibility follows meaning rather than hiding controls to be tidy:
 *  - the picture select offers only the modes the kind can honour
 *    (`imageModesForKind`), each with its one-line description;
 *  - "Draw the zone that triggered the rule" appears only on a rule whose
 *    trigger IS a zone and only on a scene mode — a crop never shows it, and
 *    the hub refuses the flag anywhere else;
 *  - the linked-cameras choice appears on a sensor rule with a picture;
 *  - the roll seconds, speed and footage profile appear once a gif or a clip
 *    is on (they describe a CUT that otherwise is not taken).
 *
 * Absence is the default everywhere but `image` (see `pruneMediaPolicy`): the
 * toggles read `!== true` and the roll steppers show the hub's defaults.
 */
export function MediaPolicyFields({ media, kind, conditions, onChange }: MediaPolicyFieldsProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  const image = resolveNcMediaImage(media, kind)
  const imageOptions: readonly SelectOption<NcMediaImage>[] = imageModesForKind(kind).map((value) => ({
    value,
    label: t(`v2.nc.rules.editor.image.${value}`),
    detail: t(`v2.nc.rules.editor.imageHint.${value}`),
  }))
  const offersTriggerZone = triggerZoneDrawable(image, conditions)
  const offersSubjectPath = subjectPathDrawable(image, kind)
  const offersLinkedCameras = linkedCamerasApplies(kind) && image !== 'none'
  const profileOptions: readonly SelectOption<NcMediaProfileValue>[] = NC_MEDIA_PROFILE_VALUES.map(
    (value) => ({ value, label: t(`v2.nc.rules.editor.profile.${value}`) }),
  )

  const linkedOptions: readonly SelectOption<NcLinkedCameraMode>[] = NcLinkedCameraModeSchema.options.map(
    (value) => ({ value, label: t(`v2.nc.rules.editor.linkedCameras.${value}`) }),
  )
  const speedChips: readonly ChipOption<string>[] = NC_CLIP_SPEED_CHOICES.map((speed) => ({
    value: String(speed),
    label: t('v2.nc.rules.editor.clipSpeedValue', { speed }),
  }))
  const clipSpeed = media.clipSpeed ?? NC_CLIP_SPEED_DEFAULT

  const patch = (next: Partial<NcMediaPolicy>): void => onChange({ ...media, ...next })
  const cutsFootage = media.gif === true || media.clip === true

  return (
    <>
      <SelectRow<NcMediaImage>
        label={t('v2.nc.rules.editor.imageLabel')}
        options={imageOptions}
        value={image}
        onChange={(next) => patch({ image: parseMediaImage(next) ?? image })}
      />
      <Hint text={t(`v2.nc.rules.editor.imageHint.${image}`)} />

      {offersTriggerZone ? (
        <ToggleRow
          label={t('v2.nc.rules.editor.showTriggerZoneLabel')}
          description={t('v2.nc.rules.editor.showTriggerZoneHint')}
          value={media.showTriggerZone === true}
          onValueChange={(next) => patch({ showTriggerZone: next ? true : undefined })}
        />
      ) : null}

      {offersSubjectPath ? (
        <ToggleRow
          label={t('v2.nc.rules.editor.showSubjectPathLabel')}
          description={t('v2.nc.rules.editor.showSubjectPathHint')}
          value={media.showSubjectPath === true}
          onValueChange={(next) => patch({ showSubjectPath: next ? true : undefined })}
        />
      ) : null}

      {offersLinkedCameras ? (
        <SelectRow<NcLinkedCameraMode>
          label={t('v2.nc.rules.editor.linkedCamerasLabel')}
          options={linkedOptions}
          value={media.linkedCameras ?? 'mosaic'}
          // `mosaic` is the hub's default: written only when it was stored.
          onChange={(next) =>
            patch({ linkedCameras: next === 'mosaic' && media.linkedCameras === undefined ? undefined : next })
          }
        />
      ) : null}
      {offersLinkedCameras ? <Hint text={t('v2.nc.rules.editor.linkedCamerasHint')} /> : null}

      <ToggleRow
        label={t('v2.nc.rules.editor.gifLabel')}
        description={t('v2.nc.rules.editor.gifHint')}
        value={media.gif === true}
        onValueChange={(next) => patch({ gif: next ? true : undefined })}
      />

      <ToggleRow
        label={t('v2.nc.rules.editor.clipLabel')}
        description={t('v2.nc.rules.editor.clipHint')}
        value={media.clip === true}
        onValueChange={(next) => patch({ clip: next ? true : undefined })}
        last={!cutsFootage}
      />

      {cutsFootage ? (
        <StepperRow
          label={t('v2.nc.rules.editor.preRollLabel')}
          value={media.clipPreRollSec ?? NC_CLIP_PRE_ROLL_DEFAULT_SEC}
          min={NC_CLIP_ROLL_MIN_SEC}
          max={NC_CLIP_ROLL_MAX_SEC}
          onChange={(next) => patch({ clipPreRollSec: next })}
        />
      ) : null}

      {cutsFootage ? (
        <StepperRow
          label={t('v2.nc.rules.editor.postRollLabel')}
          value={media.clipPostRollSec ?? NC_CLIP_POST_ROLL_DEFAULT_SEC}
          min={NC_CLIP_ROLL_MIN_SEC}
          max={NC_CLIP_ROLL_MAX_SEC}
          onChange={(next) => patch({ clipPostRollSec: next })}
        />
      ) : null}

      {cutsFootage ? (
        <View style={{ paddingHorizontal: SPACING.xl, paddingTop: SPACING.md }}>
          <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '500' }}>
            {t('v2.nc.rules.editor.clipSpeedLabel')}
          </Text>
          <ChipMultiselect<string>
            options={speedChips}
            selected={[String(clipSpeed)]}
            // Single choice: the default is written as absent.
            onToggle={(value) => {
              const speed = Number(value)
              patch({ clipSpeed: speed === NC_CLIP_SPEED_DEFAULT ? undefined : speed })
            }}
          />
        </View>
      ) : null}
      {cutsFootage ? <Hint text={t('v2.nc.rules.editor.clipSpeedHint')} /> : null}

      {cutsFootage ? (
        <SelectRow<NcMediaProfileValue>
          label={t('v2.nc.rules.editor.profileLabel')}
          options={profileOptions}
          value={media.profile ?? 'auto'}
          onChange={(next) => patch({ profile: parseMediaProfile(next) })}
          last
        />
      ) : null}
    </>
  )
}

