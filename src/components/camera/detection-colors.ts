/**
 * Detection class colors for the live bounding-box overlay + timeline chips /
 * cluster pills.
 *
 * ALIGNED to the server's unified taxonomy (`@camstack/types`
 * `catalogs/event-taxonomy.ts` — `TAXONOMY_COLORS` + `DETECTION_SUB_COLORS`) so
 * the viewer no longer keeps a DIVERGENT hardcoded table. The macro colors here
 * therefore match the server's post-unification scheme (person=green,
 * vehicle=blue, animal=orange), NOT the pre-unification ui-library values.
 *
 * A true single source (importing the taxonomy from `@camstack/types`) is not
 * yet feasible cross-repo: the installed `@camstack/types` only exports its main
 * entry, with no `./catalogs/event-taxonomy` subpath. Until that ships, these
 * values are hand-mirrored — keep them in sync with the server catalog. Prefer
 * resolving colors from a `listEventKinds` descriptor's `color` (which is always
 * authoritative) when one is available; this table is the fallback for the live
 * overlay, whose boxes carry only a raw class name.
 *
 * `face` / `plate` are viewer-only detection sub-boxes (not event kinds on the
 * server) and keep their existing hues.
 */

/** Fixed colors for known detection classes (mirrors the server taxonomy). */
const CLASS_COLORS: Readonly<Record<string, string>> = {
  // Macros (TAXONOMY_COLORS).
  person: '#22c55e',
  vehicle: '#3b82f6',
  animal: '#f97316',
  motion: '#f59e0b',
  audio: '#06b6d4',

  // Viewer-only sub-boxes (no server event kind).
  face: '#a855f7', // purple-500
  plate: '#ec4899', // pink-500

  // Detection subs (DETECTION_SUB_COLORS).
  car: '#f59e0b',
  truck: '#d97706',
  bus: '#b45309',
  motorcycle: '#eab308',
  bicycle: '#ca8a04',
  airplane: '#60a5fa',
  boat: '#2563eb',
  train: '#1d4ed8',
  bird: '#14b8a6',
  dog: '#84cc16',
  cat: '#f97316',
  horse: '#a16207',
  sheep: '#a3a3a3',
  cow: '#78716c',
  elephant: '#6b7280',
  bear: '#7c2d12',
  zebra: '#404040',
  giraffe: '#d4a373',
}

/** Fallback palette for unknown classes (deterministic hash-based). */
const FALLBACK_PALETTE: readonly string[] = [
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#10b981', // emerald-500
  '#6366f1', // indigo-500
  '#e11d48', // rose-600
  '#0891b2', // cyan-600
  '#7c3aed', // violet-600
  '#059669', // emerald-600
]

const DEFAULT_COLOR = '#f59e42'

/** Color for a detection class name — fixed for known classes, deterministic
 *  hash-based for unknown ones. */
export function getClassColor(className: string): string {
  const lower = className.toLowerCase()
  const fixed = CLASS_COLORS[className] ?? CLASS_COLORS[lower]
  if (fixed) return fixed

  let hash = 0
  for (let i = 0; i < className.length; i++) {
    hash = (hash * 31 + (className.codePointAt(i) ?? 0)) >>> 0
  }
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length] ?? DEFAULT_COLOR
}
