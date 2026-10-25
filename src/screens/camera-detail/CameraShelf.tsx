/**
 * CameraShelf — the other cameras, under the picture, on a tablet.
 *
 * Fills the space `wide-detail-sizes.ts` has reserved and left empty since it
 * was written (`STREAM_MAX_HEIGHT_FRACTION = 0.62`, "the info area … Phase 4").
 * The rules — whether it exists at all, which cameras it lists, how the cards
 * wrap — are pure in `camera-shelf.ts`; this file is the surface.
 *
 * ## Two things it deliberately does not do
 *
 * **It does not decide the split.** The shelf is a sibling of the picture in
 * the stream slot and simply takes what is left. If it decided its own height
 * the picture's box would depend on it, and the picture's box is the one thing
 * in this screen that must stay derivable from window quantities alone.
 *
 * **It does not report to `snapshot-viewport.ts`.** That rule is subtractive: a
 * surface that says nothing behaves exactly as it did before the rule existed,
 * and one that reports badly turns OFF frames another screen is painting.
 * Enrolling the shelf is worth doing once its scroll position can be trusted to
 * mean visibility; until then silence is the safe half.
 *
 * ## Two shapes, one shelf
 *
 * `rows` is what shipped: cards wrapping into as many rows as the column is
 * wide enough for, scrolling vertically. `strip` is that same card, narrower,
 * in ONE horizontally scrolling row — what the shelf becomes once the wall has
 * taken the space under the picture (`workspace-grid.ts`). Same card, same
 * bar, same rules: only the direction of the scroll and the card's width
 * change, so the two shapes cannot drift into two components.
 *
 * ## The rows END where the picture ends
 *
 * `contentWidth` is the picture's width, handed down from `BelowStreamArea`,
 * and in `rows` the cards are widened by {@link fitShelfRow} until the row
 * closes on it. There is no horizontal padding in either shape for the same
 * reason: a padded scroller starts and ends 8pt inside the picture, which is
 * the alignment the operator asked to be rid of. The GAP between cards stays —
 * it separates cards, it does not inset the block.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native'

import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS, type ColorTokens } from '../../theme/tokens.js'
import { FEATURE, useCameras, type CameraInfo } from '../../data/use-cameras.js'
import { useSnapshot } from '../../data/use-snapshot.js'
import { useCanActuate } from '../../hooks/use-user-scope.js'
import { useScreenActive } from '../../hooks/use-screen-active.js'
import { snapshotWidthForCssPx } from '../../hooks/use-responsive.js'
import { SnapshotImage } from '../../components/camera/SnapshotImage.js'
import { CameraStatusDot } from '../../components/camera/CameraStatusDot.js'
import { CameraActionBar } from '../../components/camera/CameraActionBar.js'
import { MotionBorder } from '../../components/camera/MotionBorder.js'
import { ReelHighlightSheet } from '../../components/camera/ReelHighlightSheet.js'
import {
  useReelHighlightTrigger,
  type ReelHighlightTrigger,
} from '../../data/use-reel-highlight.js'
import { useReelHighlightStore } from '../../store/reel-highlight-store.js'
import { SlidersHorizontal } from '../../lib/icons.js'
import { useSettings } from '../../data/use-settings.js'
import { useTranslation } from 'react-i18next'
import type { GridHighlightSettings } from '../../store/grid-store.js'
import {
  SHELF_CONTROLS,
  cameraActionBarItems,
  isCameraPanelAction,
  type CameraActionKind,
} from '../../grid/camera-action-bar.js'
import type { GridCellPanelKind } from '../../grid/cell-controls.js'
import { useWorkspaceStore } from '../../store/workspace-store.js'
import { SHELF_CARD_WIDTH, fitShelfRow, shelfCameras } from './camera-shelf.js'
import { SHELF_STRIP_HEIGHT, STRIP_CARD_WIDTH, type ShelfVariant } from './workspace-grid.js'

/** Marker for the shelf root. `testID` reaches the web as `data-testid` and is
 *  inert on a device; the phone guarantee ("this never appears") is asserted
 *  through it. */
