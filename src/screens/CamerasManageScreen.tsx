/**
 * CamerasManageScreen — local camera management (srcV2).
 *
 * Lists ALL cameras (including hidden) and lets the user, purely client-side:
 *   • rename a camera (TextInput → `setLocalName`, committed on blur/submit),
 *   • hide/show a camera (Switch → `setHidden`),
 *   • ARRANGE the list by dragging, behind the pencil in the header corner.
 *
 * Everything here is LOCAL. Until 2026-09-22 an admin's row also carried a
 * chain that edited the hub's LINKED DEVICES from here, through
 * `applyDeviceSettingsPatch`; that made the viewer a second authority over a
 * set admin-ui owns, and it is gone. A camera's companion devices are
 * customised on the camera's own accessory panel (locally, for every
 * session) and the hub's links are edited in admin-ui only.
 *
 * THE LIST IS NOT DRAGGABLE BY DEFAULT. It used to be: every row carried a live
 * drag handle, so a long-press anywhere near it rearranged the operator's camera
 * list and persisted the result on the spot, with nothing to undo it. One extra
 * tap is cheaper than that. The pencil (`arrange`) opens a session, the rows
 * turn read-only and grow a grip, every drag lands in the session DRAFT, and
 * only ✓ writes it through `setOrder`. ✕ restores the order the session STARTED
 * from — see `cameras-arrange.ts` for why that is the baseline and not the
 * persisted prefs.
 *
 * The order itself is LOCAL to this device (`camera-prefs-store.order`,
 * AsyncStorage); nothing here is sent to the hub. What that order does when the
 * hub's device set has moved under it is `data/device-order.ts`.
 *
 * Mirrors V1's settings/cameras screens, re-themed to camstack + lucide. Pushed
 * over the tabs from the (app) group; reached via `/settings/cameras`. The
 * single-column `DraggableFlatList` (numColumns breaks drag on iOS) keeps the
 * drag grab on a dedicated handle so the inline TextInput stays editable.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// ui-check-ok: inline hide switch in a draggable row; a ToggleRow is a layout change (pre-existing)
import {
  View,
  Text,
  TextInput,
  Switch,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import DraggableFlatList, {
  ScaleDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist'
import { GripVertical, EyeOff, Pencil, Check, X } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING, RADIUS, type ColorTokens } from '../theme/tokens.js'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { hapticTap } from '../lib/haptics.js'
import { ScreenHeader, type HeaderAction } from '../components/ScreenHeader.js'
import { useAllCameras, type CameraInfo } from '../data/use-cameras.js'
import { applySavedOrder } from '../data/device-order.js'
import { useCameraPrefs } from '../data/use-camera-prefs.js'
import { keyboardPaddingStyle } from '../components/ui/keyboard-inset.js'
import { revealScrollerOf, useKeyboardReveal, type RevealScroller } from '../components/ui/KeyboardInset.js'
import {
  applyArrangeDrag,
  arrangeIsDirty,
  beginArrange,
  type ArrangeSession,
} from './cameras-arrange.js'
import {
  CAMERAS_MANAGE_CONTAINER_STYLE,
  CAMERAS_MANAGE_ROW_GAP,
  camerasManageListContentStyle,
} from './cameras-manage-layout.js'

export function CamerasManageScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  // Inline rename: the keyboard must not cover a focused row near the bottom.
  const listRef = useRef<unknown>(null)
  const listScroller = useCallback((): RevealScroller | null => revealScrollerOf(listRef.current), [])
  const setListRef = useCallback((instance: unknown) => {
    listRef.current = instance
  }, [])
  const keyboardReveal = useKeyboardReveal(listScroller)
  const { data: cameras = [], isLoading } = useAllCameras()
  const { setLocalName, setHidden, setOrder } = useCameraPrefs()

  // Local optimistic order — `useAllCameras` already returns the persisted order
  // applied, so we seed from it and re-sync when membership/order changes.
  const [data, setData] = useState<readonly CameraInfo[]>(cameras)
  // The open arrange session, or null when the list is just a list.
  const [session, setSession] = useState<ArrangeSession | null>(null)
  const arranging = session !== null

  useEffect(() => {
    // A refetch mid-session would wipe the drag the operator is in the middle
    // of. The session owns the order until it is confirmed or cancelled; the
    // next sync happens when it closes (this effect re-runs on `arranging`).
    if (arranging) return
    setData(cameras)
  }, [cameras, arranging])

  const startArrange = useCallback(() => {
    hapticTap()
    setSession(beginArrange(data.map((c) => c.id)))
  }, [data])

  const handleDragEnd = useCallback(
    ({ data: next }: { data: CameraInfo[] }) => {
      // Draft only. Persisting here is what made cancel meaningless.
      setData(next)
      setSession((s) => (s === null ? s : applyArrangeDrag(s, next.map((c) => c.id))))
    },
    [],
  )

  const cancelArrange = useCallback(() => {
    if (session === null) return
    hapticTap()
    // Rebuild the rows in the order the session opened on — its baseline — so
    // an abandoned rearrangement leaves nothing behind, not even on screen.
    setData(applySavedOrder(data, session.baseline))
    setSession(null)
  }, [data, session])

  const confirmArrange = useCallback(() => {
    if (session === null) return
    hapticTap()
    // A confirm that dragged nothing writes nothing: opening and closing the
    // pencil must not stamp today's device set into storage as an arrangement.
    if (arrangeIsDirty(session)) setOrder(session.draft)
    setSession(null)
  }, [session, setOrder])

  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<CameraInfo>) => (
      <ManageRow
        camera={item}
        // Outside a session there is no grab at all — the row cannot be dragged
        // by accident because nothing on it starts a drag.
        drag={arranging ? drag : null}
        isActive={isActive}
        colors={colors}
        onRename={(name) => setLocalName(item.id, name)}
        onToggleHidden={(hidden) => setHidden(item.id, hidden)}
      />
    ),
    [arranging, colors, setLocalName, setHidden],
  )

  // Pencil in the corner to enter; ✕ / ✓ in the same corner to leave. Two
  // separate buttons rather than one toggle: "I am done" and "forget this" are
  // opposite outcomes and must never share a target.
  const headerActions = useMemo<readonly HeaderAction[]>(
    () =>
      arranging
        ? [
            { id: 'cancel', icon: X, label: t('v2.cameras.arrangeCancel'), onPress: cancelArrange },
            { id: 'confirm', icon: Check, label: t('v2.cameras.arrangeConfirm'), onPress: confirmArrange, active: true },
          ]
        : [{ id: 'arrange', icon: Pencil, label: t('v2.cameras.arrangeStart'), onPress: startArrange }],
    [arranging, cancelArrange, confirmArrange, startArrange, t],
  )

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={t('v2.cameras.manage')}
        // While arranging, back IS cancel: leaving the screen with a draft
        // half-applied would be the abandoned-rearrangement bug by another door.
        onBack={arranging ? cancelArrange : () => router.back()}
        actions={cameras.length > 0 ? headerActions : undefined}
        bordered
      />
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : cameras.length === 0 ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 15 }}>{t('v2.cameras.empty')}</Text>
        </View>
      ) : (
        <DraggableFlatList
          data={data as CameraInfo[]}
          keyExtractor={(c) => String(c.id)}
          onDragEnd={handleDragEnd}
          renderItem={renderItem}
          containerStyle={CAMERAS_MANAGE_CONTAINER_STYLE}
          contentContainerStyle={[
            camerasManageListContentStyle(insets.bottom),
            keyboardPaddingStyle(camerasManageListContentStyle(insets.bottom), keyboardReveal.overlap),
          ]}
          activationDistance={12}
          // Keyboard avoidance for inline rename (iOS and Android): the content
          // gains the keyboard's overlap as bottom padding and the focused row
          // is scrolled into view (`useKeyboardReveal`). `keyboardShouldPersistTaps`
          // keeps the drag handle / hide Switch / other rows tappable while an
          // input is focused (no throwaway dismiss tap).
          ref={setListRef}
          onLayout={keyboardReveal.onLayout}
          onScrollOffsetChange={keyboardReveal.onScrollOffset}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          ListHeaderComponent={
            <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>
              {t(arranging ? 'v2.cameras.arrangeHint' : 'v2.cameras.manageHint')}
            </Text>
          }
        />
      )}
    </View>
  )
}

interface ManageRowProps {
  readonly camera: CameraInfo
  /** Starts a drag, or null when the list is not in arrange mode. */
  readonly drag: (() => void) | null
  readonly isActive: boolean
  readonly colors: ColorTokens
  readonly onRename: (name: string) => void
  readonly onToggleHidden: (hidden: boolean) => void
}

