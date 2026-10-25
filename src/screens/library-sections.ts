/**
 * library-sections — the section contract of the Library tab (the tab formerly
 * labelled Events), factored out as a pure (RN-free) module so it is unit
 * testable in the repo's node test environment, like `nc-tabs.ts`.
 *
 *   • Events    — the track-centric events page (`EventsScreen`).
 *   • Artifacts — LABELLED **Media** since 2026-09-13; the key, the `?section=`
 *                 value and the `/artifacts` route keep the old word because
 *                 bookmarks and deep links carry them, and a word is not worth
 *                 breaking a link for. The label lives in the locales alone.
 *                 The gallery of STORED MEDIA (`ArtifactsScreen`): what the hub
 *                 produced (timelapses, mosaics, rule clips) AND the operator's
 *                 own recording exports. Exports were a third section until
 *                 2026-09-13; they are a KIND in this one now, because a file on
 *                 the hub with a camera, an instant and a retention window is
 *                 one thing however it came to exist, and two sections meant two
 *                 filters and two ideas of what may be done to a file.
 *   • Review    — the face mass-review tab (`FaceReviewScreen`), offered to
 *                 a session holding the `face-assignment` feature.
 *   • Plates    — license-plate review (`PlateReviewScreen`), the twin of
 *                 People over the `plateGallery` cap: `plate-assignment`.
 *   • Scenes    — PREPARED, behind `FEATURE_FLAGS.scenesLibrary` (off), and
 *                 the `scenes` feature; decided by {@link scenesSectionOffered},
 *                 not in the page.
 *   • Retrain   — corpus browse (`RetrainScreen`): frames already in the
 *                 retrain dataset + collection management: `retrain`.
 *
 * The four feature sections are a RUNTIME gate on the features the hub
 * CONFIRMED (`useGrantedFeatures`: an admin holds all, a viewer the ones an
 * admin switched on, an unanswered session none), so they are never part of
 * the static {@link LIBRARY_SECTION_ORDER}.
 *
 * Events is the default: the tab keeps the route name `/events`, so every
 * shared deep link (`camstack://events?trackId=…&deviceId=…`) opens on exactly
 * the page it always opened on. Videoclips is deliberately absent.
 */
import type { SegmentOption } from '../components/ui/SegmentedControl.js'
import { FEATURE_FLAGS, type FeatureFlags } from '../app/feature-flags.js'
import { NO_VIEWER_FEATURES, type ViewerFeatureId } from '../hooks/viewer-features.js'

/** Discriminant for the Library's subsections. */
export type LibrarySectionKey = 'events' | 'artifacts' | 'review' | 'plates' | 'scenes' | 'retrain'

/** Ordered sections shown in the shell. */
export const LIBRARY_SECTION_ORDER: readonly LibrarySectionKey[] = ['events', 'artifacts']

/** The subsection shown when the tab first opens. */
export const DEFAULT_LIBRARY_SECTION: LibrarySectionKey = 'events'

/** i18n label key for each subsection. */
export const LIBRARY_SECTION_LABEL_KEYS: Readonly<Record<LibrarySectionKey, string>> = {
  events: 'v2.library.sections.events',
  artifacts: 'v2.library.sections.artifacts',
  review: 'v2.library.sections.review',
  plates: 'v2.library.sections.plates',
  scenes: 'v2.library.sections.scenes',
  retrain: 'v2.library.sections.retrain',
}

/** The feature each gated section needs, in the order the sections follow the base ones. */
const FEATURE_SECTIONS: readonly { readonly section: LibrarySectionKey; readonly feature: ViewerFeatureId }[] = [
  { section: 'review', feature: 'face-assignment' },
  { section: 'plates', feature: 'plate-assignment' },
  { section: 'scenes', feature: 'scenes' },
  { section: 'retrain', feature: 'retrain' },
]

/**
 * The sections a session actually sees: {@link LIBRARY_SECTION_ORDER} plus,
 * appended last, each feature section whose feature `granted` holds — never
 * one for an unknown session (fail-closed; a section the hub will refuse is
 * worse than no section).
 */
