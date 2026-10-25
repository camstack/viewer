/**
 * Highlight border colors for the per-camera detail highlight, matching the
 * grid embed's palette (motion red / audio blue / detection green).
 */
export type HighlightType = 'motion' | 'audio' | 'detection' | null

export const HIGHLIGHT_COLORS: Record<Exclude<HighlightType, null>, string> = {
  motion: '#DC2626',
  audio: '#3B82F6',
  detection: '#22C55E',
}
