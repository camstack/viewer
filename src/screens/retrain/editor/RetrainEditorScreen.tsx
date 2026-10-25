/**
 * RetrainEditorScreen — the full-screen retrain annotation editor for one corpus
 * frame (route `/retrain/[frameId]`), reached from Library -> Retrain.
 *
 * Portrait: the frame fills the screen; the subject list is an in-screen bottom
 * sheet (collapsed = review summary, half = compact list, full = the selected
 * subject's editor). Landscape / wide: the list is a panel on the right.
 *
 * The state machine is the pure `retrain/*` modules (the admin editor's rules):
 * drafts, dismissed proposals, the live review diff, undo, the dirty check. This
 * file wires them to the hub (list, annotations, save with `expectedRevision`)
 * and to the canvas / sheet components. Leaving with unsaved edits asks first
 * (`usePreventRemove`), which covers back, prev / next and the hardware back.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { useTranslation } from 'react-i18next'
import { parseRetrainRevisionConflict } from '@camstack/types/client'
import type { RetrainFrame } from '@camstack/types'
import { ScreenHeader } from '../../../components/ScreenHeader.js'
import { hubImageSource, type HubImageSource } from '../../../components/camera/theater/hub-image-source.js'
import { AnchoredMenu } from '../../../components/ui/AnchoredMenu.js'
import { useConfirm } from '../../../components/ui/confirm.js'
import { SnapSheet } from '../../../components/ui/SnapSheet.js'
import { type SheetSnap, type SnapHeights } from '../../../components/ui/snap-sheet-math.js'
import { useServer } from '../../../app/ServerProvider.js'
import { useConnection } from '../../../connection/ConnectionProvider.js'
import {
  useRetrainAnnotations,
  useRetrainVocabularySource,
  useSaveRetrainAnnotations,
  useSetRetrainFrameComplete,
} from '../../../data/use-retrain.js'
import { useRetrainCorpusFrames } from '../../../data/use-retrain-corpus.js'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  EllipsisVertical,
  Plus,
  Redo2,
  Undo2,
} from '../../../lib/icons.js'
import { displayedImageRect, type NormBox } from '../../../retrain/boxes.js'
import { runGuarded } from '../../../retrain/dirty.js'
import {
  acceptAllDrafts,
  acceptBox,
  addOperatorBox,
  deleteBox,
  markModelError,
  pendingDraftCount,
  seedEditor,
  toSaveDismissed,
  toSavePayload,
  updateBox,
} from '../../../retrain/editor.js'
import { frameNav } from '../../../retrain/frame-nav.js'
import { liveReview } from '../../../retrain/live-review.js'
import { buildRows } from '../../../retrain/rows.js'
import { useEditorSession } from '../../../retrain/use-editor-session.js'
import { annotationsAreValid } from '../../../retrain/validate.js'
import { buildVocabulary } from '../../../retrain/vocabulary.js'
import { IDENTITY_VIEWPORT, centerOnBox, type Size, type Viewport } from '../../../retrain/viewport.js'
import { retrainFrameHref } from '../../../navigation/retrain-routes.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../../theme/tokens.js'
import { RetrainCanvas } from './RetrainCanvas.js'
import { RetrainEditorPanel } from './RetrainEditorPanel.js'
import { RetrainReviewSummary } from './RetrainReviewSummary.js'
import { KeyboardAwareScrollView } from '../../../components/ui/KeyboardInset.js'

export interface RetrainEditorScreenProps {
  readonly frameId: string
  readonly deviceId: number | null
  readonly collectionId: string | null
}

const SHEET_COLLAPSED = 76
const SHEET_HEADER = 40
const SIDE_PANEL_WIDTH = 360
const SAVED_FLASH_MS = 2500
const TOOL = 44

function absoluteUrl(serverUrl: string | null, url: string): string {
  if (/^(https?:|data:)/.test(url) || serverUrl === null || serverUrl === '') return url
  const base = serverUrl.replace(/\/+$/, '')
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`
}

export function RetrainEditorScreen({ frameId, deviceId, collectionId }: RetrainEditorScreenProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const navigation = useNavigation()
  const confirm = useConfirm()
  const { token } = useServer()
  const { controller } = useConnection()

  const corpus = useRetrainCorpusFrames(
    {
      ...(deviceId !== null ? { deviceIds: [deviceId] } : {}),
      ...(collectionId !== null ? { collectionIds: [collectionId] } : {}),
    },
    true,
  )
  const frames = useMemo(() => corpus.data ?? [], [corpus.data])
  const frame: RetrainFrame | undefined = frames.find((f) => f.frameId === frameId)
  const nav = useMemo(() => frameNav(frames.map((f) => f.frameId), frameId), [frames, frameId])
  const stored = useRetrainAnnotations(frameId, null, true)
  const vocabularySource = useRetrainVocabularySource(
    frames.map((f) => f.frameId),
    frames.length > 0,
  )
  const vocabulary = useMemo(() => buildVocabulary(vocabularySource.data ?? []), [vocabularySource.data])
  const save = useSaveRetrainAnnotations()
  const setComplete = useSetRetrainFrameComplete()

  const session = useEditorSession()
  const { editor } = session
  const [viewport, setViewport] = useState<Viewport>(IDENTITY_VIEWPORT)
  const [bodySize, setBodySize] = useState<Size>({ w: 0, h: 0 })
  const [canvasSize, setCanvasSize] = useState<Size>({ w: 0, h: 0 })
  const [snap, setSnap] = useState<SheetSnap>('half')
  const [drawMode, setDrawMode] = useState(false)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [showRemoved, setShowRemoved] = useState(true)
  const [conflict, setConflict] = useState<number | null>(null)
  const [flash, setFlash] = useState<'saved' | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const menuButton = useRef<View>(null)

  // ── Seeding: the editor starts from the SERVER's annotations plus the
  // pipeline's boxes as drafts, minus every proposal already decided. A refetch
  // that lands over unsaved edits never replaces them.
  const seedInputs = useRef({ stored: stored.data, frame })
  seedInputs.current = { stored: stored.data, frame }
  const dirtyRef = useRef(false)
  dirtyRef.current = session.dirty
  const seededFrame = useRef<string | null>(null)
  const forceReseed = useRef(false)
  const frameLoaded = frame !== undefined
  const { reset } = session
  useEffect(() => {
    const same = seededFrame.current === frameId
    if (same && dirtyRef.current && !forceReseed.current) return
    forceReseed.current = false
    seededFrame.current = frameId
    if (!same) {
      setViewport(IDENTITY_VIEWPORT)
      setDrawMode(false)
      setHoverKey(null)
      setConflict(null)
    }
    const { stored: rows, frame: f } = seedInputs.current
    reset(
      seedEditor(
        (rows ?? []).filter((a) => a.mediaKey === frameId),
        f?.pipelineBoxes ?? [],
        f?.dismissed ?? [],
      ),
    )
  }, [frameId, stored.dataUpdatedAt, frameLoaded, reset])

  const review = useMemo(() => liveReview(editor, frame?.pipelineBoxes ?? []), [editor, frame?.pipelineBoxes])
  const rows = useMemo(() => buildRows(editor, review, showRemoved), [editor, review, showRemoved])
  const selectedBox = editor.boxes.find((b) => b.key === editor.selectedKey) ?? null
  const valid = annotationsAreValid(editor.boxes)
  const wide = bodySize.w > bodySize.h && bodySize.w > 0

  const source: HubImageSource | null = useMemo(() => {
    if (frame?.imageUrl === undefined) return null
    const serverUrl = controller.getSystem()?.serverUrl ?? null
    return hubImageSource(absoluteUrl(serverUrl, frame.imageUrl), token)
  }, [frame?.imageUrl, controller, token])
  const imageSize: Size = useMemo(
    () => ({ w: frame?.width ?? 0, h: frame?.height ?? 0 }),
    [frame?.width, frame?.height],
  )

  const heights: SnapHeights = useMemo(
    () => ({
      collapsed: SHEET_COLLAPSED,
      half: Math.round(bodySize.h * 0.42),
      full: Math.round(bodySize.h * 0.9),
    }),
    [bodySize.h],
  )

  // ── Leaving with edits asks first: back, prev / next, the hardware back.
  const leaving = useRef(false)
  useEffect(() => {
    leaving.current = false
  }, [frameId])
  usePreventRemove(session.dirty, ({ data }) => {
    if (leaving.current) {
      navigation.dispatch(data.action)
      return
    }
    void confirm({
      title: t('v2.retrain.editor.unsavedTitle', 'Discard unsaved changes?'),
      message: t(
        'v2.retrain.editor.unsavedBody',
        'This frame has edits that are not saved. Leaving it now loses them.',
      ),
      confirmLabel: t('v2.retrain.editor.discard', 'Discard changes'),
      cancelLabel: t('v2.retrain.editor.keepEditing', 'Keep editing'),
      destructive: true,
    }).then((ok) => {
      if (!ok) return
      leaving.current = true
      navigation.dispatch(data.action)
    })
  })

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }, [router])
  const goTo = useCallback(
    (id: string | null) => {
      if (id !== null) router.replace(retrainFrameHref(id, { deviceId, collectionId }))
    },
    [router, deviceId, collectionId],
  )

  // ── Selection sync, list <-> canvas.
  // The frame fits the area ABOVE the sheet: collapsed -> bigger, half -> smaller.
  // At the full snap (an editor view) the last fit is kept.
  const [fitSnap, setFitSnap] = useState<SheetSnap>('half')
  useEffect(() => {
    if (snap !== 'full') setFitSnap(snap)
  }, [snap])
  const fitInset = wide ? 0 : heights[fitSnap]
  // What the sheet covers of the fitted canvas beyond the fit (full snap only).
  const bottomInset = wide ? 0 : Math.max(0, heights[snap] - fitInset)
  const focusBox = useCallback(
    (bbox: NormBox) => {
      const rect = displayedImageRect(canvasSize.w, canvasSize.h, imageSize.w, imageSize.h)
      if (rect === null) return
      setViewport((vp) => centerOnBox(bbox, vp, canvasSize, rect, bottomInset))
    },
    [canvasSize, imageSize, bottomInset],
  )
  const onSelectFromCanvas = useCallback(
    (key: string | null) => {
      session.select(key)
      if (key !== null) setSnap((s) => (s === 'collapsed' ? 'half' : s))
    },
    [session],
  )
  const onSelectFromList = useCallback(
    (key: string) => {
      if (key === editor.selectedKey) {
        setSnap((s) => (s === 'full' ? 'half' : 'full'))
        return
      }
      session.select(key)
      const box = editor.boxes.find((b) => b.key === key)
      if (box !== undefined) focusBox(box.bbox)
    },
    [editor.selectedKey, editor.boxes, session, focusBox],
  )

  // ── Editing.
  const onEdit = useCallback(
    (key: string, bbox: NormBox) => session.transientApply((s) => updateBox(s, key, { bbox })),
    [session],
  )
  const onDraw = useCallback(
    (bbox: NormBox) => {
      session.apply((s) => addOperatorBox(s, bbox, 'person'))
      setDrawMode(false)
      setSnap('full')
    },
    [session],
  )
  const withSelected = useCallback(
    (change: (key: string) => void) => {
      if (editor.selectedKey !== null) change(editor.selectedKey)
    },
    [editor.selectedKey],
  )

  // ── Save, and the conflict it can be refused with.
  const canSave = session.dirty && valid && frame !== undefined && !saving
  const onSave = useCallback(async () => {
    if (frame === undefined) return
    setSaving(true)
    try {
      await save.mutateAsync({
        deviceId: frame.deviceId,
        ...(frame.trackId !== undefined ? { trackId: frame.trackId } : {}),
        frameId: frame.frameId,
        annotations: toSavePayload(editor),
        dismissed: toSaveDismissed(editor),
        ...(frame.revision !== undefined ? { expectedRevision: frame.revision } : {}),
      })
      forceReseed.current = true
      session.markSaved()
      setConflict(null)
      setSaveFailed(false)
      setFlash('saved')
      await stored.refetch()
    } catch (err: unknown) {
      const refused = parseRetrainRevisionConflict(err instanceof Error ? err.message : '')
      // Keep what the operator did on screen either way; replacing it is theirs to choose.
      if (refused !== null) setConflict(refused.currentRevision)
      else setSaveFailed(true)
    } finally {
      setSaving(false)
    }
  }, [frame, save, editor, session, stored])
  useEffect(() => {
    if (flash === null) return undefined
    const timer = setTimeout(() => setFlash(null), SAVED_FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])
  const onReloadLatest = useCallback(async () => {
    forceReseed.current = true
    setConflict(null)
    await Promise.all([stored.refetch(), corpus.refetch()])
  }, [stored, corpus])

  const toggleComplete = useCallback(() => {
    if (frame === undefined) return
    setComplete.mutate({
      deviceId: frame.deviceId,
      ...(frame.trackId !== undefined ? { trackId: frame.trackId } : {}),
      frameId: frame.frameId,
      complete: frame.complete !== true,
    })
  }, [frame, setComplete])

  const openMenu = useCallback(() => {
    menuButton.current?.measureInWindow((x, y, width, height) =>
      setMenuAnchor({ x, y, width, height }),
    )
  }, [])

  const onBodyLayout = useCallback((e: LayoutChangeEvent) => {
    setBodySize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
  }, [])

  const loading = corpus.isLoading || (frames.length > 0 && frame === undefined && corpus.isFetching)
  const missing = !loading && frame === undefined

  const panel = (
    <RetrainEditorPanel
      rows={rows}
      review={review}
      editor={editor}
      selectedBox={selectedBox}
      vocabulary={vocabulary}
      expanded={wide || snap === 'full'}
      listMode={wide ? 'list' : 'selected'}
      onSelectRow={onSelectFromList}
      onHover={setHoverKey}
      onClass={(macro) => withSelected((k) => session.apply((s) => updateBox(s, k, { macroClass: macro })))}
      onLabel={(label) => withSelected((k) => session.transientApply((s) => updateBox(s, k, { label })))}
      onSubLabel={(subLabel) =>
        withSelected((k) => session.transientApply((s) => updateBox(s, k, { subLabel })))
      }
      onTextFocus={session.beginGesture}
      onTextBlur={session.endGesture}
      onModelError={() => withSelected((k) => session.apply((s) => markModelError(s, k)))}
      onAccept={() => withSelected((k) => session.apply((s) => acceptBox(s, k)))}
      onDelete={() => withSelected((k) => session.apply((s) => deleteBox(s, k)))}
    />
  )

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]} testID="retrain-editor">
      <ScreenHeader
        onBack={goBack}
        title={
          nav.index >= 0
            ? t('v2.retrain.editor.frameOf', 'Frame {{n}}/{{total}}', { n: nav.index + 1, total: nav.total })
            : t('v2.retrain.editor.frame', 'Frame')
        }
        bordered
        actions={[
          {
            id: 'prev',
            icon: ChevronLeft,
            label: t('v2.retrain.editor.prev', 'Previous frame'),
            disabled: nav.prevId === null,
            onPress: () => goTo(nav.prevId),
          },
          {
            id: 'next',
            icon: ChevronRight,
            label: t('v2.retrain.editor.next', 'Next frame'),
            disabled: nav.nextId === null,
            onPress: () => goTo(nav.nextId),
          },
          {
            id: 'more',
            icon: EllipsisVertical,
            label: t('v2.retrain.editor.more', 'More'),
            onPress: openMenu,
            anchorRef: menuButton,
          },
          {
            id: 'save',
            icon: Check,
            label: t('v2.retrain.editor.save', 'Save'),
            onPress: () => void onSave(),
            disabled: !canSave,
            active: canSave,
            testID: 'retrain-save',
          },
        ]}
      />

      {conflict !== null ? (
        <View style={[styles.banner, { backgroundColor: colors.warningFill }]} testID="retrain-conflict">
          <Text style={[styles.bannerText, { color: colors.warningOn }]}>
            {t(
              'v2.retrain.editor.conflict',
              'This frame was changed elsewhere (now at revision {{revision}}). Your edits are not saved.',
              { revision: conflict },
            )}
          </Text>
          <Pressable onPress={() => void onReloadLatest()} accessibilityRole="button" style={styles.bannerButton} hitSlop={8}>
            <Text style={[styles.bannerAction, { color: colors.warningOn }]}>
              {t('v2.retrain.editor.reloadLatest', 'Reload latest')}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {saveFailed ? (
        <View style={[styles.banner, { backgroundColor: colors.dangerFill }]} testID="retrain-save-failed">
          <Text style={[styles.bannerText, { color: colors.dangerOn }]}>
            {t('v2.retrain.editor.saveFailed', 'Could not save. Your edits are still here; try again.')}
          </Text>
        </View>
      ) : null}
      {flash === 'saved' ? (
        <View style={[styles.banner, { backgroundColor: colors.successFill }]}>
          <Text style={[styles.bannerText, { color: colors.successOn }]}>
            {pendingDraftCount(editor) > 0
              ? t('v2.retrain.editor.savedDrafts', 'Saved. Unconfirmed drafts were not saved.')
              : t('v2.retrain.editor.saved', 'Saved.')}
          </Text>
        </View>
      ) : null}

      <View style={[styles.strip, { borderColor: colors.border }]} testID="retrain-toolbar">
        <ToolButton
          label={t('v2.retrain.editor.addBox', 'Add box')}
          active={drawMode}
          onPress={() => setDrawMode((on) => !on)}
          icon={<Plus size={20} color={drawMode ? colors.primaryOn : colors.foreground} />}
          testID="retrain-add-box"
        />
        <ToolButton
          label={t('v2.retrain.editor.undo', 'Undo')}
          disabled={!session.canUndo}
          onPress={session.undo}
          icon={<Undo2 size={20} color={colors.foreground} />}
        />
        <ToolButton
          label={t('v2.retrain.editor.redo', 'Redo')}
          disabled={!session.canRedo}
          onPress={session.redo}
          icon={<Redo2 size={20} color={colors.foreground} />}
        />
        {drawMode ? (
          <Text style={[styles.hintText, { color: colors.primary }]} numberOfLines={1}>
            {t('v2.retrain.editor.drawHint', 'Drag on the frame to draw a box')}
          </Text>
        ) : null}
      </View>

      <View style={styles.body} onLayout={onBodyLayout}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.foregroundMuted} />
          </View>
        ) : missing ? (
          <View style={styles.center}>
            <Text style={{ color: colors.foregroundMuted }}>
              {t('v2.retrain.editor.missing', 'This frame is no longer in the corpus.')}
            </Text>
          </View>
        ) : (
          <View style={wide ? styles.wideRow : styles.fill}>
            <View style={[styles.fill, { marginBottom: fitInset }]}>
              <RetrainCanvas
                source={source}
                imageSize={imageSize}
                rows={rows}
                selectedKey={editor.selectedKey}
                hoverKey={hoverKey}
                drawMode={drawMode}
                viewport={viewport}
                onViewportChange={setViewport}
                onContainerSize={setCanvasSize}
                onSelect={onSelectFromCanvas}
                onEditStart={session.beginGesture}
                onEdit={onEdit}
                onEditEnd={session.endGesture}
                onDraw={onDraw}
              />
            </View>
            {wide ? (
              <View
                style={[styles.side, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}
                testID="retrain-side-panel"
              >
                <View style={styles.sideSummary}>
                  <RetrainReviewSummary counts={review.counts} approximate={review.approximate} />
                </View>
                <KeyboardAwareScrollView>{panel}</KeyboardAwareScrollView>
              </View>
            ) : null}
          </View>
        )}

        {!wide && !loading && !missing ? (
          <SnapSheet
            snap={snap}
            onSnapChange={setSnap}
            heights={heights}
            headerHeight={SHEET_HEADER}
            handleLabel={t('v2.retrain.editor.sheetHandle', 'Subjects')}
            testID="retrain-sheet"
            header={
              <View style={styles.sheetHeader}>
                <RetrainReviewSummary counts={review.counts} approximate={review.approximate} />
              </View>
            }
          >
            <KeyboardAwareScrollView>{snap === 'collapsed' ? null : panel}</KeyboardAwareScrollView>
          </SnapSheet>
        ) : null}
      </View>

      <AnchoredMenu
        visible={menuAnchor !== null}
        onRequestClose={() => setMenuAnchor(null)}
        anchor={menuAnchor}
        align="end"
        minWidth={260}
      >
        <MenuItem
          label={t('v2.retrain.editor.showRemoved', 'Show removed')}
          checked={showRemoved}
          onPress={() => setShowRemoved((on) => !on)}
        />
        <MenuItem
          label={t('v2.retrain.editor.allBoxed', 'All subjects boxed')}
          checked={frame?.complete === true}
          onPress={toggleComplete}
        />
        <MenuItem
          label={t('v2.retrain.editor.acceptAll', 'Accept all drafts')}
          disabled={pendingDraftCount(editor) === 0}
          onPress={() => {
            session.apply(acceptAllDrafts)
            setMenuAnchor(null)
          }}
        />
        <MenuItem
          label={t('v2.retrain.editor.resetZoom', 'Reset zoom')}
          onPress={() => {
            setViewport(IDENTITY_VIEWPORT)
            setMenuAnchor(null)
          }}
        />
      </AnchoredMenu>
    </View>
  )
}

function ToolButton({
  label,
  icon,
  onPress,
  disabled = false,
  active = false,
  testID,
}: {
  readonly label: string
  readonly icon: React.ReactNode
  readonly onPress: () => void
  readonly disabled?: boolean
  readonly active?: boolean
  readonly testID?: string
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      hitSlop={4}
      style={[
        styles.tool,
        {
          backgroundColor: active ? colors.primaryFill : colors.backgroundElevated,
          borderColor: colors.border,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      {icon}
    </Pressable>
  )
}

function MenuItem({
  label,
  checked,
  disabled = false,
  onPress,
}: {
  readonly label: string
  readonly checked?: boolean
  readonly disabled?: boolean
  readonly onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="menuitem"
      accessibilityState={{ disabled, checked }}
      style={[styles.menuItem, { opacity: disabled ? 0.4 : 1 }]}
    >
      <Text style={[styles.menuText, { color: colors.foreground }]}>{label}</Text>
      {checked === true ? <Check size={16} color={colors.primary} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
  fill: { flex: 1 },
  wideRow: { flex: 1, flexDirection: 'row' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tool: {
    width: TOOL,
    height: TOOL,
    borderRadius: TOOL / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hintText: { fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.bold },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
  },
  bannerText: { flex: 1, fontSize: TYPOGRAPHY.size.sm },
  bannerButton: { minHeight: 44, justifyContent: 'center' },
  bannerAction: { fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.bold },
  side: { width: SIDE_PANEL_WIDTH, borderLeftWidth: StyleSheet.hairlineWidth },
  sideSummary: { padding: SPACING.lg },
  sheetHeader: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },
  menuItem: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl,
    gap: SPACING.lg,
  },
  menuText: { fontSize: TYPOGRAPHY.size.md },
})