export const CAMERA_SHELF_TEST_ID = 'camera-shelf'

/** Marker per SHAPE, on the scroller itself. The two shapes differ in the
 *  direction they scroll and in a fixed height, and react-native-web compiles
 *  both into classes a test cannot read — so the variant is published as an id
 *  rather than inferred from styling that is invisible to jsdom. */
export const SHELF_VARIANT_TEST_ID: Readonly<Record<ShelfVariant, string>> = {
  rows: 'camera-shelf-rows',
  strip: 'camera-shelf-strip',
}

/** Marker for the RESERVED band — the shelf root with nothing answered in it
 *  yet. Its own id, because "the band is held" and "a reel is listed" are two
 *  different claims and a spec that could not tell them apart is what let the
 *  pending state ship as an empty install (D315). */
export const CAMERA_SHELF_PENDING_TEST_ID = 'camera-shelf-pending'

export interface CameraShelfProps {
  /** The camera whose player is on screen — excluded from its own shelf. */
  readonly currentDeviceId: number
  /** Navigate to another camera (`router.replace('/camera/<id>')`). */
  readonly onGoTo: (deviceId: number) => void
  /** A per-camera panel was asked for, for THAT camera — the same intent the
   *  wall's tiles post, answered by the same host. */
  readonly onCellPanel: (kind: GridCellPanelKind, deviceId: number) => void
  /**
   * Open THAT camera in the on-demand player (D483).
   *
   * The shelf posts the intent and never the instant: "the moment I am looking
   * at" is the playback machine's `activeEpoch`, the screen owns the machine,
   * and a reel card that read it would re-render on every tick of the playhead.
   * Same division as `onGoTo` and `onCellPanel` — the card names the camera,
   * the screen decides what happens to it.
   *
   * Not optional and not gated here: the reel only exists in the `wide` shape
   * (`shouldShowCameraShelf`), which is the same authority
   * `canOpenOnDemand` delegates to, so a card that can be pressed is by
   * construction on a surface the overlay is allowed on.
   */
  readonly onOpenPlayback: (deviceId: number) => void
  /** Wrapping rows (no wall) or one scrolling row (the wall has the space). */
  readonly variant?: ShelfVariant
  /** The width the shelf is drawn in — the PICTURE's width. In `rows` the cards
   *  are sized to close a row on it exactly (`fitShelfRow`). */
  readonly contentWidth?: number
  /** Cameras already visible as cells — dropped from the list by the same rule
   *  that drops the one in the picture. */
  readonly alreadyOnScreen?: readonly number[]
}

/**
 * The reel's highlight-editor trigger.
 *
 * Published as an id because the button is an absolute overlay with no text and
 * react-native-web compiles its placement into a class a test cannot read —
 * the same reason `SHELF_VARIANT_TEST_ID` exists.
 */
export const REEL_HIGHLIGHT_BUTTON_TEST_ID = 'camera-shelf-highlight-settings'

/** Stable empty default: a fresh literal would re-derive the list every render. */
const NONE_ON_SCREEN: readonly number[] = []

