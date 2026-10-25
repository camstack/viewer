/**
 * FaceAssignPanel — inline face-identity management for the active detection.
 *
 * Shows:
 *   - Current identity label ("Unknown" if unassigned, or the identity name).
 *   - "Assign to person" button → bottom sheet listing known identities +
 *     a "Create new person" flow (text input → createIdentity → assignFace).
 *   - "Dissociate" button (only when already assigned/recognized).
 *
 * Renders nothing when there is no `trackId` on the active detection.
 * Never throws; errors show as inline text (matching the existing quiet-log
 * pattern used throughout the theater detail UI).
 */

import React, { memo, useCallback, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  FlatList,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  type ListRenderItemInfo,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { UserPlus, UserX, Users, ChevronRight, X, Plus, Check } from '../../../../lib/icons.js'
import { useTheme } from '../../../../theme/theme-provider.js'
import { useConfirm } from '../../../ui/confirm.js'
import { RADIUS, SPACING } from '../../../../theme/tokens.js'
import { SheetModal } from '../../../ui/SheetModal.js'
import { useFaceInfo, type IdentityInfo } from './use-face-info.js'
import { faceHasPerson } from '../../../../data/use-face-gallery.js'
import { FaceConfidenceBadge } from '../../../ui/FaceConfidenceBadge.js'
import { FaceSuggestionRow } from '../../../ui/FaceSuggestionRow.js'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface FaceAssignPanelProps {
  readonly deviceId: number
  readonly trackId: string | undefined
}

// ─── Sub-component: identity picker sheet ────────────────────────────────────

interface IdentityPickerProps {
  readonly identities: IdentityInfo[]
  readonly mutating: boolean
  readonly onPick: (identityId: string) => void
  readonly onCreate: (name: string) => void
  readonly onClose: () => void
}

const IdentityPicker = memo(function IdentityPicker({
  identities,
  mutating,
  onPick,
  onCreate,
  onClose,
}: IdentityPickerProps) {
  const { colors } = useTheme()
  const [newName, setNewName] = useState('')
  const [showInput, setShowInput] = useState(false)

  const handleCreate = useCallback(() => {
    const trimmed = newName.trim()
    if (trimmed.length === 0) return
    onCreate(trimmed)
  }, [newName, onCreate])

  const renderIdentity = useCallback(({ item }: ListRenderItemInfo<IdentityInfo>) => (
    <Pressable
      onPress={() => { onPick(item.id) }}
      disabled={mutating}
      style={({ pressed }) => [
        styles.pickerRow,
        { borderColor: colors.border, opacity: mutating ? 0.5 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.pickerName, { color: colors.foreground }]}>{item.name}</Text>
      <Text style={[styles.pickerCount, { color: colors.foregroundMuted }]}>{item.sampleCount} samples</Text>
      <ChevronRight size={16} color={colors.foregroundSubtle} />
    </Pressable>
  ), [colors, mutating, onPick])

  return (
    <View style={[styles.sheet, { backgroundColor: colors.backgroundElevated }]}>
      {/* Sheet header */}
      <View style={[styles.sheetHeader, { borderColor: colors.border }]}>
        <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Assign to person</Text>
        <Pressable onPress={onClose} hitSlop={10} style={[styles.iconBtn, { backgroundColor: colors.surface }]}>
          <X size={18} color={colors.foreground} />
        </Pressable>
      </View>

      {/* Identity list */}
      <FlatList
        data={identities}
        keyExtractor={(item) => item.id}
        renderItem={renderIdentity}
        style={styles.pickerList}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: colors.foregroundMuted }]}>No identities yet</Text>
        }
      />

      {/* Create new person */}
      {showInput ? (
        <View style={[styles.createRow, { borderColor: colors.border }]}>
          <TextInput
            style={[styles.nameInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
            placeholder="Person name…"
            placeholderTextColor={colors.foregroundSubtle}
            value={newName}
            onChangeText={setNewName}
            autoFocus
            editable={!mutating}
            returnKeyType="done"
            onSubmitEditing={handleCreate}
          />
          <Pressable
            onPress={handleCreate}
            disabled={mutating || newName.trim().length === 0}
            style={[styles.confirmBtn, { backgroundColor: colors.primary, opacity: mutating || newName.trim().length === 0 ? 0.5 : 1 }]}
          >
            {mutating ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Check size={16} color={colors.primaryForeground} />
            )}
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => { setShowInput(true) }}
          disabled={mutating}
          style={[styles.createBtn, { borderColor: colors.border, opacity: mutating ? 0.5 : 1 }]}
        >
          <Plus size={16} color={colors.primary} />
          <Text style={[styles.createBtnText, { color: colors.primary }]}>Create new person</Text>
        </Pressable>
      )}
    </View>
  )
})

