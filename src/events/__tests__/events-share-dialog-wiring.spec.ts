/**
 * Source guards for the events page's CHROME wiring: the share-link builder, the
 * filter bar, and the hub announcements that keep the native surfaces fresh.
 *
 * The grid, the reel and the detail are native now (`EventsGallery`,
 * `TrackReel`) and are covered by mounting them (`gallery/__tests__`); what is
 * asserted here on the source is plumbing no render reaches. Each assertion
 * names the defect it holds shut.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')
const readRoot = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

describe('the share-link entry point and the display menu', () => {
  it('the toolbar chip opens the LINK BUILDER, not the preview page', () => {
    // The chip is "build me the link". Once the reel renders through the embed,
    // opening a second view of it is no longer the primary thing to do with it.
    const bar = read('components/events/EventsFilterBar.tsx')
    expect(bar).toContain('onPress: onOpenShare')
    expect(bar).toContain("t('v2.eventsShare.chip')")
    expect(bar).not.toContain('onOpenEmbed')
    const events = read('screens/EventsScreen.tsx')
    expect(events).toContain('onOpenShare={() => setShareOpen(true)}')
    expect(events).not.toContain("onOpenEmbed={() => router.push('/events-embed')}")
  })

  it('the builder has ONE entry point, not two that can drift', () => {
    // It was on the chip AND in the sheet after the chip landed. Two controls
    // for one action is the shape that eventually disagrees with itself.
    expect(read('components/events/EventsFilterBar.tsx')).not.toContain("t('v2.eventsShare.openBuilder')")
  })

  it('there is no in-app embed preview: the hub-hosted page is for links and iframes only', () => {
    // The display menu used to carry an "Embed preview" row that pushed a route
    // rendering the hub-hosted page beside the native one. The page is native
    // now, so the row, the route and the screen are gone with the WebView.
    expect(read('components/events/EventsDisplayMenu.tsx')).not.toContain('/events-embed')
    expect(existsSync(join(process.cwd(), 'app/(app)/events-embed.tsx'))).toBe(false)
    expect(existsSync(join(SRC, 'screens/EventsEmbedScreen.tsx'))).toBe(false)
  })

  it('Appearance is an anchored menu like the other selectors, not a slide-up sheet', () => {
    const bar = read('components/events/EventsFilterBar.tsx')
    expect(bar).toContain("id: 'display'")
    expect(bar).toContain('render: () => <EventsDisplayMenu />')
    expect(read('screens/EventsScreen.tsx')).not.toContain('EventsDisplayMenu')
    expect(read('screens/EventsScreen.tsx')).not.toContain('onOpenDisplay')
  })

  it('the link builder is a SIBLING of the display menu, never nested in it', () => {
    // A Modal inside a Modal does not reliably present on iOS — half of why
    // the button appeared to do nothing.
    expect(read('components/events/EventsFilterBar.tsx')).not.toContain('<EventsShareDialog')
    expect(read('screens/EventsScreen.tsx')).toContain('<EventsShareDialog')
  })
})

describe('the builder hands out a snippet with a token placeholder (D895)', () => {
  const src = read('components/events/EventsShareDialog.tsx')

  it('asks for an EVENTS-VIEW token, never the grid scope', () => {
    // The two scopes are deliberately disjoint — an events link cannot open a
    // WebRTC session, a grid link cannot read a track. A `grid-view` token
    // here is what once made every generated link answer "not available to
    // share-view tokens" on the feed it exists to show.
    expect(src).toContain('kind="events-view"')
    expect(src).not.toContain('grid-view')
  })

  it('scopes the token to the link’s own cameras', () => {
    expect(src).toContain('deviceIds.length > 0 ? [...deviceIds] : cameraList.map((c) => c.id)')
    expect(src).toContain('deviceIds={scoped}')
  })

  it('builds the link with the placeholder, filled only by a token minted here', () => {
    expect(src).toContain('withTokenPlaceholder((token) => buildEventsShareUrl(serverUrl, params, token))')
    expect(src).toContain("tokenChoice?.kind === 'minted'")
    expect(src).toContain('fillTokenPlaceholder(linkTemplate, tokenChoice.token)')
  })

  it('no removed share-link route is called', () => {
    expect(src).not.toContain('createShareToken')
  })
})

describe('the builder carries the new URL params', () => {
  it('encodes window / semantic when set', () => {
    const src = readRoot('shared/events/events-share-url.ts')
    for (const param of ['smode=', 'slimit=', 'sscore=', 'since=', 'until=']) {
      expect(src).toContain(param)
    }
  })

  it('offers no order picker: a link is newest first, always (operator, 2026-10-23)', () => {
    const src = read('components/events/EventsShareDialog.tsx')
    expect(src).not.toContain('sortOptions')
    expect(src).not.toContain('sortImportance')
    expect(readRoot('shared/events/events-share-url.ts')).not.toContain('sort=')
  })
})

describe('the grid builder offers only what the shared wall can draw', () => {
  it('has no timeline-label control: the hosted wall mounts no timeline', () => {
    // `clusterLabel` styles the grid TIMELINE's cluster cards. Neither the
    // share link nor the Home Assistant card mounts a timeline, so the row
    // changed nothing in either snippet — a dead control.
    const src = read('components/grid/GridShareDialog.tsx')
    expect(src).not.toContain('ClusterLabelRow')
    expect(src).not.toContain('clusterLabel')
  })
})

describe('the builder carries the operator’s camera names', () => {
  it('the builder narrows the dictionary to the link’s own cameras', () => {
    const src = read('components/events/EventsShareDialog.tsx')
    expect(src).toContain('pickDeviceNames(deviceNamesFromCameras(cameras ?? []), deviceIds)')
    expect(src).toContain('deviceNames,')
  })

  it('the URL encoder is emitted whenever a dictionary is supplied', () => {
    // Including an EMPTY one: `names=` says "no renames" explicitly, the same
    // way `fields=` says "images only".
    const src = readRoot('shared/events/events-share-url.ts')
    expect(src).toContain('parts.push(`names=${encodeDeviceNames(params.deviceNames)}`)')
  })
})

describe('face reassignment re-pages the mounted events surfaces', () => {
  it('every face-assignment mutation broadcasts, through the BURST path', () => {
    // assign, unassign and the mass detach all change who a face belongs to.
    const src = read('data/use-face-gallery.ts')
    const calls = src.match(/reloadEventsFeedsAfterBurst\('face-assignment'\)/g) ?? []
    expect(calls.length).toBeGreaterThanOrEqual(3)
    // And NOT the immediate one: assigning faces is a burst, and the immediate
    // path re-paged the feed once per face — six reloads for eight
    // assignments, measured 2026-09-10.
    expect(src).not.toMatch(/reloadEventsFeeds\('face-assignment'\)/)
  })

  it('the hub announcement is subscribed too — another client counts', () => {
    // The local mutation cannot see a face assigned from admin-ui or another
    // device; the hub's event can. It is also what lands AFTER any async
    // retro-propagation the server does, which an immediate local call may
    // otherwise beat.
    const src = read('data/use-live-invalidation.ts')
    expect(src).toContain("'pipeline-analytics.face-gallery-changed'")
    expect(src).toContain("refreshEventsFeeds('face-buffered')")
    expect(src).toContain("refreshEventsFeeds('track-ended')")
    expect(src).toContain("reloadEventsFeeds('face-gallery-changed')")
    expect(src).toContain("[['v2', 'faces']]")
    expect(src).not.toContain("'tracks-feed'")
    expect(src).toContain("'pipeline-analytics.stationary-changed'")
    expect(src).toContain("['v2', 'analytics', 'device-tracks']")
    expect(src).toContain("['v2', 'events']")
  })
})

describe('the filter bar and the stores behind the feed query', () => {
  it('showStationary defaults off in the store and the More menu can turn it on', () => {
    const bar = read('components/events/EventsFilterBar.tsx')
    expect(bar).toContain('showStationary')
    expect(bar).toContain('setShowStationary')
    expect(bar).toContain("id: 'more'")
    const store = read('store/events-filter-store.ts')
    expect(store).toContain('showStationary: false')
  })

  it('the page selects the store snapshot, not a mapped array (Library crash)', () => {
    // An inline `Object.entries(s.statuses).filter…map` selector returns a NEW
    // array on every zustand read. Object.is then always fails → infinite
    // re-render.
    const src = read('screens/EventsScreen.tsx')
    expect(src).toContain('useDebugStatusStore((s) => s.reviewedIds)')
    expect(src).not.toMatch(/useDebugStatusStore\(\(s\) =>\s*Object\.entries/)
  })
})

describe('filter chips open anchored menus, not one Filters sheet', () => {
  it('the bar has no general Filters chip and opens AnchoredMenu per facet', () => {
    const bar = read('components/events/EventsFilterBar.tsx')
    expect(bar).not.toContain("t('v2.events.filters'")
    expect(bar).not.toContain('onOpenSheet')
    // The facets are DECLARED; the shared Library bar opens each one's
    // AnchoredMenu on its own chip.
    expect(bar).toContain('<LibraryFilterBar')
    expect(read('components/ui/LibraryFilterBar.tsx')).toContain('<AnchoredMenu')
    for (const id of ['cameras', 'classes', 'more', 'display']) expect(bar).toContain(`id: '${id}'`)
    expect(bar).not.toContain("id: 'search'")
  })

  it('EventsScreen does not mount the sheet or a split filter rail', () => {
    const events = read('screens/EventsScreen.tsx')
    expect(events).not.toContain('EventsFilterSheet')
    expect(events).not.toContain('EventsFilterPanel')
  })

  it('Faces/Plates live in Classes; parked and flags live in More', () => {
    const bar = read('components/events/EventsFilterBar.tsx')
    const classesMenu = bar.slice(bar.indexOf('const classesBody'), bar.indexOf('const filters'))
    expect(classesMenu).toContain('EVENTS_ATTRIBUTES')
    expect(classesMenu).toContain('toggleAttribute')
    expect(classesMenu).toContain('attrFaces')
    expect(bar).toContain('filter.attributes.length')

    const moreFacet = bar.slice(bar.indexOf("id: 'more'"), bar.indexOf('const sortLabel'))
    expect(moreFacet).toContain("t('v2.events.more'")
    expect(moreFacet).toContain("t('v2.events.parked'")
    expect(moreFacet).toContain('setShowStationary')
    expect(moreFacet).toContain('flagChips.map')
  })

  it('carries no `entity` switch: co-moving track groups were deleted (D330)', () => {
    // The feed carries exactly one row kind — tracks. A second entity value
    // whose cap methods are off the wire is what D330 forbids leaving behind.
    for (const rel of [
      'screens/EventsScreen.tsx',
      'components/events/EventsFilterBar.tsx',
      'components/events/gallery/EventsGallery.tsx',
      'components/events/track/TrackReel.tsx',
      'data/use-events-gallery-feed.ts',
    ]) {
      expect(read(rel)).not.toContain('EventsEntity')
      expect(read(rel)).not.toContain("'groups'")
    }
  })
})
