/**
 * Source guards for the Events → Library rename (2026-08-16). The viewer cannot
 * mount components here (vitest node env, no renderer), so the wiring is
 * asserted on the source in the style of `events-search-confirm-wiring.spec.ts`.
 * Each assertion names the defect it holds shut.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
/** The Settings tab is a shell over four segment files; read them as one. */
const SETTINGS_FILES = [
  'src/screens/SettingsScreen.tsx',
  'src/screens/settings/AccountSegment.tsx',
  'src/screens/settings/ViewingSegment.tsx',
  'src/screens/settings/AppSegment.tsx',
  'src/screens/settings/AdvancedSegment.tsx',
] as const
const readSettings = (): string => SETTINGS_FILES.map(read).join('\n')

describe('the Library shell owns both subsections', () => {
  it('LibraryScreen mounts Events and Artifacts — and no Exports page', () => {
    // Exports were merged INTO Artifacts on 2026-09-13: one list of stored
    // media, one filter, one answer to "what may I do with this file".
    const src = read('src/screens/LibraryScreen.tsx')
    expect(src).toContain('<EventsScreen')
    expect(src).toContain('<ArtifactsScreen')
    expect(src).not.toContain('<ExportsScreen')
  })

  it('leaves no ExportsScreen behind — a merged-away page is DELETED, not orphaned', () => {
    // A leftover that still describes the design we moved away from reads as
    // verification. This repo has been bitten by exactly that three times.
    expect(existsSync(join(ROOT, 'src/screens/ExportsScreen.tsx'))).toBe(false)
  })

  it('the Artifacts gallery is mounted EMBEDDED, so it grows no back button', () => {
    // `router.back()` from a tab pops out of the tab entirely — the stacked
    // page's chrome cannot come along into the shell.
    const src = read('src/screens/LibraryScreen.tsx')
    expect(src).toMatch(/<ArtifactsScreen\s+embedded/)
  })

  it('the Events page is mounted EMBEDDED, so it does not spend the top inset twice', () => {
    // LibraryScreen already pads the scope bar with insets.top. EventsScreen's
    // empty ScreenHeader exists only to spend that same inset when standalone.
    const src = read('src/screens/LibraryScreen.tsx')
    expect(src).toMatch(/<EventsScreen\s+embedded/)
  })

  it('follows a track deep link onto the Events section', () => {
    const src = read('src/screens/LibraryScreen.tsx')
    expect(src).toContain("if (hasTrackLink) setSection('events')")
  })

  it('does not smuggle in a Videoclips subsection', () => {
    const src = read('src/screens/LibraryScreen.tsx')
    expect(src.toLowerCase()).not.toContain('videoclip')
  })
})

describe('the routes that already exist keep resolving', () => {
  it('the /events tab mounts the Library shell, so `camstack://events` still lands', () => {
    // The route name stays `events`: every shared deep link
    // (`camstack://events?trackId=…&deviceId=…`) is spelled that way.
    const src = read('app/(app)/(tabs)/events.tsx')
    expect(src).toContain('LibraryScreen')
    expect(src).not.toContain('EventsScreen')
  })

  it('/artifacts stays an alias of the standalone gallery (deep links / bookmarks)', () => {
    const src = read('app/(app)/artifacts.tsx')
    expect(src).toContain('<ArtifactsScreen />')
  })

  it('/exports stays an alias — onto the gallery the exports were merged into', () => {
    // Same shape as `/artifacts`: a stacked route that still resolves, so a
    // bookmark or an old deep link does not 404. It now lands on the merged
    // gallery, which is where those exports actually are — a route that
    // resolved to a page listing nothing would be worse than a 404.
    const src = read('app/(app)/exports.tsx')
    expect(src).toContain('<ArtifactsScreen />')
  })

  it('Settings no longer BOOKMARKS Artifacts — the Library section is the way in', () => {
    // The Settings row was deleted on 2026-08-18 with the rest of the Cameras
    // section: it was a second door onto a page the Library tab already lists,
    // and the comment above it ("Artifacts stays here as a Settings bookmark")
    // was the leftover that made the duplication look deliberate. The ROUTE is
    // untouched — asserted above — so every bookmark and deep link still lands.
    const src = readSettings()
    expect(src).not.toContain("router.push('/artifacts')")
    expect(read('src/screens/library-sections.ts')).toContain("'artifacts'")
  })

  it('Settings no longer lists Exports — that page now lives in the Library', () => {
    const src = readSettings()
    expect(src).not.toContain("router.push('/exports')")
  })

  it('Settings mounts the two settings levels (the share/import section is gone)', () => {
    const src = readSettings()
    expect(src).toContain('<SettingsLevelsSection')
    expect(src).not.toContain('ViewerSettingsShareSection')
  })

  it('the camera screen never pushes the stacked /exports page', () => {
    // The theater's own export flow went with the timebar's capture menu on
    // 2026-09-02 (`TimelineToolbarInline`) — the operator took snapshot and
    // recording off a bar that now belongs to a whole VIEW rather than one
    // camera. What this file still holds is the rule that outlived it: nothing
    // routes to the stacked page, which is an alias for old deep links only.
    const src = read('src/screens/CameraDetailScreen.tsx')
    expect(src).not.toContain("router.push('/exports')")
    expect(src).not.toContain('section=exports')
  })

  it('TheaterTimeline JSDoc does not close the props type with a stray brace', () => {
    // Metro's TypeScript parse treats `*/}` as end-of-type. A 2026-08-16
    // comment "Library > Exports. */}" made `eas update` fail at export.
    const src = read('src/components/camera/theater/TheaterTimeline.tsx')
    expect(src).not.toContain('Exports. */}')
  })
})