export function librarySectionsFor(
  granted: readonly ViewerFeatureId[],
  flags: FeatureFlags = FEATURE_FLAGS,
): readonly LibrarySectionKey[] {
  const extra = FEATURE_SECTIONS.filter(({ section, feature }) =>
    section === 'scenes' ? scenesSectionOffered(granted, flags) : granted.includes(feature),
  ).map(({ section }) => section)
  return [...LIBRARY_SECTION_ORDER, ...extra]
}

/**
 * Whether the Scenes section is offered. THE place its access is decided: the
 * feature flag (off by default) AND the `scenes` feature. The page itself
 * (`ScenesScreen`) carries no access rule.
 */
export function scenesSectionOffered(granted: readonly ViewerFeatureId[], flags: FeatureFlags = FEATURE_FLAGS): boolean {
  return flags.scenesLibrary && granted.includes('scenes')
}

/** Build the segmented-control options (labels resolved via the passed `t`).
 *  `granted` defaults to none — the caller must opt IN to the feature sections. */
export function buildLibrarySections(
  t: (key: string) => string,
  granted: readonly ViewerFeatureId[] = NO_VIEWER_FEATURES,
  flags: FeatureFlags = FEATURE_FLAGS,
): readonly SegmentOption<LibrarySectionKey>[] {
  return librarySectionsFor(granted, flags).map((value) => ({ value, label: t(LIBRARY_SECTION_LABEL_KEYS[value]) }))
}

/**
 * Read the `?section=` query param the Library shell honours (`/events?section=artifacts`).
 *
 * Returns `null` for anything that is not a section — including the far more
 * common case of no param at all, which is what a `trackId` deep link looks
 * like. The caller keeps its current section then, rather than resetting it.
 * `granted` defaults to none, so `?section=review` clamps to Events unless the
 * caller confirms the session holds `face-assignment` — it must never be
 * trusted from the URL itself. `?section=groups` — and, since the merge, `?section=exports` — is simply
 * an unknown segment: it returns `null` and the tab stays put, rather than being
 * secretly redirected. A deep link that named the old section keeps whatever the
 * tab was showing instead of being bounced somewhere the operator did not ask
 * for; the STACKED `/exports` route is the alias that still lands on the media.
 */
export function librarySectionFromParam(
  param: string | readonly string[] | undefined,
  granted: readonly ViewerFeatureId[] = NO_VIEWER_FEATURES,
  flags: FeatureFlags = FEATURE_FLAGS,
): LibrarySectionKey | null {
  if (typeof param !== 'string') return null
  const offered = librarySectionsFor(granted, flags)
  if (FEATURE_SECTION_PARAMS.includes(param) && !offered.some((section) => section === param)) return 'events'
  return offered.find((section) => section === param) ?? null
}

/** `?section=` values offered only with their feature (Scenes only while its flag is on). */
const FEATURE_SECTION_PARAMS: readonly string[] = ['review', 'plates', 'retrain']

/** The query params the Library tab can be opened with. */
export interface LibraryLinkParams {
  readonly section?: string | readonly string[]
  readonly trackId?: string | readonly string[]
  readonly deviceId?: string | readonly string[]
}

/**
 * Which subsection a navigation to `/events` asks for, or `null` for "leave it
 * where it is".
 *
 * A `trackId` outranks `section`: a shared track link is answered by the events
 * page, and landing it on the gallery would swallow it in silence — the params
 * are consumed and cleared there whether or not anything showed them.
 */
export function librarySectionFromParams(
  params: LibraryLinkParams,
  granted: readonly ViewerFeatureId[] = NO_VIEWER_FEATURES,
  flags: FeatureFlags = FEATURE_FLAGS,
): LibrarySectionKey | null {
  if (typeof params.trackId === 'string' && params.trackId.length > 0) return 'events'
  return librarySectionFromParam(params.section, granted, flags)
}
