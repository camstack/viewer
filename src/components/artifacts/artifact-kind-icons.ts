/**
 * artifact-kind-icons — one glyph per artifact kind, and the accent it is drawn
 * in. Pure (RN-free apart from the icon components themselves) so the mapping is
 * total: adding a kind to `NC_ARTIFACT_KINDS` without a glyph is a type error
 * here rather than a blank tile at runtime.
 */
import type { ComponentType } from 'react'
import { Clapperboard, LayoutGrid, Play, Timer, Aperture } from '../../lib/icons.js'
import type { NcArtifactKind } from '../../data/nc-artifacts.js'
import type { ColorTokens } from '../../theme/tokens.js'

/** The shape every lucide glyph in this app satisfies. */
export type ArtifactIcon = ComponentType<{ size: number; color: string }>

/** Total map — every kind, no fallback branch. */
const KIND_ICONS: Readonly<Record<NcArtifactKind, ArtifactIcon>> = {
  timelapse: Timer,
  'timelapse-preview': Play,
  'summary-mosaic': LayoutGrid,
  'event-clip': Clapperboard,
  'event-gif': Play,
  'event-still': Aperture,
}

/** The glyph for a kind. */
export function artifactKindIcon(kind: NcArtifactKind): ArtifactIcon {
  return KIND_ICONS[kind]
}

/**
 * The accent a kind's badge is drawn in.
 *
 * Grouped by SCOPE, which is the distinction visible in the data: a timelapse
 * and its preview are one camera over a window (`info`); a summary mosaic is a
 * digest across the rule's cameras (`primary`). Media type is already carried by
 * the glyph, so the colour is not spent repeating it.
 */
export function artifactKindAccent(kind: NcArtifactKind, colors: ColorTokens): string {
  switch (kind) {
    case 'timelapse':
    case 'timelapse-preview':
      return colors.info
    case 'event-clip':
    case 'event-gif':
    case 'event-still':
      return colors.warning
    case 'summary-mosaic':
      return colors.primary
  }
}
