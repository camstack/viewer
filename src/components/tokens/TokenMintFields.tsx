/**
 * The fields of a new token — label, cameras, permission, lifetime — shared by
 * Settings → Account → "New token" and the share dialogs' "Create a token for
 * this view". Controlled: the caller owns the draft.
 */
import React from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { SegmentedControl, type SegmentOption } from '../ui/SegmentedControl.js'
import { ChipMultiselect } from '../ui/ChipMultiselect.js'
import { Field } from '../../screens/settings/sign-in/form-parts.js'
import {
  durationAfterPermission,
  durationsFor,
  TOKEN_LABEL_MAX,
  type TokenDuration,
  type TokenPermission,
} from '../../data/account-tokens.js'

export interface TokenDraft {
  readonly label: string
  readonly permission: TokenPermission
  readonly duration: TokenDuration
  /** Every camera, or the picked ones (`pick`). */
  readonly cameras: 'all' | 'pick'
  readonly picked: readonly number[]
}

export interface CameraChoice {
  readonly id: number
  readonly name: string
}

interface TokenMintFieldsProps {
  readonly draft: TokenDraft
  readonly onChange: (next: TokenDraft) => void
  readonly permissions: readonly TokenPermission[]
  /** The camera choice; absent when the cameras are fixed by the caller. */
  readonly cameras?: readonly CameraChoice[]
}

function Label({ text }: { readonly text: string }) {
  const { colors } = useTheme()
  return <Text style={{ color: colors.foregroundMuted, fontSize: 12, fontWeight: '600' }}>{text}</Text>
}

export function TokenMintFields({ draft, onChange, permissions, cameras }: TokenMintFieldsProps) {
  const { t } = useTranslation()
  const set = (patch: Partial<TokenDraft>): void => onChange({ ...draft, ...patch })
  const permissionOptions: readonly SegmentOption<TokenPermission>[] = permissions.map((p) => ({
    value: p,
    label: t(`v2.tokens.permission.${p}`),
  }))
  const durationOptions: readonly SegmentOption<TokenDuration>[] = durationsFor(draft.permission).map((d) => ({
    value: d,
    label: t(`v2.tokens.duration.${d}`),
  }))
  const cameraOptions: readonly SegmentOption<'all' | 'pick'>[] = [
    { value: 'all', label: t('v2.tokens.camerasAll') },
    { value: 'pick', label: t('v2.tokens.camerasPick') },
  ]
  const showCameras = cameras !== undefined && draft.permission !== 'admin'

  return (
    <View style={{ gap: SPACING.md }}>
      <Field
        label={t('v2.tokens.label')}
        value={draft.label}
        onChangeText={(label) => set({ label })}
        maxLength={TOKEN_LABEL_MAX}
        testID="token-label"
      />
      {permissionOptions.length > 1 ? (
        <>
          <Label text={t('v2.tokens.permissionTitle')} />
          <SegmentedControl
            options={permissionOptions}
            value={draft.permission}
            onChange={(permission) =>
              set({ permission, duration: durationAfterPermission(permission, draft.duration) })
            }
          />
        </>
      ) : null}
      {showCameras ? (
        <>
          <Label text={t('v2.tokens.camerasTitle')} />
          <SegmentedControl options={cameraOptions} value={draft.cameras} onChange={(c) => set({ cameras: c })} />
          {draft.cameras === 'pick' ? (
            <ChipMultiselect
              options={cameras.map((c) => ({ value: String(c.id), label: c.name }))}
              selected={draft.picked.map(String)}
              onToggle={(value) => {
                const id = Number(value)
                set({ picked: draft.picked.includes(id) ? draft.picked.filter((x) => x !== id) : [...draft.picked, id] })
              }}
            />
          ) : null}
        </>
      ) : null}
      <Label text={t('v2.tokens.durationTitle')} />
      <SegmentedControl options={durationOptions} value={draft.duration} onChange={(duration) => set({ duration })} />
    </View>
  )
}