export function CameraShelf({
  currentDeviceId,
  onGoTo,
  onCellPanel,
  onOpenPlayback,
  variant = 'rows',
  contentWidth = 0,
  alreadyOnScreen = NONE_ON_SCREEN,
}: CameraShelfProps): React.JSX.Element | null {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const styles = useMemo(() => makeStyles(colors), [colors])
  // `status` is read, not inferred from `data`: pending, answered-and-empty and
  // answered-with-cameras are three states, and only the query knows which one
  // it is in. See the early returns below.
  const { data: cameras, status } = useCameras()
  // Naming a camera in `getSnapshotLinks` is a standing capture order every
  // 5 s (D108), so the reel's demand must follow "is anybody looking", not
  // "is this mounted". The camera detail is a PUSHED screen: it stays mounted
  // under anything pushed over it and while the app is backgrounded — and this
  // reel is every OTHER camera, i.e. the whole install minus one. Same gate
  // `CameraCard` uses on the Cameras tab. Read ONCE here, not per card: the
  // hook wires a focus effect plus an `AppState` listener, and one per card is
  // one per camera in the install.
  const active = useScreenActive()

  // ONE read for the whole reel, handed down as a prop. A per-card
  // subscription would re-render every card on every patch of the editor — the
  // discipline the cards already follow for `useWorkspaceStore((s) => s.add)`.
  const highlight = useReelHighlightStore((s) => s.highlight)
  const hydrateHighlight = useReelHighlightStore((s) => s.hydrate)
  const [highlightSheetOpen, setHighlightSheetOpen] = useState(false)
  useEffect(() => {
    void hydrateHighlight()
  }, [hydrateHighlight])

  const others = useMemo(
    () => shelfCameras(cameras ?? [], currentDeviceId, alreadyOnScreen),
    [alreadyOnScreen, cameras, currentDeviceId],
  )

  // The row fit, from the picture's width. Memoised because it feeds every
  // card's `useSnapshot` width, and a fresh number there is a fresh request.
  const rowFit = useMemo(
    () => fitShelfRow({ contentWidth, gap: SPACING.sm, minCardWidth: SHELF_CARD_WIDTH }),
    [contentWidth],
  )

  const strip = variant === 'strip'

  // THREE states, not two (D315).
  //
  // `data === undefined` is "the query has not answered", and folding it into
  // `[]` made a cold start, a slow hub and a reconnect look byte-for-byte like
  // an install that owns one camera: the whole band vanished and everything
  // under the picture sat in space that was going to be taken back.
  //
  // So the band is RESERVED from the first frame at the height it will have.
  // When the list lands the cards fill it and nothing below moves — which is
  // the movement the eye actually notices. The accepted cost is the other
  // direction: an install that really has no other camera collapses the band
  // once, at the moment it first knows that, and only then.
  //
  // `error` is not pending. A band that spins forever would be a second lie,
  // and the query keeps the last good `data` across a failed refetch — so this
  // branch is only ever "we asked, we were refused, we never had a list".
  if (cameras === undefined) {
    if (status === 'error') return null
    return (
      <View
        testID={CAMERA_SHELF_TEST_ID}
        style={strip ? styles.rootStrip : styles.root}
      >
        <View
          testID={CAMERA_SHELF_PENDING_TEST_ID}
          accessibilityRole="progressbar"
          accessibilityLabel={t('v2.cameraShelf.loadingA11y')}
          style={styles.pending}
        >
          {/* A WORD, not N card skeletons. How many cameras are coming is the
              one thing this state does not know, and a row of placeholder
              cards would state a count as confidently as the empty reel used
              to state zero. An empty box would read as a bug instead. */}
          <Text style={styles.pendingText}>{t('v2.cameraShelf.loading')}</Text>
        </View>
      </View>
    )
  }

  // Answered, and there is nothing to list: the operator has one camera.
  if (others.length === 0) return null

  return (
    <View
      testID={CAMERA_SHELF_TEST_ID}
      style={strip ? styles.rootStrip : styles.root}
    >
      {/* No heading. Beside a wall of the same cameras' live pictures, a label
          saying "other cameras" costs ~22pt of vertical space to say what the
          arrangement already says. Dropped in both shapes (2026-09-05). */}
      {/* Rows, not a single strip: the cards WRAP into as many rows as the
          column is wide enough for and the whole block scrolls vertically. The
          wrap is CSS, so no measurement decides it and nothing here can
          disagree with what is drawn. In the strip there is no wrap at all —
          one row, scrolled horizontally. */}
      <ScrollView
        testID={SHELF_VARIANT_TEST_ID[variant]}
        horizontal={strip}
        style={styles.scroll}
        contentContainerStyle={strip ? styles.strip : styles.rows}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      >
        {others.map((camera) => (
          <ShelfCard
            key={camera.id}
            camera={camera}
            width={strip ? STRIP_CARD_WIDTH : rowFit.cardWidth}
            active={active}
            onGoTo={onGoTo}
            onOpenPlayback={onOpenPlayback}
            onCellPanel={onCellPanel}
            highlight={highlight}
          />
        ))}
      </ScrollView>
      {/* The highlight editor's trigger.
          ABSOLUTELY positioned, and that is the whole design constraint: this
          reel deliberately has NO heading — one was removed on 2026-09-05
          because "a label saying 'other cameras' costs ~22pt of vertical space
          to say what the arrangement already says". A header row to hold a
          button would put that 22pt straight back. So the control floats in the
          reel's top-right padding band, drawn as chrome (a themed disc) rather
          than as part of any card. */}
      <Pressable
        onPress={() => setHighlightSheetOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('v2.reelHighlight.openA11y')}
        testID={REEL_HIGHLIGHT_BUTTON_TEST_ID}
        style={styles.highlightBtn}
      >
        <SlidersHorizontal size={15} color={colors.foreground} />
      </Pressable>
      <ReelHighlightSheet
        visible={highlightSheetOpen}
        onClose={() => setHighlightSheetOpen(false)}
      />
    </View>
  )
}

