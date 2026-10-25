/**
 * track-icons — shared class → lucide icon mapping for track crop fallbacks.
 * Mirrors the mapping used by CropTile / EventCard so a track with no crop shows
 * the same class-tinted glyph as the rest of the events UI.
 */
import { User, Car, Dog, Bird, HelpCircle } from '../../../lib/icons.js'

export type IconComponent = React.ComponentType<{ size: number; color: string }>

export function iconForClass(className: string): IconComponent {
  const lower = className.toLowerCase()
  if (lower === 'person' || lower === 'face') return User
  if (['car', 'truck', 'bus', 'vehicle', 'motorcycle', 'bicycle'].includes(lower)) return Car
  if (lower === 'dog' || lower === 'cat' || lower === 'animal') return Dog
  if (lower === 'bird') return Bird
  return HelpCircle
}
