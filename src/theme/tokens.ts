import type { TextStyle } from 'react-native'

export type ThemeMode = 'dark' | 'light'

export interface ColorTokens {
  primary: string
  primaryForeground: string
  background: string
  backgroundElevated: string
  surface: string
  surfaceHover: string
  border: string
  borderSubtle: string
  foreground: string
  foregroundMuted: string
  foregroundSubtle: string
  foregroundDisabled: string
  success: string
  warning: string
  danger: string
  info: string
  /** Filled status chip: opaque background (`*Fill`) and the text put ON it (`*On`), >= 4.5:1. */
  successFill: string
  successOn: string
  warningFill: string
  warningOn: string
  dangerFill: string
  dangerOn: string
  infoFill: string
  infoOn: string
  primaryFill: string
  primaryOn: string
  neutralFill: string
  neutralOn: string
  /** LIVE-edge accent — distinct from `danger` (which doubles as recording-red).
   *  Kind paint (the live cursor, the heatmap handle, recording) reads the hub
   *  palette, not this token. */
  live: string
}

const dark: ColorTokens = {
  primary: '#f59e42',
  primaryForeground: '#0c0a09',
  background: '#0c0a09',
  backgroundElevated: '#1c1917',
  surface: '#1c1917',
  surfaceHover: '#292524',
  border: '#292524',
  borderSubtle: '#1c1917',
  foreground: '#fafaf9',
  foregroundMuted: '#a8a29e',
  foregroundSubtle: '#78716c',
  foregroundDisabled: '#57534e',
  success: '#4ade80',
  warning: '#fbbf24',
  danger: '#f87171',
  info: '#60a5fa',
  successFill: '#4ade80',
  successOn: '#0c0a09',
  warningFill: '#fbbf24',
  warningOn: '#0c0a09',
  dangerFill: '#f87171',
  dangerOn: '#0c0a09',
  infoFill: '#60a5fa',
  infoOn: '#0c0a09',
  primaryFill: '#f59e42',
  primaryOn: '#0c0a09',
  neutralFill: '#44403c',
  neutralOn: '#fafaf9',
  live: '#22d3ee',
}

const light: ColorTokens = {
  primary: '#e67e22',
  primaryForeground: '#ffffff',
  background: '#fafaf9',
  backgroundElevated: '#ffffff',
  surface: '#f5f5f4',
  surfaceHover: '#e7e5e4',
  border: '#d6d3d1',
  borderSubtle: '#e7e5e4',
  foreground: '#1c1917',
  foregroundMuted: '#57534e',
  foregroundSubtle: '#78716c',
  foregroundDisabled: '#a8a29e',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  info: '#2563eb',
  successFill: '#15803d',
  successOn: '#ffffff',
  warningFill: '#b45309',
  warningOn: '#ffffff',
  dangerFill: '#dc2626',
  dangerOn: '#ffffff',
  infoFill: '#2563eb',
  infoOn: '#ffffff',
  primaryFill: '#c2410c',
  primaryOn: '#ffffff',
  neutralFill: '#57534e',
  neutralOn: '#ffffff',
  live: '#0891b2',
}

/** `pill` is a full-round end cap (any box shorter than 2 * 999). */
export const RADIUS = { sm: 4, md: 6, lg: 8, xl: 12, pill: 999 } as const
export const SPACING = { xs: 2, sm: 4, md: 8, lg: 12, xl: 16, '2xl': 24, '3xl': 32 } as const

/**
 * THE side gutter of every screen under a `ScopeBar` (Library, Settings, the
 * notification centre): the scope bar's own inset, so the content's edge lines
 * up with the control above it. `SPACING.xl`. Library used `SPACING.md` and
 * Settings `SPACING.xl`, so switching tab moved every left edge by 8 pt. 16 pt
 * still leaves a 390 pt phone two 177 pt tiles (`libraryTileWidth`).
 */
export const SCREEN_GUTTER = SPACING.xl

/**
 * Liquid-glass surfaces (`GlassSurface`). Alphas are fractions applied to a
 * palette colour with {@link withAlpha}; nothing here is a colour of its own, so
 * the glass follows the theme key for key and the web CSS needs no new token.
 *
 * - `tintAlpha`: the `backgroundElevated` wash laid over the blur fallback.
 * - `hairlineAlpha`: the specular edge, a `foreground` at this alpha.
 * - `solidAlpha`: Android, where there is no blur — a translucent solid, never
 *   a faked blur. Reduce Transparency drops to 1 (opaque) plus a `border`.
 */
export const GLASS = {
  blurIntensity: 60,
  tintAlpha: { dark: 0.45, light: 0.55 },
  hairlineAlpha: { dark: 0.15, light: 0.12 },
  solidAlpha: 0.8,
  /**
   * The tab bar: a DARKER wash than the floating pills so a capsule that sits
   * over page content never blends into it. `tone` names the palette key the
   * wash is cut from (darker than `backgroundElevated` in both themes).
   */
  bar: {
    tone: { dark: 'background', light: 'surfaceHover' },
    alpha: { dark: 0.9, light: 0.9 },
  },
} as const

/**
 * A palette colour at a given opacity: `#rgb` / `#rrggbb` in, `rgba()` out
 * (the one form React Native and the web both read). A colour that is not a hex
 * literal is returned unchanged rather than guessed at.
 */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  const hex = m[1]!.length === 3 ? m[1]!.replace(/./g, (c) => c + c) : m[1]!
  const a = Math.min(1, Math.max(0, alpha))
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`
}

/** Opacity of the scrim under text drawn ON a picture (a tile's when · where, a media badge). */
export const MEDIA_SCRIM_ALPHA = 0.72

/**
 * The scrim under text drawn ON a picture: the page background at
 * {@link MEDIA_SCRIM_ALPHA}, with `foreground` text on it. Follows the theme —
 * a light scrim with dark text on light, a dark one on dark — instead of a
 * black-and-white overlay that ignores it.
 */
export function mediaScrim(colors: Pick<ColorTokens, 'background'>): string {
  return withAlpha(colors.background, MEDIA_SCRIM_ALPHA)
}

/**
 * Typography scale. No custom `fontFamily` — the platform default is kept so we
 * inherit native system font rendering. Sizes/weights only, mirroring the flat
 * const style of SPACING/RADIUS.
 */
export const TYPOGRAPHY = {
  size: { xs: 11, sm: 12, md: 14, lg: 16 },
  weight: { regular: '500', medium: '600', bold: '700' },
} as const

/**
 * Spread into a Text style so numeric digits keep a constant advance width —
 * stops clock/time labels from jittering as they tick. Typed as a TextStyle
 * fragment so it composes cleanly inside StyleSheet.create and inline arrays.
 */
export const TABULAR: Pick<TextStyle, 'fontVariant'> = { fontVariant: ['tabular-nums'] }

export const THEME: Record<ThemeMode, ColorTokens> = { dark, light }