// ─── Main panel ───────────────────────────────────────────────────────────────

export const FaceAssignPanel = memo(function FaceAssignPanel({
  deviceId,
  trackId,
}: FaceAssignPanelProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const { faceInfo, identities, loading, mutating, error, assign, unassign, unassignAll, createAndAssign, clearError } =
    useFaceInfo(deviceId, trackId)
  const [pickerVisible, setPickerVisible] = useState(false)

  const handlePick = useCallback(async (identityId: string) => {
    if (!faceInfo) return
    setPickerVisible(false)
    await assign(faceInfo.faceId, identityId)
  }, [faceInfo, assign])

  const handleCreate = useCallback(async (name: string) => {
    if (!faceInfo) return
    setPickerVisible(false)
    await createAndAssign(faceInfo.faceId, name)
  }, [faceInfo, createAndAssign])

  const handleUnassign = useCallback(async () => {
    if (!faceInfo) return
    await unassign(faceInfo.faceId)
  }, [faceInfo, unassign])

  // Disassociate this person from EVERY event (not just this face). Confirmed —
  // destructive. The identity is preserved; all its faces return to Unknown.
  const confirmUnassignAll = useCallback(() => {
    const identityId = faceInfo?.recognizedIdentityId
    if (identityId === undefined) return
    void (async (): Promise<void> => {
      const ok = await confirm({
        title: t('v2.tracks.removePersonAllConfirmTitle'),
        message: t('v2.tracks.removePersonAllConfirmBody'),
        confirmLabel: t('v2.tracks.removePersonAll'),
        cancelLabel: t('v2.settings.cancel'),
        destructive: true,
      })
      if (!ok) return
      await unassignAll(identityId)
    })()
  }, [faceInfo, unassignAll, t, confirm])

  // Don't render if no trackId
  if (!trackId) return null
  // Don't render while loading AND no prior data
  if (loading && faceInfo === null && identities.length === 0) return null

  const identityLabel = faceInfo?.identityName ?? (faceInfo ? 'Unknown' : 'No face enrolled')
  // A face is "linked to a person" whether the recognizer AUTO-assigned it
  // (`assigned` false, recognizedIdentityId set) or the operator did (`assigned`
  // true). The dissociate affordances gate on THIS, not `assigned` — otherwise
  // pre-assigned faces can't be detached directly.
  const hasPerson = faceInfo !== null && faceHasPerson(faceInfo.recognizedIdentityId)

  return (
    <View style={[styles.panel, { borderColor: colors.border }]}>
      <View style={styles.panelRow}>
        <UserPlus size={16} color={colors.foregroundMuted} />
        <Text style={[styles.panelLabel, { color: colors.foregroundMuted }]}>Face</Text>
        <Text style={[styles.identityLabel, { color: colors.foreground }]} numberOfLines={1}>
          {loading ? '…' : identityLabel}
        </Text>

        {/* Auto-assigned (recognizer pick, not manual) → confidence badge. Manual
            / legacy rows carry no score and the badge self-hides. */}
        {hasPerson && faceInfo !== null && !faceInfo.assigned ? (
          <FaceConfidenceBadge score={faceInfo.bestMatchScore} px={faceInfo.nativeFaceShortSidePx} />
        ) : null}

        {/* Actions */}
        <View style={styles.actions}>
          {faceInfo !== null ? (
            <Pressable
              onPress={() => { setPickerVisible(true) }}
              disabled={mutating}
              style={[styles.actionBtn, { backgroundColor: colors.surface }]}
            >
              {/* The picker closes BEFORE the assign round trip runs, so this
                  button is the only thing left on screen that can say "your
                  pick is being written" — dim-only read as nothing happening
                  (the "no loader" operator report). */}
              {mutating ? (
                <ActivityIndicator size="small" color={colors.foreground} />
              ) : (
                <Text style={[styles.actionText, { color: colors.foreground }]}>Assign</Text>
              )}
            </Pressable>
          ) : null}

          {hasPerson ? (
            <Pressable
              onPress={() => { void handleUnassign() }}
              disabled={mutating}
              style={[styles.actionBtn, { backgroundColor: colors.surface, opacity: mutating ? 0.5 : 1 }]}
            >
              {mutating ? (
                <ActivityIndicator size="small" color={colors.danger} />
              ) : (
                <UserX size={14} color={colors.danger} />
              )}
            </Pressable>
          ) : null}

          {/* Disassociate this person from ALL events (detach every linked face). */}
          {hasPerson && faceInfo?.recognizedIdentityId !== undefined ? (
            <Pressable
              onPress={confirmUnassignAll}
              disabled={mutating}
              accessibilityRole="button"
              accessibilityLabel={t('v2.tracks.removePersonAll')}
              style={[styles.actionBtn, { backgroundColor: colors.surface, opacity: mutating ? 0.5 : 1 }]}
            >
              <Users size={14} color={colors.danger} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Recognizer suggested a person but wasn't confident enough to assign →
          confirm (same assignFace as a manual pick) or dismiss (device-local).
          Self-hides when the face has a person / no suggestion / dismissed. */}
      {faceInfo !== null ? (
        <FaceSuggestionRow
          faceId={faceInfo.faceId}
          hasPerson={hasPerson}
          suggestedIdentityId={faceInfo.suggestedIdentityId}
          suggestedMatchScore={faceInfo.suggestedMatchScore}
          identities={identities}
          onConfirm={(identityId) => { void assign(faceInfo.faceId, identityId) }}
          busy={mutating}
          pending={mutating}
        />
      ) : null}

      {/* Inline error */}
      {error !== null ? (
        <Pressable onPress={clearError} style={styles.errorRow}>
          <Text style={[styles.errorText, { color: colors.danger }]} numberOfLines={2}>
            {error} (tap to dismiss)
          </Text>
        </Pressable>
      ) : null}

      {/* Identity picker modal */}
      <SheetModal
        visible={pickerVisible}
        onClose={() => { setPickerVisible(false) }}
        scrimColor="#00000080"
        sheetStyle={styles.sheetAnchor}
      >
        <IdentityPicker
          identities={identities}
          mutating={mutating}
          onPick={(id) => { void handlePick(id) }}
          onCreate={(name) => { void handleCreate(name) }}
          onClose={() => { setPickerVisible(false) }}
        />
      </SheetModal>
    </View>
  )
})

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  panel: { marginTop: SPACING.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: SPACING.sm },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  panelLabel: { fontSize: 12, fontWeight: '600' },
  identityLabel: { flex: 1, fontSize: 13 },
  actions: { flexDirection: 'row', gap: SPACING.xs },
  actionBtn: { paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs, borderRadius: RADIUS.sm, flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  actionText: { fontSize: 12, fontWeight: '600' },
  errorRow: { marginTop: SPACING.xs },
  errorText: { fontSize: 11 },

  // Identity picker sheet
  sheetAnchor: { maxHeight: '60%' },
  sheet: { borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, paddingBottom: SPACING['2xl'] },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.xl, paddingVertical: SPACING.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 16, fontWeight: '700' },
  iconBtn: { width: 32, height: 32, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  pickerList: { flexGrow: 0, maxHeight: 280 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.xl, paddingVertical: SPACING.lg, borderBottomWidth: StyleSheet.hairlineWidth, gap: SPACING.sm },
  pickerName: { flex: 1, fontSize: 15 },
  pickerCount: { fontSize: 12 },
  emptyText: { textAlign: 'center', paddingVertical: SPACING.xl, fontSize: 13 },
  createRow: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.xl, paddingTop: SPACING.md, borderTopWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  nameInput: { flex: 1, height: 40, borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, fontSize: 15 },
  confirmBtn: { width: 40, height: 40, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.lg, borderTopWidth: StyleSheet.hairlineWidth },
  createBtnText: { fontSize: 15, fontWeight: '600' },
})
