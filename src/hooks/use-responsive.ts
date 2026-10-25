import { Dimensions, PixelRatio, Platform } from 'react-native'
import { useViewportSize } from './use-viewport-size.js'
import {
  TABLET_MIN_SIDE,
  WEB_SIDEBAR_MIN_WIDTH,
  isTabletViewport,
  shouldShowSidebar,
  shouldUseWideDetail,
} from './sidebar-rules.js'

export {
  shouldShowSidebar,
  shouldUseWideDetail,
  shouldRestorePortraitLock,
  isTabletViewport,
  isLandscapeViewport,
  DETAIL_WIDE_MIN_WIDTH,
  TABLET_MIN_SIDE,
} from './sidebar-rules.js'
export type {
  PortraitRestoreInput,
  SidebarInput,
  ViewportInput,
  ViewportSize,
} from './sidebar-rules.js'

/**
 * Shortest side (pt) of the DEVICE screen — the input every "is this a tablet"
 * question wants, because nothing at runtime can shrink it: not the soft
 * keyboard, not a window resize, not browser chrome. See `sidebar-rules.ts` for
 * the defect that made this necessary.
 *
 * `undefined` on web on purpose: there the browser window is the device, and
 * `Dimensions.get('screen')` reports the MONITOR.
 *
 * `useViewportSize()` is subscribed to for its re-render, not its value: the
 * screen's shortest side is a device constant, but a component that asks this
 * question must still re-render when the window changes shape.
 */
export function useScreenMinSide(): number | undefined {
  useViewportSize()
  if (Platform.OS === 'web') return undefined
  const screen = Dimensions.get('screen')
  return Math.min(screen.width, screen.height)
}

/** Hook form: whether to show the side nav, and whether it should be the full
 *  labelled rail (vs the compact icon-only rail used in phone-landscape). */
export function useSidebarLayout(): { readonly showSidebar: boolean; readonly compact: boolean } {
  const { width, height } = useViewportSize()
  const isWeb = Platform.OS === 'web'
  const showSidebar = shouldShowSidebar({ width, height, isWeb })
  const isTablet = Math.min(width, height) >= TABLET_MIN_SIDE
  const isWideWeb = isWeb && width >= WEB_SIDEBAR_MIN_WIDTH
  const compact = showSidebar && !isTablet && !isWideWeb
  return { showSidebar, compact }
}

/** Hook form of `shouldUseWideDetail`: camera-detail wide layout (stream left,
 *  380px timeline rail right) on wide web windows and tablet landscape — the
 *  latter keyed off the DEVICE screen, so an open keyboard cannot collapse it. */
export function useWideDetailLayout(): boolean {
  const { width, height } = useViewportSize()
  const screenMinSide = useScreenMinSide()
  return shouldUseWideDetail({ width, height, screenMinSide, isWeb: Platform.OS === 'web' })
}

/**
 * Hook form of {@link isTabletViewport} — "is this a tablet DEVICE", asked of
 * the device screen on native and of the window on web.
 *
 * The one to reach for. {@link useIsTablet} below answers the same question off
 * the WINDOW alone, which is the measurement a soft keyboard shrinks; it is
 * kept for the sidebar, whose question really is about the window's room.
 */
export function useTabletViewport(): boolean {
  const { width, height } = useViewportSize()
  const screenMinSide = useScreenMinSide()
  return isTabletViewport({ width, height, screenMinSide, isWeb: Platform.OS === 'web' })
}

/** `true` only on a real tablet (shortest side >= 768pt) — phone-landscape is
 *  excluded. Drives the full labelled-sidebar layout. */
export function useIsTablet(): boolean {
  const { width, height } = useViewportSize()
  return Math.min(width, height) >= TABLET_MIN_SIDE
}

/** `true` for a (non-tablet) phone held in landscape. Drives the COMPACT
 *  icon-only sidebar variant — no labels to truncate. */
export function useIsMobileLandscape(): boolean {
  const { width, height } = useViewportSize()
  return Math.min(width, height) < TABLET_MIN_SIDE && width > height
}

/** Breakpoints (pt) for the responsive cameras grid. */
const TABLET_WIDE_MIN = 700
const DESKTOP_MIN = 1100
const WIDE_DESKTOP_STEP = 360
const MAX_GRID_COLUMNS = 6

/** Column count for the cameras list, scaled to viewport width so the cards keep
 *  a sane size from phone → desktop:
 *   • phone (< 700pt): 1 column portrait, 2 in landscape,
 *   • tablet (700–1100pt): 3,
 *   • desktop (> 1100pt): 4+, one extra column per ~360pt, capped at 6. */
export function useGridColumns(): number {
  const { width, height } = useViewportSize()
  if (width < TABLET_WIDE_MIN) return width > height ? 2 : 1
  if (width < DESKTOP_MIN) return 3
  const extra = Math.floor((width - DESKTOP_MIN) / WIDE_DESKTOP_STEP)
  return Math.min(MAX_GRID_COLUMNS, 4 + extra)
}

/**
 * Target snapshot width, in device pixels, for one cameras-list card.
 *
 * Cards were being served the full capture — 3840×2160, 756 KB average — into
 * a tile the viewport divides among {@link useGridColumns} columns. This is the
 * width to ASK for; the server snaps it to its own ladder, so nearby values
 * share one derived image instead of minting one per pixel.
 *
 * The device pixel ratio is capped at 2 deliberately: a 3× phone would ask for
 * ~1170 px to fill a 390 px tile, which is past the point where a thumbnail
 * looks any better and straight back into megabyte territory.
 */
export function useCardSnapshotWidth(): number {
  const { width } = useViewportSize()
  const columns = useGridColumns()
  const dpr = Math.min(PixelRatio.get(), 2)
  return Math.max(1, Math.round((width / Math.max(columns, 1)) * dpr))
}

/**
 * Target snapshot width, in device pixels, for a surface whose CSS width the
 * caller already knows (a measured box, a computed grid cell, a fixed strip).
 *
 * The same DPR cap and rounding as {@link useCardSnapshotWidth}, factored out
 * because most snapshot surfaces are NOT the cameras list: the paused grid wall
 * gets `cellW` as a prop, the live-view poster measures itself with `onLayout`,
 * and the grids preview strip is a fixed 72 pt tall row of four. Each of those
 * was being served the full 4K capture because the only width helper in the
 * codebase answered a question none of them was asking.
 *
 * Pure given a width — no hooks — so it can be called from a layout callback.
 */
export function snapshotWidthForCssPx(cssWidth: number): number | undefined {
  if (!Number.isFinite(cssWidth) || cssWidth <= 0) return undefined
  const dpr = Math.min(PixelRatio.get(), 2)
  return Math.max(1, Math.round(cssWidth * dpr))
}