/** One camera row. Two faces, because the two jobs conflict: OUTSIDE arrange
 *  mode it is an editable row (inline rename committed on blur/submit, the
 *  original server name as a subtitle when renamed, a hide Switch); INSIDE it
 *  is a read-only row with a grab handle. An editable field under a finger that
 *  is trying to drag serves neither. */
function ManageRow({
  camera,
  drag,
  isActive,
  colors,
  onRename,
  onToggleHidden,
}: ManageRowProps) {
  const { t } = useTranslation()
  // Draft is local so typing does not thrash the store on every keystroke; the
  // edit commits on blur / submit. Reset when the camera's display name changes
  // externally (e.g. clearing the override).
  const [draft, setDraft] = useState(camera.name)
  useEffect(() => {
    setDraft(camera.name)
  }, [camera.name])

  const commit = useCallback(() => {
    if (draft !== camera.name) onRename(draft)
  }, [draft, camera.name, onRename])

  const renamed = camera.name !== camera.originalName
  const arranging = drag !== null

  return (
    <ScaleDecorator>
      <View
        style={[
          styles.row,
          {
            backgroundColor: isActive ? colors.surfaceHover : colors.surface,
            borderColor: isActive ? colors.primary : colors.border,
            opacity: camera.hidden ? 0.55 : 1,
            marginBottom: CAMERAS_MANAGE_ROW_GAP,
          },
        ]}
      >
        {/* Drag grab — dedicated handle so the TextInput stays tappable. Only
            rendered inside a session: no handle, no accidental reorder. */}
        {drag ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('v2.cameras.reorderHandle')}
            onLongPress={drag}
            delayLongPress={150}
            style={styles.handle}
          >
            <GripVertical size={20} color={colors.foregroundMuted} />
          </Pressable>
        ) : null}

        <View style={styles.body}>
          <View style={styles.nameRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: camera.online ? colors.success : colors.foregroundDisabled },
              ]}
            />
            {arranging ? (
              <Text style={[styles.input, { color: colors.foreground }]} numberOfLines={1}>
                {camera.name}
              </Text>
            ) : (
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onBlur={commit}
                onSubmitEditing={commit}
                returnKeyType="done"
                placeholder={camera.originalName}
                placeholderTextColor={colors.foregroundSubtle}
                selectTextOnFocus
                style={[styles.input, { color: colors.foreground }]}
              />
            )}
          </View>
          {renamed ? (
            <Text style={[styles.original, { color: colors.foregroundSubtle }]} numberOfLines={1}>
              {camera.originalName}
            </Text>
          ) : null}
        </View>

        {/* A hidden camera still says so while arranging — the Switch is gone,
            the fact is not. */}
        {camera.hidden ? <EyeOff size={16} color={colors.foregroundMuted} /> : null}

        {arranging ? null : (
          <Switch
            value={!camera.hidden}
            onValueChange={(visible) => onToggleHidden(!visible)}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.backgroundElevated}
            ios_backgroundColor={colors.border}
          />
        )}
      </View>
    </ScaleDecorator>
  )
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING['2xl'] },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: SPACING.sm,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  handle: { paddingVertical: SPACING.sm, paddingRight: SPACING.xs },
  body: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    // Keep the editable area tappable but visually flush with the row.
    paddingVertical: Platform.OS === 'ios' ? SPACING.xs : 0,
  },
  original: { fontSize: 12, marginLeft: 8 + SPACING.md },
})
