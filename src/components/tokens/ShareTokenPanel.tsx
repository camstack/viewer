/**
 * The token half of a share dialog (operator-approved, 2026-10-21): the
 * snippet above it carries a `{TOKEN}` placeholder, and this panel decides
 * what goes there —
 *
 *   Create a token   prefilled with the view's cameras; view or view + talk
 *                    and a lifetime. Once minted, the dialog swaps the
 *                    placeholder for the secret (shown this once).
 *   Use an existing  the live tokens whose grants cover EVERY camera of the
 *                    view. The secret is never shown again, so the snippet
 *                    keeps its placeholder and says so.
 *
 * View-only perimeters, never `'*'`: an admin credential does not belong in a
 * link or a dashboard.
 */
import React, { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Check, KeyRound } from '../../lib/icons.js'
import { SegmentedControl, type SegmentOption } from '../ui/SegmentedControl.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { PanelText } from '../../screens/settings/sign-in/form-parts.js'
import { useMe } from '../../data/use-me.js'
import { useMintToken, useTokens } from '../../data/use-sign-in-methods.js'
import {
  mintInput,
  mintProblem,
  ownTokens,
  tokensCovering,
  type AccountToken,
  type ShareViewKind,
} from '../../data/account-tokens.js'
import { TokenMintFields, type TokenDraft } from './TokenMintFields.js'
import { useTokenText } from './token-text.js'
import { Button } from '../ui/Button.js'

/** What the snippet's placeholder resolves to. */
export type ShareTokenChoice =
  | { readonly kind: 'minted'; readonly token: string }
  | { readonly kind: 'existing'; readonly record: AccountToken }

type Mode = 'create' | 'existing'

interface ShareTokenPanelProps {
  readonly kind: ShareViewKind
  readonly deviceIds: readonly number[]
  /** The new token's label, prefilled (the grid's name). */
  readonly defaultLabel: string
  readonly choice: ShareTokenChoice | null
  readonly onChoice: (choice: ShareTokenChoice | null) => void
}

export function ShareTokenPanel({ kind, deviceIds, defaultLabel, choice, onChoice }: ShareTokenPanelProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [mode, setMode] = useState<Mode>('create')
  const modeOptions: readonly SegmentOption<Mode>[] = [
    { value: 'create', label: t('v2.shareToken.create') },
    { value: 'existing', label: t('v2.shareToken.existing') },
  ]
  return (
    <View style={{ gap: SPACING.md }} testID="share-token-panel">
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, fontWeight: '600' }}>{t('v2.shareToken.title')}</Text>
      <SegmentedControl
        options={modeOptions}
        value={mode}
        onChange={(next) => {
          setMode(next)
          onChoice(null)
        }}
      />
      {mode === 'create' ? (
        <CreateShareToken
          kind={kind}
          deviceIds={deviceIds}
          defaultLabel={defaultLabel}
          minted={choice?.kind === 'minted'}
          onMinted={(token) => onChoice({ kind: 'minted', token })}
        />
      ) : (
        <ExistingShareToken
          kind={kind}
          deviceIds={deviceIds}
          selectedId={choice?.kind === 'existing' ? choice.record.id : null}
          onSelect={(record) => onChoice({ kind: 'existing', record })}
        />
      )}
    </View>
  )
}

interface CreateShareTokenProps {
  readonly kind: ShareViewKind
  readonly deviceIds: readonly number[]
  readonly defaultLabel: string
  readonly minted: boolean
  readonly onMinted: (token: string) => void
}

function CreateShareToken({ kind, deviceIds, defaultLabel, minted, onMinted }: CreateShareTokenProps) {
  const { t } = useTranslation()
  const mint = useMintToken()
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<TokenDraft>({
    label: defaultLabel,
    permission: 'view',
    duration: '30d',
    cameras: 'all',
    picked: [],
  })
  const request = { label: draft.label, permission: draft.permission, kind, deviceIds, duration: draft.duration }
  const problem = mintProblem(request)

  if (minted) return <PanelText>{t('v2.shareToken.mintedNotice')}</PanelText>
  return (
    <>
      <PanelText>{t('v2.shareToken.cameras', { count: deviceIds.length })}</PanelText>
      <TokenMintFields draft={draft} onChange={setDraft} permissions={['view', 'view-talk']} />
      {problem === 'too-many-cameras' ? <PanelText tone="danger">{t('v2.tokens.tooManyCameras')}</PanelText> : null}
      {error !== null ? <PanelText tone="danger">{error}</PanelText> : null}
      <Button
        label={mint.isPending ? t('v2.tokens.creating') : t('v2.shareToken.createButton')}
        onPress={() => {
          setError(null)
          mint.mutate(
            { ...mintInput(request), reauthToken: null },
            {
              onSuccess: (out) => onMinted(out.token),
              onError: (err) => setError(err.message.length > 0 ? err.message : t('v2.tokens.createFailed')),
            },
          )
        }}
        disabled={problem !== null || mint.isPending}
        testID="share-token-create"
      />
    </>
  )
}

interface ExistingShareTokenProps {
  readonly kind: ShareViewKind
  readonly deviceIds: readonly number[]
  readonly selectedId: string | null
  readonly onSelect: (record: AccountToken) => void
}

function ExistingShareToken({ kind, deviceIds, selectedId, onSelect }: ExistingShareTokenProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const text = useTokenText()
  const { data: me } = useMe()
  const tokens = useTokens()
  const [now] = useState(Date.now)
  if (tokens.isPending || me === undefined) return <PanelText>{t('v2.tokens.loading')}</PanelText>
  if (tokens.isError || tokens.data === null || tokens.data === undefined) {
    return <PanelText tone="danger">{t('v2.tokens.loadFailed')}</PanelText>
  }
  const covering = tokensCovering(ownTokens(tokens.data, me.id), kind, deviceIds, now)
  if (covering.length === 0) return <PanelText>{t('v2.shareToken.noneCovering')}</PanelText>
  return (
    <>
      <View style={{ borderColor: colors.border, borderWidth: 1, borderRadius: RADIUS.md, overflow: 'hidden' }}>
        {covering.map((token, i) => {
          const on = token.id === selectedId
          return (
            <Pressable
              key={token.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={token.label}
              onPress={() => onSelect(token)}
              testID={`share-token-existing-${token.id}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: SPACING.md,
                padding: SPACING.md,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: colors.borderSubtle,
                backgroundColor: pressed ? colors.surfaceHover : colors.surface,
              })}
            >
              {on ? <Check size={16} color={colors.primary} /> : <KeyRound size={16} color={colors.foregroundMuted} />}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '500' }} numberOfLines={1}>
                  {token.label}
                </Text>
                <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }} numberOfLines={1}>
                  {`${text.scopes(token)} · ${text.expiry(token, now)}`}
                </Text>
              </View>
            </Pressable>
          )
        })}
      </View>
      {selectedId !== null ? <PanelText>{t('v2.shareToken.existingNotice')}</PanelText> : null}
    </>
  )
}