interface ShelfCardProps {
  readonly camera: CameraInfo
  /** Card width (pt) — the only thing the two shelf shapes change about a card. */
  readonly width: number
  /** Is anybody looking at this reel — see the `useScreenActive` call above. */
  readonly active: boolean
  readonly onGoTo: (deviceId: number) => void
  readonly onCellPanel: (kind: GridCellPanelKind, deviceId: number) => void
  readonly onOpenPlayback: (deviceId: number) => void
  /** The reel's ONE highlight object — read by the shelf, passed to every card,
   *  never subscribed to per card (that would re-render the whole reel on every
   *  patch of the editor). */
  readonly highlight: GridHighlightSettings
}

const ShelfCard = React.memo(function ShelfCard({
  camera,
  width,
  active,
  onGoTo,
  onCellPanel,
  onOpenPlayback,
  highlight,
}: ShelfCardProps) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  // The ACTION only, never the state. A card that read `workspace` re-rendered
  // every card in the reel on every add, remove and cell resize — and it read
  // it to grey out a camera already in the view, which is a state the reel can
  // no longer be in: a member is a cell on the wall and the wall's cameras are
  // dropped from this list (`BelowStreamArea`, `alreadyOnScreen`).
  const addToWorkspace = useWorkspaceStore((s) => s.add)
  const canActuate = useCanActuate()

  const snapshot = useSnapshot(camera.id, active, snapshotWidthForCssPx(width))
  const items = useMemo(
    () =>
      cameraActionBarItems({
        // PTZ MOVES the camera: a session the hub would refuse never sees the
        // control. Same gate the theater's own toolbar uses.
        hasPtz: canActuate && camera.features.includes(FEATURE.ptz),
        // The card is ~180pt wide but the bar is on its own row underneath, not
        // over a video: it has the room the wall's small cells do not. What it
        // does NOT carry is `viewOptions` — see `SHELF_CONTROLS`.
        layout: SHELF_CONTROLS,
        canNavigate: true,
      }),
    [canActuate, camera.features],
  )

  const onAction = useCallback(
    (kind: CameraActionKind): void => {
      if (kind === 'goTo') {
        onGoTo(camera.id)
        return
      }
      if (kind === 'addToView') {
        // Writes, and does NOT navigate. The wall that renders this membership
        // is Fase F; the state it will read is this one, not a placeholder.
        addToWorkspace(camera.id)
        return
      }
      if (kind === 'playback') {
        // Neither navigates nor writes the view: a second picture opens OVER
        // this screen, at the instant the screen is already showing.
        onOpenPlayback(camera.id)
        return
      }
      if (isCameraPanelAction(kind)) onCellPanel(kind, camera.id)
    },
    [addToWorkspace, camera.id, onCellPanel, onGoTo, onOpenPlayback],
  )

  // The reel did not light up at all — `highlight` was never consumed here, so
  // there was no wiring to debug. The signals are the SAME ones every other
  // surface keys off (`use-reel-highlight.ts`); the ring is the SAME component
  // the cameras-list card draws.
  const trigger = useReelHighlightTrigger(camera.id, highlight, active)
  const highlightAppearance = useSettings().settings.highlight

  return (
    <View style={[styles.card, { width }]}>
      <Pressable
        onPress={() => onGoTo(camera.id)}
        accessibilityRole="button"
        accessibilityLabel={camera.name}
        style={styles.thumbWrap}
      >
        <SnapshotImage source={snapshot} deviceId={camera.id} style={styles.thumb} />
      </Pressable>
      <View style={styles.footer}>
        <CameraStatusDot
          deviceId={camera.id}
          online={camera.online}
          disabled={camera.disabled}
        />
        <Text style={styles.name} numberOfLines={1}>
          {camera.name}
        </Text>
      </View>
      <CameraActionBar items={items} onAction={onAction} variant="surface" />
      {/* LAST child so it draws over the thumbnail and the bar, and `RADIUS.md`
          because that is THIS card's radius — the ring draws just inside a
          clipped rounded box and an `lg` ring in an `md` card shows daylight at
          the corners. Colour per trigger: a card lit by audio must not glow in
          the motion colour. */}
      {trigger === null ? null : (
        <MotionBorder color={highlightAppearance[TRIGGER_COLOR[trigger]]} radius={RADIUS.md} />
      )}
    </View>
  )
})

