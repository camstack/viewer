/**
 * LibraryScreen — the tab formerly labelled Events. A thin shell over the
 * things an operator goes looking for after the fact:
 *
 *   • Events    — the track-centric events page, unchanged (`EventsScreen`).
 *   • Artifacts — the gallery of stored media (`ArtifactsScreen`): what the hub
 *                 produced AND the operator's own recording exports, merged into
 *                 one list on 2026-09-13.
 *   • Review, Plates, Scenes, Retrain — each offered only to a session
 *                 holding its feature (`face-assignment`, `plate-assignment`,
 *                 `scenes`, `retrain`; an admin holds all). Gated by
 *                 `useGrantedFeatures()`, the same fail-closed hub confirmation
 *                 `useIsAdmin()` is — hidden entirely for a session without the
 *                 feature or an unanswered one rather than shown disabled, and
 *                 clamped away even if `?section=review` is typed by hand
 *                 (`librarySectionsFor` never includes it without the feature).
 *
 * The shell owns the section state and nothing else — the pages keep their
 * own data, filters and detail surfaces. The route stays `/events`: renaming it
 * would break every link already shared from a track detail.
 * `?section=artifacts` opens that subsection. The stacked `/artifacts` and
 * `/exports` routes stay alive as aliases onto the same gallery (old bookmarks
 * and deep links).
 *
 * The scope bar carries the safe-area inset itself, so it clears the notch on
 * the section that renders no app bar of its own.
 */
import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useLocalSearchParams } from 'expo-router'

import { useTheme } from '../theme/theme-provider.js'
import { ScopeBar } from '../components/ui/ScopeBar.js'
import { useGrantedFeatures } from '../data/use-me.js'
import { EventsScreen } from './EventsScreen.js'
import { ArtifactsScreen } from './artifacts/ArtifactsScreen.js'
import { FaceReviewScreen } from './faces/FaceReviewScreen.js'
import { PlateReviewScreen } from './plates/PlateReviewScreen.js'
import { RetrainScreen } from './retrain/RetrainScreen.js'
import { ScenesScreen } from './scenes/ScenesScreen.js'
import {
  DEFAULT_LIBRARY_SECTION,
  buildLibrarySections,
  librarySectionFromParam,
  librarySectionFromParams,
  librarySectionsFor,
  type LibrarySectionKey,
} from './library-sections.js'

export function LibraryScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const granted = useGrantedFeatures()
  // `?section=artifacts` / `?section=exports`, and the events page's own
  // `?trackId=` deep link — honoured on mount AND on a later navigation,
  // because a tab stays mounted: navigating to it again only changes the params.
  const params = useLocalSearchParams<{ section?: string; trackId?: string }>()
  const [section, setSection] = useState<LibrarySectionKey>(
    () => librarySectionFromParams(params, granted) ?? DEFAULT_LIBRARY_SECTION,
  )

  // The two links are watched SEPARATELY, on their own appearance rather than
  // on a combined value. EventsScreen clears `trackId` once it has opened the
  // detail: a combined value would flip back to whatever `section` still says
  // at that moment and close the track the operator just followed a link to.
  const paramSection = librarySectionFromParam(params.section, granted)
  const hasTrackLink = typeof params.trackId === 'string' && params.trackId.length > 0
  useEffect(() => {
    if (paramSection !== null) setSection(paramSection)
  }, [paramSection])
  useEffect(() => {
    if (hasTrackLink) setSection('events')
  }, [hasTrackLink])

  const sections = buildLibrarySections(t, granted)
  // Fail-closed: a section the session is not offered (a feature it does not
  // hold, Scenes while its flag is off) falls back to Events.
  const visibleSection: LibrarySectionKey = librarySectionsFor(granted).includes(section) ? section : 'events'

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScopeBar options={sections} value={visibleSection} onChange={setSection} />

      {visibleSection === 'events' ? (
        <EventsScreen embedded />
      ) : visibleSection === 'review' ? (
        <FaceReviewScreen />
      ) : visibleSection === 'plates' ? (
        <PlateReviewScreen />
      ) : visibleSection === 'scenes' ? (
        <ScenesScreen />
      ) : visibleSection === 'retrain' ? (
        <RetrainScreen />
      ) : (
        <ArtifactsScreen embedded />
      )}
    </View>
  )
}
