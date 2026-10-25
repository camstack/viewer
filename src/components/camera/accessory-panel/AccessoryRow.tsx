/**
 * AccessoryRow — one device of the camera accessory panel.
 *
 * VIEW: icon + name + location caption + the registry-picked control, exactly
 * the row `DevicesPanel` drew. EDIT: the same identity, but the control gives
 * way to the local operations — tap the icon to change it, TYPE IN the name to
 * rename, ↑/↓ to reorder, eye to hide or show, and for a LOCAL addition a
 * bin to remove it. A server-linked device has no bin: the viewer does not
 * write the hub's link set, it can only hide the row here.
 *
 * ## The rename had no affordance, and the docblock above was the only place
 * ## it existed
 *
 * *"non riesco però a cambiare il nome locale"* — the operator, 2026-09-23,
 * from a panel where he had already found the icon picker and the reorder
 * arrows. Both of those are DRAWN as controls: the icon wears a dashed
 * primary border in edit mode, the arrows and the eye are round buttons. The
 * name was `{ flex: 1, gap: 2 }` and nothing else — a `Pressable` that looks
 * exactly like the same text in view mode. Four visible affordances and one
 * invisible, and the invisible one was the rename.
 *
 * The line above ("tap the name to rename") had said so since the row was
 * written, which is the shape CLAUDE.md warns about: a paragraph describing a
 * design the pixels do not implement reads as verification of it.
 *
 * {@link ACCESSORY_NAME_EDIT_AFFORDANCE} is the fix, and it borrows the
 * icon's vocabulary rather than inventing a second one — dashed, primary,
 * only in edit mode. Under the name alone, not around the identity block: the
 * caption line is not editable and boxing it would say it was.
 *
 * ## …and the door the signpost pointed at was a trap
 *
 * *"Il rename dei devices blocca la ui, non si vede nulla ma blocca la
 * interfaccia"* — the operator, hours later the same day. Tapping the name
 * opened `usePrompt`, whose dialog is a `<Modal>` the ROOT `ConfirmProvider`
 * renders; two of the three hosts of this panel (`CameraControlsOverlay`, the
 * wall's sheet) are themselves `<Modal>`s, and on iOS the root view
 * controller cannot present a second modal over one it is already presenting.
 * Nothing is drawn and the awaited promise never settles. Exactly the defect
 * `events/track/__tests__/track-detail-modal-dialogs.spec.ts` records for
 * `TrackDetailModal` on 2026-09-06.
 *
 * The name is now an inline `TextInput`, committed on blur or submit — the
 * mechanism `CamerasManageScreen` has always used for the same job, named by
 * the operator himself. There is no dialog left to be refused, from any host,
 * on any platform. The affordance stays, moved onto the FIELD it now marks:
 * a dashed underline under a signpost to a door that no longer existed would
 * be worse than none at all.
 */
