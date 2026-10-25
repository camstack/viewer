/**
 * Source guards for the Events page's CONFIRMED search + the track-feed
 * refresh economy (2026-08-08). The viewer cannot mount components (vitest node
 * env, no renderer), so the wiring is asserted on the source in the style of
 * `track-trajectory-wiring.spec.ts`. Each assertion names the defect it holds
 * shut.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('the semantic search runs on CONFIRM, never per keystroke', () => {
  it('EventsScreen no longer debounces the raw field into the query', () => {
    // It used to be `useDebouncedValue(searchText, 350)` → useSemanticSearch,
    // i.e. one server-side CLIP embedding + result set per pause in a word,
    // all but the last discarded, against the hub this page is already the
    // heaviest client of.
    const src = read('screens/EventsScreen.tsx')
    expect(src).not.toContain('useDebouncedValue')
    expect(src).not.toContain('SEARCH_DEBOUNCE_MS')
  })

  it('the query the search runs on is the APPLIED value, not the draft', () => {
    const src = read('screens/EventsScreen.tsx')
    // The onboard CLIP results view and its `useSemanticSearch` hook went with
    // the onboard renderer on 2026-08-18; the applied query is now handed to
    // the feed query, which runs the search server-side. The CONFIRM rule is
    // unchanged and is what this file is about — the draft must never reach it.
    expect(src).toContain('search: appliedSearch,')
    expect(src).toContain("searchMode: appliedSearch.length > 0 ? 'semantic' : 'text'")
    expect(src).not.toContain('search: searchText')
    // The draft still exists — the field has to hold something while typing.
    expect(src).toContain('const [searchText, setSearchText] = useState')
    expect(src).toContain('const [appliedSearch, setAppliedSearch] = useState')
  })

  it('the bar offers BOTH confirm affordances and an immediate clear', () => {
    const src = read('components/events/track/SemanticSearchBar.tsx')
    // Keyboard submit (the `search` return key on mobile) …
    expect(src).toContain('onSubmitEditing={submit}')
    expect(src).toContain('returnKeyType="search"')
    // … and a tappable confirm.
    expect(src).toContain('onPress={submit}')
    // Clearing must NOT wait for a confirm: the X is how you get the grid back.
    expect(src).toContain('onPress={onClear}')
  })

  it('EventsScreen clears the draft AND the applied query together', () => {
    // Clearing only the draft would leave the results view up with an empty
    // box — the state the operator cannot get out of.
    const src = read('screens/EventsScreen.tsx')
    expect(src).toMatch(/clearSearch\s*=\s*useCallback\(\(\)\s*=>\s*\{\s*setSearchText\(''\)\s*setAppliedSearch\(''\)/)
  })
})

describe('the label filter chip is gone — the page bar is the only search', () => {
  it('EventsFilterBar has no second Search chip', () => {
    const src = read('components/events/EventsFilterBar.tsx')
    expect(src).not.toContain('setLabelDraft')
    expect(src).not.toContain("openMenu('search'")
    expect(src).not.toContain("t('v2.events.search'")
  })
})

/**
 * The refresh-economy guards that used to close this file are GONE, deliberately.
 *
 * They bounded an in-app infinite track feed: the events page's anchor bump
 * rate against the reel's, the reel's focus gate, and the `projection: 'slim'`
 * on the merged `listTracks` request. All three described `use-tracks.ts` /
 * `use-reel-refresh.ts`, deleted on 2026-08-18 with the onboard renderer — the
 * viewer no longer fans a track feed out over cameras at all. The embed owns
 * its own polling, inside the WebView, on its own release chain.
 *
 * Nothing replaces them here because there is nothing left in THIS repo for
 * them to guard. If a second in-app feed ever appears, it needs its own.
 */
