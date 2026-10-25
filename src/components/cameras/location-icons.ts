/**
 * Which catalog icon a location wears, on the phone.
 *
 * A location or zone icon is a key of the `@camstack/types` icon catalog
 * (D854) and nothing else; `CatalogIcon` draws it. The viewer keeps no list of
 * its own, so a catalog bump needs no change here.
 */
import { canonicalIconKey, LOCATION_ICON_FALLBACK, locationIconKey } from '@camstack/types/client'
import type { IconKey } from '@camstack/types'

export type DrawableLocationIcon = IconKey

export { LOCATION_ICON_FALLBACK, locationIconKey }

/** A catalog key for a stored value, or the fallback for a non-empty value the
 *  catalog does not know (a newer hub). `null` only when nothing was chosen. */
export function drawableIcon(value: unknown): DrawableLocationIcon | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return canonicalIconKey(value) ?? LOCATION_ICON_FALLBACK
}

/** The icon a location should wear, or `null` when nobody chose one.
 *
 *  Keys by the FOLDED label: the strip shows "Kitchen" and the assignment is
 *  stored under `kitchen`, so a lookup on the displayed text finds nothing and
 *  silently draws a bare chip — which looks exactly like "no icon chosen".
 */
export function locationIconFor(
  icons: ReadonlyMap<string, DrawableLocationIcon>,
  label: string,
): DrawableLocationIcon | null {
  return icons.get(locationIconKey(label)) ?? null
}