import React, { memo, useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { ArrowDown, ArrowUp, Eye, EyeOff, Trash2 } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { hapticTap } from '../../../lib/haptics.js'
import type { AccessoryPanelRow } from '../../../accessories/accessory-panel-rows.js'
import { useTimelineScale } from '../theater/TimelineScaleProvider.js'
import { AccessoryControl } from '../accessory-controls/AccessoryControl.js'
import { CatalogIcon } from '../../CatalogIcon.js'

export interface AccessoryRowProps {
  readonly row: AccessoryPanelRow
  readonly editing: boolean
  readonly first: boolean
  readonly last: boolean
  /** Commit a new LOCAL name. An empty string clears the override — the row
   *  goes back to the hub's name. Synchronous on purpose: this used to await a
   *  dialog, and the dialog is what hung. */
  readonly onRename: (row: AccessoryPanelRow, name: string) => void
  readonly onPickIcon: (row: AccessoryPanelRow) => void
  readonly onMove: (row: AccessoryPanelRow, delta: -1 | 1) => void
  readonly onToggleHidden: (row: AccessoryPanelRow) => void
  readonly onRemove: (row: AccessoryPanelRow) => void
}

const ICON_SIZE = 18

/**
 * What makes the name look editable, in EDIT mode only.
 *
 * Exported so the rule can be asserted rather than eyeballed: a style that
 * only exists inside a render is a style a refactor can quietly flatten, and
 * this one already went missing once — see the module docblock.
 *
 * Deliberately the icon's own language (dashed, 1 px, the primary colour, the
 * caller supplies `borderBottomColor`), so the row has ONE way of saying
 * "this is a control" rather than two. An underline rather than a box because
 * the identity block carries a caption line that is not editable, and the
 * underline sits above it, never around it.
 *
 * `stretch`, not `flex-start`: it underlines a `TextInput` now, and a field
 * only as wide as the text already in it is a field that is hard to tap and
 * hard to type in. It spans the name column and stops there — the caption
 * below is still outside it.
 */
export const ACCESSORY_NAME_EDIT_AFFORDANCE = {
  borderBottomWidth: 1,
  borderStyle: 'dashed',
  alignSelf: 'stretch',
  paddingBottom: 1,
} as const

export const AccessoryRow = memo(function AccessoryRow({
  row,
  editing,
  first,
  last,
  onRename,
  onPickIcon,
  onMove,
  onToggleHidden,
  onRemove,
}: AccessoryRowProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ui = useTimelineScale()
  const muted = row.hidden || !row.device.online
  const accent = muted ? colors.foregroundSubtle : colors.primary
  const nameColor = row.hidden ? colors.foregroundSubtle : colors.foreground
  const vars = { device: row.label }

  // The field's own text while it is being typed. Local so a keystroke does
  // not write the store, and re-seeded whenever the row's label changes from
  // OUTSIDE — including the label falling back to the hub's name after the
  // operator empties the field. Same discipline as `CamerasManageScreen`.
  //
  // Re-seeded DURING RENDER rather than from an effect. An effect would show
  // the stale draft for one frame and, on this codebase's React Compiler
  // lint, is an error (`react-hooks/set-state-in-effect`); the render-phase
  // reset is React's own documented way to adjust state when a prop changes,
  // and it is what `ConfirmProvider` already does for the same job.
  const [draft, setDraft] = useState(row.label)
  const [seededFrom, setSeededFrom] = useState(row.label)
  if (seededFrom !== row.label) {
    setSeededFrom(row.label)
    setDraft(row.label)
  }

  const commit = useCallback((): void => {
    if (draft !== row.label) onRename(row, draft)
  }, [draft, row, onRename])

  const caption =
    row.device.location !== null || row.origin === 'local' || row.hidden ? (
      <Text
        style={[styles.caption, { fontSize: ui.font.xs, color: colors.foregroundSubtle }]}
        numberOfLines={1}
      >
        {[
          row.device.location,
          row.origin === 'local' ? t('v2.accessoryPanel.localBadge') : null,
          row.hidden ? t('v2.accessoryPanel.hiddenBadge') : null,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')}
      </Text>
    ) : null

  if (!editing) {
    return (
      <View style={[styles.row, { borderBottomColor: colors.borderSubtle }]}>
        <View style={[styles.iconWrap, { backgroundColor: colors.backgroundElevated }]}>
          <CatalogIcon iconKey={row.iconKey} size={ICON_SIZE} color={accent} />
        </View>
        <View style={styles.label}>
          <Text style={[styles.name, { fontSize: ui.font.sm, color: nameColor }]} numberOfLines={1}>
            {row.label}
          </Text>
          {caption}
        </View>
        <View style={styles.control}>
          <AccessoryControl device={row.device} />
        </View>
      </View>
    )
  }

  return (
    <View style={[styles.row, { borderBottomColor: colors.borderSubtle }]}>
      <Pressable
        onPress={() => {
          hapticTap()
          onPickIcon(row)
        }}
        accessibilityRole="button"
        accessibilityLabel={t('v2.accessoryPanel.icon', vars)}
        style={[styles.iconWrap, styles.iconEditable, { backgroundColor: colors.backgroundElevated, borderColor: colors.primary }]}
      >
        <CatalogIcon iconKey={row.iconKey} size={ICON_SIZE} color={accent} />
      </Pressable>
      <View style={styles.label}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={commit}
          onSubmitEditing={commit}
          returnKeyType="done"
          // The hub's own name, so an empty field SHOWS what it falls back to
          // rather than asking the operator to remember it.
          placeholder={row.device.name}
          placeholderTextColor={colors.foregroundSubtle}
          selectTextOnFocus
          accessibilityLabel={t('v2.accessoryPanel.rename', vars)}
          style={[
            styles.name,
            styles.nameInput,
            { fontSize: ui.font.sm, color: nameColor },
            { ...ACCESSORY_NAME_EDIT_AFFORDANCE, borderBottomColor: colors.primary },
          ]}
        />
        {caption}
      </View>
      <View style={styles.editActions}>
        <EditButton
          icon={ArrowUp}
          label={t('v2.accessoryPanel.moveUp', vars)}
          disabled={first}
          onPress={() => onMove(row, -1)}
        />
        <EditButton
          icon={ArrowDown}
          label={t('v2.accessoryPanel.moveDown', vars)}
          disabled={last}
          onPress={() => onMove(row, 1)}
        />
        <EditButton
          icon={row.hidden ? Eye : EyeOff}
          label={row.hidden ? t('v2.accessoryPanel.show', vars) : t('v2.accessoryPanel.hide', vars)}
          onPress={() => onToggleHidden(row)}
        />
        {row.origin === 'local' ? (
          <EditButton
            icon={Trash2}
            label={t('v2.accessoryPanel.remove', vars)}
            tint={colors.danger}
            onPress={() => onRemove(row)}
          />
        ) : null}
      </View>
    </View>
  )
})

interface EditButtonProps {
  readonly icon: React.ComponentType<{ readonly size: number; readonly color: string }>
  readonly label: string
  readonly disabled?: boolean
  readonly tint?: string
  readonly onPress: () => void
}

function EditButton({ icon: Icon, label, disabled = false, tint, onPress }: EditButtonProps): React.JSX.Element {
  const { colors } = useTheme()
  const color = disabled ? colors.foregroundDisabled : (tint ?? colors.foregroundMuted)
  return (
    <Pressable
      onPress={() => {
        hapticTap()
        onPress()
      }}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[styles.editButton, { backgroundColor: colors.surface }]}
    >
      <Icon size={16} color={color} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEditable: { borderWidth: 1, borderStyle: 'dashed' },
  label: { flex: 1, gap: 2 },
  // Flush with the row: the dashed underline is the only chrome the field
  // wears, so a box or a tall inset would make it a second vocabulary. The
  // width comes from the affordance's `stretch`, not from a second rule.
  nameInput: { paddingVertical: 0 },
  name: { fontSize: 14, fontWeight: '500' },
  caption: { fontSize: 11 },
  control: { flexShrink: 0 },
  editActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexShrink: 0 },
  editButton: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
})
