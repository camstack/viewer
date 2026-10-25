/**
 * The colours of a `Badge`, pure — so the fill / outline / tint rules are
 * unit-tested without rendering React Native.
 *
 * - `fill`    — opaque `*Fill` background with its `*On` text (>= 4.5:1, both themes);
 * - `outline` — transparent, border and text in the status colour;
 * - `tint`    — the soft wash used by the older pills (weak over photos).
 *
 * `neutral` has no status colour of its own: it reads from the foreground scale.
 */
import type { ColorTokens } from '../../theme/tokens.js'

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'neutral'
export type BadgeLook = 'fill' | 'outline' | 'tint'

export interface BadgeColors {
  readonly background: string
  readonly text: string
  readonly border: string
}

const TRANSPARENT = 'transparent'
/** Alpha suffix (hex) for the `tint` wash. */
const TINT_ALPHA = '22'

function toneColor(colors: ColorTokens, tone: BadgeTone): string {
  return tone === 'neutral' ? colors.foregroundMuted : colors[tone]
}

export function badgeColors(colors: ColorTokens, tone: BadgeTone, look: BadgeLook): BadgeColors {
  if (look === 'fill') {
    const background = colors[`${tone}Fill`]
    return { background, text: colors[`${tone}On`], border: background }
  }
  const base = toneColor(colors, tone)
  if (look === 'outline') return { background: TRANSPARENT, text: base, border: base }
  return { background: `${base}${TINT_ALPHA}`, text: base, border: TRANSPARENT }
}