/**
 * Which GLOBAL appearance colour a lit trigger draws in.
 *
 * `settings.highlight.*` and not the theme: these are the same three colours
 * the detail border and the grid tile use, and the operator can change them.
 * The cameras-list ring shipped hardcoded to the theme's warning colour once
 * and the operator read the mismatch as a bug (`MotionBorder`'s docblock) —
 * the reel is not a different surface either.
 */
const TRIGGER_COLOR: Readonly<
  Record<ReelHighlightTrigger, 'motionColor' | 'audioColor' | 'detectionColor'>
> = {
  motion: 'motionColor',
  audio: 'audioColor',
  detection: 'detectionColor',
}

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    root: { flex: 1, minHeight: 0, alignSelf: 'stretch', paddingTop: SPACING.sm },
    /** The strip does NOT flex: its height is `SHELF_STRIP_HEIGHT`, fixed, so
     *  the wall above takes everything else. A shelf that sized itself would be
     *  deciding the wall's box from what the snapshots happen to be doing. */
    rootStrip: {
      height: SHELF_STRIP_HEIGHT,
      alignSelf: 'stretch',
      paddingVertical: SPACING.sm,
    },
    scroll: { flex: 1, minHeight: 0 },
    /** The reserved band's contents. `flex: 1` in both shapes so it occupies
     *  exactly what the cards will occupy — the point of the band is that the
     *  height does not change when they arrive. */
    pending: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' },
    pendingText: { color: colors.foregroundMuted, fontSize: 12 },
    /** No `paddingHorizontal`: the block IS the picture's width, and an inset
     *  here would put the first and last card 8pt inside the picture's edges —
     *  the misalignment this shape was corrected for. */
    rows: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: SPACING.sm,
      paddingBottom: SPACING.md,
    },
    strip: {
      flexDirection: 'row',
      gap: SPACING.sm,
      alignItems: 'flex-start',
    },
    card: {
      borderRadius: RADIUS.md,
      overflow: 'hidden',
      backgroundColor: colors.backgroundElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: SPACING.xs,
      gap: SPACING.xs,
    },
    /** Floats in the reel's top padding band — see the JSX for why there is no
     *  header row to put it in. Above the cards so a card edge cannot cover it. */
    highlightBtn: {
      position: 'absolute',
      top: 0,
      right: 0,
      width: 28,
      height: 28,
      borderRadius: RADIUS.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.backgroundElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      zIndex: 2,
    },
    thumbWrap: {
      width: '100%',
      aspectRatio: 16 / 9,
      borderRadius: RADIUS.sm,
      overflow: 'hidden',
      backgroundColor: '#000',
    },
    thumb: { width: '100%', height: '100%' },
    footer: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
    name: { flex: 1, color: colors.foreground, fontSize: 12, fontWeight: '600' },
  })
}