describe('the tab bar says Library, not Events', () => {
  it('the events tab reads its label from `nav.library` while keeping its route', () => {
    // The list moved to `nav-items.ts` on 2026-08-20 — the side rail is mounted
    // by the camera detail too now, and two copies of the destinations would be
    // two answers to "which one is highlighted".
    const src = read('src/navigation/nav-items.ts')
    expect(src).toMatch(
      /\{\s*name:\s*'events',\s*href:\s*'\/events',\s*key:\s*'library',\s*segment:\s*'\/events'/,
    )
  })
})

describe('Notifications is a bottom-bar tab after Library', () => {
  it('sits between Library and Settings in the tab order', () => {
    const src = read('src/navigation/nav-items.ts')
    const items = [...src.matchAll(/name:\s*'(\w+)'/g)].map((m) => m[1])
    expect(items).toEqual(['cameras', 'grids', 'events', 'notifications', 'settings'])
  })

  it('the tab file mounts the same Notification Center the stacked route did', () => {
    const src = read('app/(app)/(tabs)/notifications.tsx')
    expect(src).toContain('NotificationCenterScreen')
  })

  it('Settings no longer pushes the stacked notifications page', () => {
    const src = readSettings()
    expect(src).not.toContain("router.push('/settings/notifications')")
  })

  it('the stacked /settings/notifications route stays an alias', () => {
    const src = read('app/(app)/settings/notifications.tsx')
    expect(src).toContain('<NotificationCenterScreen')
  })

  it('labels the tab Notifications / Notifiche', () => {
    const en = JSON.parse(read('locales/en.json')) as { nav: Record<string, string> }
    const it = JSON.parse(read('locales/it.json')) as { nav: Record<string, string> }
    expect(en.nav.notifications).toBe('Notifications')
    expect(it.nav.notifications).toBe('Notifiche')
  })
})

describe('EventsScreen is embeddable', () => {
  it('takes an `embedded` flag and drops the empty ScreenHeader for it', () => {
    const src = read('src/screens/EventsScreen.tsx')
    expect(src).toContain('embedded')
    expect(src).toMatch(/!embedded\s*\?[\s\S]*?<ScreenHeader/)
  })
})

describe('LibraryScreen wires the admin-only Retrain tab', () => {
  it('mounts RetrainScreen for the retrain section', () => {
    const src = read('src/screens/LibraryScreen.tsx')
    expect(src).toContain('<RetrainScreen')
    expect(src).toContain("import { RetrainScreen } from './retrain/RetrainScreen.js'")
  })

  it('clamps retrain the same way as review when the session lacks the feature', () => {
    const src = read('src/screens/LibraryScreen.tsx')
    // Fail-closed in ONE expression: a section the session is not offered
    // (a feature it does not hold, Scenes while its flag is off) is Events.
    expect(src).toContain("librarySectionsFor(granted).includes(section) ? section : 'events'")
    expect(src).toMatch(/visibleSection === 'retrain'/)
  })
})

describe('LibraryScreen wires the feature-gated Review tab (D921)', () => {
  it('mounts FaceReviewScreen for the review section', () => {
    const src = read('src/screens/LibraryScreen.tsx')
    expect(src).toContain('<FaceReviewScreen')
    expect(src).toContain("import { FaceReviewScreen } from './faces/FaceReviewScreen.js'")
  })

  it('gates the tab (and section param) on the hub-confirmed features — never a local guess', () => {
    const src = read('src/screens/LibraryScreen.tsx')
    expect(src).toContain("import { useGrantedFeatures } from '../data/use-me.js'")
    expect(src).toContain('const granted = useGrantedFeatures()')
    expect(src).not.toContain('const isAdmin = useIsAdmin()')
    expect(src).toContain('buildLibrarySections(t, granted)')
    expect(src).toContain("librarySectionsFor(granted).includes(section) ? section : 'events'")
    expect(src).toMatch(/visibleSection === 'review'/)
    expect(src).toContain("librarySectionFromParams(params, granted)")
    expect(src).toContain("librarySectionFromParam(params.section, granted)")
  })

  it('FaceReviewScreen does not itself re-implement an admin check — the shell already gated it', () => {
    // Every other admin surface in the app (SettingsScreen's admin rows) relies
    // on the SAME hub-confirmed session grade, never a locally-cached guess —
    // this screen inherits that guarantee from being mounted only when the
    // shell already confirmed it, rather than re-deriving admin-ness itself.
    const src = read('src/screens/faces/FaceReviewScreen.tsx')
    expect(src).not.toContain("from '../../data/use-me.js'")
    expect(src).not.toContain('useIsAdmin()')
  })
})

describe('the merged gallery carries the whole Exports feature across', () => {
  it('lists exports beside artifacts, and cards them with ExportCard', () => {
    const src = read('src/screens/artifacts/ArtifactsScreen.tsx')
    expect(src).toContain('useExportsList')
    expect(src).toContain('<ExportCard')
    expect(src).toContain('mergeLibraryItems')
  })

  it('keeps every export ACTION the deleted page had — cancel, delete, download', () => {
    // The merge must not quietly cost the operator a control. Each of these had
    // a button on the old page; losing one would look like a bug in the hub.
    const src = read('src/screens/artifacts/ArtifactsScreen.tsx')
    expect(src).toContain('useCancelExport')
    expect(src).toContain('useDeleteExport')
    expect(src).toContain('useResolveDownloadUrl')
    expect(src).toContain('useExportEvents')
  })

  it('adds the one an export never had: playback, through the SHARED viewer', () => {
    const src = read('src/components/artifacts/ExportDetailModal.tsx')
    expect(src).toContain("from '../media/MediaViewerModal.js'")
    expect(src).toContain('<MediaViewerModal')
  })

  it('answers "what can I do with this" in ONE place for both kinds of element', () => {
    // D62: a second control that disagrees with the one owning the function is
    // worse than no control. The card, the viewer and the screen all ask
    // `libraryItemActions` rather than re-deriving a state machine each.
    for (const file of [
      'src/components/artifacts/ExportCard.tsx',
      'src/components/artifacts/ExportDetailModal.tsx',
    ]) {
      expect(read(file)).toContain('libraryItemActions')
    }
    // …and the ARTIFACT card asks the same function, now that it too has a
    // delete to draw.
    expect(read('src/components/artifacts/ArtifactCard.tsx')).toContain('libraryItemActions')
  })
})

describe('an artifact can be deleted (nc.deleteArtifact, 2026-09-13)', () => {
  it('calls it over the SAME addons.custom bridge as the other nc.* artifact actions', () => {
    // A second calling convention for one addon is how two clients end up
    // disagreeing about auth and about what an error means.
    const src = read('src/data/nc-artifacts.ts')
    expect(src).toContain("call('nc.deleteArtifact', { artifactId }, NcDeleteArtifactResultSchema)")
    expect(src).toContain('NcDeleteArtifactResultSchema')
  })

  it('drops every id the hub REPORTS removed, not only the one asked for', () => {
    // Deleting a video takes its poster still with it: `removedIds` can hold
    // two ids for one card, and a poster row that outlives its video keeps a
    // thumbnail pointing at bytes the hub no longer has.
    const src = read('src/data/use-nc-artifacts.ts')
    expect(src).toContain('new Set([artifactId, ...result.removedIds])')
    expect(src).toContain('removeQueries')
  })

  it('surfaces `deleted: false` as a REFUSAL — not an error, not a success', () => {
    // The hub answers `false` for unknown / expired / not yours / global-and-
    // not-admin and deliberately does not say which, so neither does the app.
    const src = read('src/screens/artifacts/ArtifactsScreen.tsx')
    expect(src).toContain('if (!result.deleted)')
    expect(src).toContain("t('v2.artifacts.deleteRefused')")
    expect(src).toContain("t('v2.artifacts.deleteFailed')")
    // …behind the SAME confirm the export delete uses, never a second pattern.
    expect(src).toMatch(/deleteConfirmTitle[\s\S]*?destructive: true/)
  })

  it('says nothing about WHICH reason the hub refused for', () => {
    const en = read('locales/en.json')
    expect(en).toContain('"deleteRefused"')
    expect(en).not.toContain('"deleteNotFound"')
    expect(en).not.toContain('"deleteNotYours"')
  })

  it('asks `libraryItemActions` whether to draw the button, in both surfaces', () => {
    for (const file of [
      'src/components/artifacts/ArtifactCard.tsx',
      'src/components/artifacts/ArtifactDetailModal.tsx',
    ]) {
      expect(read(file)).toContain('libraryItemActions')
      expect(read(file)).toContain('actions.delete')
    }
  })

  it('leaves no comment claiming artifacts cannot be deleted', () => {
    // The leftover this replaces read as verification for a limitation that
    // had already been lifted on the hub.
    const src = read('src/screens/artifacts/library-items.ts')
    expect(src).not.toContain('There is no `nc.deleteArtifact` on the')
    expect(src).toContain('nc.deleteArtifact')
  })
})

describe('the section the operator sees is called Media', () => {
  it('labels the segment Media in both locales, while the KEY stays `artifacts`', () => {
    // The key is the `?section=` value and the `/artifacts` route that
    // bookmarks already carry — renaming it would break links for a word.
    const en = JSON.parse(read('locales/en.json')) as Record<string, never>
    const it = JSON.parse(read('locales/it.json')) as Record<string, never>
    const label = (tree: unknown): unknown =>
      ['v2', 'library', 'sections', 'artifacts'].reduce<unknown>(
        (node, part) => (node != null && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
        tree,
      )
    expect(label(en)).toBe('Media')
    expect(label(it)).toBe('Media')
    expect(read('src/screens/library-sections.ts')).toContain("'artifacts'")
  })

  it('leaves no user-facing "Artifacts" in the gallery\'s own strings', () => {
    // The screen title, the empty states and the load error all named the old
    // section. A half-done rename is how a tab and its own page disagree.
    const en = JSON.parse(read('locales/en.json')) as Record<string, never>
    const strings = ['v2', 'artifacts'].reduce<unknown>(
      (node, part) => (node != null && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
      en,
    )
    const flat = JSON.stringify(strings)
    expect(flat).not.toMatch(/artifact/i)
  })
})

describe('co-moving track groups are DELETED, not kill-switched (D330)', () => {
  it('leaves no Groups screen, component folder or data layer behind', () => {
    expect(existsSync(join(ROOT, 'src/screens/groups'))).toBe(false)
    expect(existsSync(join(ROOT, 'src/components/groups'))).toBe(false)
    expect(existsSync(join(ROOT, 'src/data/track-groups.ts'))).toBe(false)
    expect(existsSync(join(ROOT, 'src/data/use-track-groups.ts'))).toBe(false)
    expect(existsSync(join(ROOT, 'embed/src/embed/groups-as-tracks.ts'))).toBe(false)
  })

  it('leaves no kill switch and no Groups section in the Library shell', () => {
    const sections = read('src/screens/library-sections.ts')
    expect(sections).not.toContain('GROUPS_ENABLED')
    expect(sections).not.toContain("'groups'")
    expect(read('src/screens/LibraryScreen.tsx')).not.toContain('Groups')
  })

  it('calls no cap method that is off the wire', () => {
    const client = read('embed/src/embed/events-client.ts')
    expect(client).not.toContain('listGroups')
    expect(client).not.toContain('getGroup')
  })
})

describe('ArtifactsScreen is embeddable', () => {
  it('takes an `embedded` flag and drops the stacked-page header for it', () => {
    const src = read('src/screens/artifacts/ArtifactsScreen.tsx')
    expect(src).toContain('embedded')
    // The back button exists only on the stacked route.
    expect(src).toMatch(/embedded\s*\?[\s\S]*?onBack=\{\(\) => router\.back\(\)\}/)
  })

  it('keeps the filter affordance reachable when embedded', () => {
    // Hiding the header must not take the filter bar with it: every filter
    // narrows the SERVER query, so it is the only way to page a big gallery.
    const src = read('src/screens/artifacts/ArtifactsScreen.tsx')
    expect(src).toContain('<LibraryFilterBar')
  })

  it('filters the way Events does — a chip per facet, not one button over a sheet', () => {
    // The operator asked for the selected points to be VISIBLE and split out.
    // A single "Filters" pill can only say how many facets are narrowed, never
    // which, and the sheet behind it was the dimmed modal the rest of this app
    // has already moved away from.
    const src = read('src/screens/artifacts/ArtifactsScreen.tsx')
    expect(src).not.toContain('ArtifactFilterSheet')
    expect(existsSync(join(ROOT, 'src/components/artifacts/ArtifactFilterSheet.tsx'))).toBe(false)
    expect(existsSync(join(ROOT, 'src/components/artifacts/ArtifactFilterPanel.tsx'))).toBe(false)
  })

  it('REUSES the Events bar\'s chip and menu rather than drawing lookalikes', () => {
    // ONE Library filter bar: the chip, the anchored menu and the checkbox
    // list are the shared kit, and both Events and Media draw that bar — a
    // copy would let the two drift on the next change to either.
    const bar = read('src/components/ui/LibraryFilterBar.tsx')
    expect(bar).toContain("from './FilterChip.js'")
    expect(bar).toContain("from './AnchoredMenu.js'")
    expect(bar).toContain("from '../events/EventKindTree.js'")
    expect(existsSync(join(ROOT, 'src/components/artifacts/LibraryFilterBar.tsx'))).toBe(false)
    expect(read('src/screens/artifacts/ArtifactsScreen.tsx')).toContain(
      "from '../../components/ui/LibraryFilterBar.js'",
    )
    expect(read('src/components/events/EventsFilterBar.tsx')).toContain(
      "from '../ui/LibraryFilterBar.js'",
    )
  })

  it('routes "new export" to the flow that already creates one, never a second form', () => {
    // The component that creates an export is the camera timeline's selection
    // flow (`useExportSelection` + `TheaterTimeline`), where the range is drawn
    // against the coverage that exists. A create modal used to exist beside it
    // and was deleted; re-growing one here would be the second answer to "what
    // range?" that the deletion removed.
    const src = read('src/screens/artifacts/ArtifactsScreen.tsx')
    expect(src).toContain("pathname: '/camera/[id]'")
    expect(src).not.toContain('useCreateExport')
  })
})

// Cross-REPO parity guard: it reads the admin-ui of camstack-server, which
// exists only in the nested working layout (this repo checked out inside
// camstack-server). Standalone CI has no ../packages — the guard would fail on
// ENOENT there, which says nothing about the wording it pins. skipIf keeps it
// honest: enforced wherever the sibling exists, skipped where it cannot run.
//
// Il file PUNTATO e' cambiato il 2026-08-26: la ricerca globale della admin UI ha
// estratto le voci di sidebar da `AppLayout.tsx` — dove erano costanti inline
// dentro il componente — in `lib/nav-items.ts`, perche' sidebar e indice di
// ricerca chiamassero lo stesso builder invece di due liste destinate a
// divergere. La parola pinnata non e' cambiata; e' cambiato dove vive.
const ADMIN_NAV_ITEMS = '../packages/addon-admin-ui/src/lib/nav-items.ts'
const ADMIN_UI_PRESENT = existsSync(join(process.cwd(), '..', ...ADMIN_NAV_ITEMS.split('/').slice(1)))

describe.skipIf(!ADMIN_UI_PRESENT)('the admin sidebar uses the same word', () => {
  it('labels the admin Library page Library', () => {
    const src = read(ADMIN_NAV_ITEMS)
    expect(src).toContain("t('nav.library', 'Library')")
  })

  it('translates it in both admin locales', () => {
    const en = JSON.parse(read('../packages/addon-admin-ui/src/i18n/en.json')) as {
      nav: Record<string, string>
    }
    const it = JSON.parse(read('../packages/addon-admin-ui/src/i18n/it.json')) as {
      nav: Record<string, string>
    }
    expect(en.nav.library).toBe('Library')
    expect(it.nav.library).toBe('Libreria')
  })
})
