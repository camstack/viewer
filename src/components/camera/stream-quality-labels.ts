/**
 * stream-quality-labels — localized label keys for the stream quality tiers.
 * Shared by the quality pickers (single-player overlay, grid bar popover).
 * Reuses the existing settings quality strings.
 */
import { CamProfileSchema } from '@camstack/types/client'

import type { StreamQuality } from '../../store/settings-store.js'

/** Localized label key for a tier. */
export function qualityLabelKey(quality: StreamQuality): string {
  switch (quality) {
    case 'auto':
      return 'v2.settings.qualityAuto'
    case 'high':
      return 'v2.settings.qualityHigh'
    case 'mid':
      return 'v2.settings.qualityMid'
    case 'low':
      return 'v2.settings.qualityLow'
  }
}

/**
 * The selectable tiers, in display order — the ONE list, read by every picker:
 * the timeline toolbar's chip, the grid wall's control bar, and the share
 * dialog's segmented control.
 *
 * DERIVED from the system enum rather than typed out. Each of those three used
 * to carry its own array of literals, and that is exactly how the grid ended up
 * offering `medium` — a word no other part of CamStack said — for months
 * without anything noticing. A hand-written list here would be the fourth.
 *
 * `auto` leads because it is the default and is not a tier; the profiles follow
 * in `CamProfileSchema`'s own order, which is the hub's.
 */
export const QUALITY_ORDER: readonly StreamQuality[] = ['auto', ...CamProfileSchema.options]
