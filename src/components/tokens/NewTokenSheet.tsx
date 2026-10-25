/**
 * Settings → Account → "New token": label, cameras (all or picked),
 * permission (view / view + talk / admin) and lifetime, then the secret shown
 * ONCE with Copy. An admin token (`'*'`) asks for a fresh re-authentication
 * first, as the hub requires.
 *
 * Needs a `ReauthProvider` above it (Settings → Account mounts one).
 */
import React, { useState } from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SheetModal } from '../ui/SheetModal.js'
import { KeyboardAwareScrollView } from '../ui/KeyboardInset.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { PanelText } from '../../screens/settings/sign-in/form-parts.js'
import { useReauth } from '../../screens/settings/sign-in/ReauthSheet.js'
import { useMintToken } from '../../data/use-sign-in-methods.js'
import { mintInput, mintProblem, type MintRequest, type TokenPermission } from '../../data/account-tokens.js'
import { TokenMintFields, type CameraChoice, type TokenDraft } from './TokenMintFields.js'
import { TokenReveal } from './TokenReveal.js'
import { Button } from '../ui/Button.js'

const EMPTY_DRAFT: TokenDraft = { label: '', permission: 'view', duration: '30d', cameras: 'all', picked: [] }

interface NewTokenSheetProps {
  readonly visible: boolean
  readonly onClose: () => void
  readonly cameras: readonly CameraChoice[]
  /** What this account may mint: `admin` only for an admin. */
  readonly permissions: readonly TokenPermission[]
}

export function NewTokenSheet({ visible, onClose, cameras, permissions }: NewTokenSheetProps) {
  const { colors } = useTheme()
  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      testID="new-token-sheet"
      sheetStyle={{
        backgroundColor: colors.background,
        borderTopLeftRadius: RADIUS.xl,
        borderTopRightRadius: RADIUS.xl,
        maxHeight: '90%',
      }}
    >
      {visible ? <NewTokenBody onClose={onClose} cameras={cameras} permissions={permissions} /> : null}
    </SheetModal>
  )
}

/** The request a draft stands for: "all cameras" is every camera this account sees now. */
export function draftRequest(draft: TokenDraft, cameras: readonly CameraChoice[]): MintRequest {
  return {
    label: draft.label,
    permission: draft.permission,
    kind: 'grid-view',
    deviceIds: draft.cameras === 'all' ? cameras.map((c) => c.id) : draft.picked,
    duration: draft.duration,
  }
}

type NewTokenBodyProps = Omit<NewTokenSheetProps, 'visible'>

function NewTokenBody({ onClose, cameras, permissions }: NewTokenBodyProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const reauth = useReauth()
  const mint = useMintToken()
  const [draft, setDraft] = useState<TokenDraft>(EMPTY_DRAFT)
  const [secret, setSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const request = draftRequest(draft, cameras)
  const problem = mintProblem(request)

  const handleCreate = async (): Promise<void> => {
    setError(null)
    let reauthToken: string | null = null
    if (request.permission === 'admin') {
      const proof = await reauth(t('v2.tokens.reauthAction'))
      if (proof === null) return
      reauthToken = proof.reauthToken
    }
    mint.mutate(
      { ...mintInput(request), reauthToken },
      {
        onSuccess: (minted) => setSecret(minted.token),
        onError: (err) => setError(err.message.length > 0 ? err.message : t('v2.tokens.createFailed')),
      },
    )
  }

  return (
    <KeyboardAwareScrollView contentContainerStyle={{ padding: SPACING.xl, paddingBottom: SPACING['3xl'], gap: SPACING.md }}>
      <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: '600' }}>{t('v2.tokens.newTitle')}</Text>
      {secret === null ? (
        <>
          <TokenMintFields draft={draft} onChange={setDraft} permissions={permissions} cameras={cameras} />
          {draft.permission === 'admin' ? <PanelText>{t('v2.tokens.adminNotice')}</PanelText> : null}
          {problem === 'too-many-cameras' ? <PanelText tone="danger">{t('v2.tokens.tooManyCameras')}</PanelText> : null}
          {error !== null ? <PanelText tone="danger">{error}</PanelText> : null}
          <View style={{ gap: SPACING.sm }}>
            <Button
              label={mint.isPending ? t('v2.tokens.creating') : t('v2.tokens.create')}
              onPress={() => void handleCreate()}
              disabled={problem !== null || mint.isPending}
              testID="token-create"
            />
            <Button label={t('v2.settings.cancel')} kind="secondary" onPress={onClose} />
          </View>
        </>
      ) : (
        <>
          <TokenReveal token={secret} />
          <Button label={t('v2.tokens.done')} onPress={onClose} testID="token-done" />
        </>
      )}
    </KeyboardAwareScrollView>
  )
}
