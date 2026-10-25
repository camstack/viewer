/**
 * The location picker's own vocabulary: which buckets exist, and what each one
 * selects.
 *
 * Pure, so the rules are testable without a screen — the picker only draws what
 * this decides.
 */

/** A camera, reduced to what bucketing needs. */
export interface LocatableCamera {
  readonly id: number
  readonly location: string | null
}

/**
 * A SITE ZONE as this screen needs it — a named part of the property holding
 * several locations ("Night zone" holds the bedrooms).
 *
 * Declared structurally HERE and not imported from `@camstack/types`: that
 * specifier resolves to the workspace source for tsc and to the PUBLISHED
 * package at runtime, so importing a type added the same day compiles green and
 * throws the moment the app evaluates it. The shape is small; the trap is not.
 */
export interface ZoneView {
  readonly zoneKey: string
  readonly label: string
  readonly locationKeys: readonly string[]
}

/**
 * A bucket the picker offers. `null` selects everything.
 *
 * A PREFIXED key, not a bare label, because a zone and a location may carry the
 * same name — an operator with a "Cantina" zone and a "Cantina" room is not
 * confused, and neither should the picker be. The prefix makes the two
 * structurally different strings, so `===` keeps working as React state.
 */
export type LocationBucket = string | null

/**
 * The shortlist bucket. NOT a location: it selects by the operator's own stars,
 * which is why it can be empty and still exist.
 */
export const FAVOURITES_BUCKET = 'fav'

/** The bucket for one location label. */
export function locationBucket(label: string): LocationBucket {
  return `l:${foldLabel(label)}`
}

/** The bucket for one zone. */
export function zoneBucket(zoneKey: string): LocationBucket {
  return `z:${foldLabel(zoneKey)}`
}

/** Trimmed + lower-cased — the same fold the hub keys locations and zones by. */
function foldLabel(label: string): string {
  return label.trim().toLowerCase()
}

/**
 * The locations present among these cameras, sorted for humans.
 *
 * Derived from the cameras THEMSELVES rather than from the hub's curated
 * registry: the picker must offer what it can actually select. A registry label
 * no camera uses would be a bucket that always shows an empty list, and a
 * camera whose label is not in the registry would be unreachable — both worse
 * than the list being exactly what is here.
 */
export function locationsOf(cameras: readonly LocatableCamera[]): readonly string[] {
  const seen = new Map<string, string>()
  for (const c of cameras) {
    const label = c.location?.trim()
    if (label === undefined || label.length === 0) continue
    const key = label.toLowerCase()
    if (!seen.has(key)) seen.set(key, label)
  }
  // `.sort()` on a fresh array, NOT `toSorted` — Hermes does not implement it,
  // so it type-checks, works on web, and throws the moment a phone evaluates
  // it. The repo has a guard for exactly this and it caught this line.
  return [...seen.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  )
}

/**
 * The cameras a bucket selects.
 *
 * `null` gives all of them. Favourites gives the shortlist IN THE LIST'S ORDER
 * rather than the shortlist's, so the page does not reshuffle when a camera is
 * starred. A location matches case-insensitively, because the label is typed by
 * hand on each device and "Esterno" and "esterno" are one place.
 */
export function camerasInBucket<T extends LocatableCamera>(
  cameras: readonly T[],
  bucket: LocationBucket,
  favourites: ReadonlySet<number>,
  zones: readonly ZoneView[] = [],
): readonly T[] {
  if (bucket === null) return cameras
  if (bucket === FAVOURITES_BUCKET) return cameras.filter((c) => favourites.has(c.id))
  if (bucket.startsWith('z:')) {
    const zoneKey = bucket.slice(2)
    const zone = zones.find((z) => foldLabel(z.zoneKey) === zoneKey)
    // A zone the hub no longer reports selects NOTHING, not everything. An
    // unknown bucket falling through to "all cameras" would look exactly like
    // the filter having been cleared, which is the one reading that hides the
    // fact that the zone is gone.
    if (zone === undefined) return []
    const members = new Set(zone.locationKeys.map(foldLabel))
    return cameras.filter((c) => members.has(foldLabel(c.location ?? '')))
  }
  const key = bucket.startsWith('l:') ? bucket.slice(2) : foldLabel(bucket)
  return cameras.filter((c) => foldLabel(c.location ?? '') === key)
}
