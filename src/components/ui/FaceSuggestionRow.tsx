/**
 * FaceSuggestionRow — the "the recognizer THINKS this is <Name>, but wasn't sure
 * enough to auto-assign" affordance. The server populates `suggestedIdentityId`
 * + `suggestedMatchScore` (a plausible match — band ~0.50–0.62, or a good score
 * on a small face) WITHOUT assigning, leaving `recognizedIdentityId` unset. This
 * row surfaces that guess so the operator can:
 *   • CONFERMA → assign the suggested identity via the SAME `assignFace` path as
 *     a manual pick (the caller wires `onConfirm` to its assign mutation);
 *   • IGNORA → dismiss it. The dismissal is DEVICE-LOCAL (persisted per faceId in
 *     `face-suggestion-dismiss-store`) so it survives navigation/restart on this
 *     device — a cross-device dismiss needs a future server cap method.
 *
 * Self-hides via `shouldShowSuggestion` (no linked person, a suggested id, not
 * locally dismissed) so callers drop it in unconditionally, exactly like
 * `FaceConfidenceBadge`. The visibility predicate + name resolution are pure and
 * unit-tested in `data/__tests__/face-suggestion.spec.ts`.
 */
import React, { memo, useCallback, useEffect } from 'react'
import { ActivityIndicator, View, Text, Pressable, StyleSheet } from 'react-native'
import { Sparkles, Check, X } from '../../lib/icons.js'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import { FaceConfidenceBadge } from './FaceConfidenceBadge.js'
import {
  shouldShowSuggestion,
  resolveSuggestedName,
  type SuggestionIdentity,
} from '../../data/face-suggestion.js'
import { useFaceSuggestionDismissStore } from '../../store/face-suggestion-dismiss-store.js'

export interface FaceSuggestionRowProps {
  readonly faceId: string
  /** The face already links to a person (auto/manual) — suppresses the row. */
  readonly hasPerson: boolean
  /** Server's suggested identity id; `undefined` ⇒ no suggestion → hidden. */
  readonly suggestedIdentityId: string | undefined
  /** Plausible-match score 0..1 for the score pill. */
  readonly suggestedMatchScore: number | undefined
  /** Loaded identities (the assign flow already fetches these) for name lookup. */
  readonly identities: readonly SuggestionIdentity[]
  /** Assign the suggested identity — the SAME assignFace path as a manual pick. */
  readonly onConfirm: (identityId: string) => void
  /** Disable the actions while a sibling mutation is in-flight. */
  readonly busy?: boolean
  /** The CONFIRM's own assign is the mutation in flight — its check becomes an
   *  inline spinner (the app's pending idiom) instead of merely dimming. */
  readonly pending?: boolean
}

/** Suggested-identity confirm/dismiss row. Self-hides when there's nothing to
 *  suggest or the operator dismissed this face. */
export const FaceSuggestionRow = memo(function FaceSuggestionRow({
  faceId,
  hasPerson,
  suggestedIdentityId,
  suggestedMatchScore,
  identities,
  onConfirm,
  busy = false,
  pending = false,
}: FaceSuggestionRowProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const dismissedFaceIds = useFaceSuggestionDismissStore((s) => s.dismissed)
  const dismiss = useFaceSuggestionDismissStore((s) => s.dismiss)
  const hydrate = useFaceSuggestionDismissStore((s) => s.hydrate)

  // Load persisted dismissals once (idempotent — guards on `hydrated`), so a
  // previously-dismissed suggestion stays hidden across restart.
  useEffect(() => { void hydrate() }, [hydrate])

  const visible = shouldShowSuggestion({ hasPerson, suggestedIdentityId, dismissedFaceIds, faceId })

  const handleConfirm = useCallback(() => {
    if (busy || suggestedIdentityId === undefined) return
    onConfirm(suggestedIdentityId)
  }, [busy, suggestedIdentityId, onConfirm])

  const handleDismiss = useCallback(() => {
    dismiss(faceId)
  }, [dismiss, faceId])

  // The predicate guarantees `suggestedIdentityId` is a non-empty string when
  // visible; the explicit guard also narrows it for the handlers/name lookup.
  if (!visible || suggestedIdentityId === undefined) return null

  const name = resolveSuggestedName(identities, suggestedIdentityId, t('v2.tracks.suggestedUnknown'))

  return (
    <View style={[styles.row, { backgroundColor: `${colors.warning}18` }]}>
      <Sparkles size={13} color={colors.warning} />
      <Text numberOfLines={1} style={[styles.label, { color: colors.foreground }]}>
        <Text style={{ color: colors.foregroundMuted }}>{t('v2.tracks.suggested')}: </Text>
        {name}
      </Text>
      {/* Reuse the confidence pill/tones, forced to medium/amber — a suggested
          score is below the auto-assign band and would otherwise read danger. */}
      <FaceConfidenceBadge score={suggestedMatchScore} px={undefined} tone="medium" />
      <Pressable
        onPress={handleConfirm}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('v2.tracks.suggestedConfirm')}
        accessibilityState={{ disabled: busy, busy: pending }}
        style={[styles.confirmBtn, { backgroundColor: colors.primary, opacity: busy && !pending ? 0.5 : 1 }]}
      >
        {pending ? (
          <ActivityIndicator size="small" color={colors.primaryForeground} />
        ) : (
          <Check size={13} color={colors.primaryForeground} />
        )}
        <Text style={[styles.confirmText, { color: colors.primaryForeground }]}>
          {t('v2.tracks.suggestedConfirm')}
        </Text>
      </Pressable>
      <Pressable
        onPress={handleDismiss}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('v2.tracks.suggestedDismiss')}
        style={[styles.dismissBtn, { backgroundColor: colors.surface, opacity: busy ? 0.5 : 1 }]}
      >
        <X size={13} color={colors.foregroundMuted} />
      </Pressable>
    </View>
  )
})

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
  },
  label: { flex: 1, fontSize: 13, fontWeight: '600' },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
  },
  confirmText: { fontSize: 12, fontWeight: '700' },
  dismissBtn: {
    width: 26,
    height: 26,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
