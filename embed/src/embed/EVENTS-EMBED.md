# Events embed — host integration reference

`/viewer/camstack/embed/index.html?mode=events`

An embeddable, chrome-less track/event surface served by the **stream-broker**
addon out of the same bundle as the live grid and the player. Same data plane,
same auth story, same message transport — see
`docs/design/2026-08-08-events-embed.md` for the design record and why the
distribution model was inherited rather than reinvented.

Files:

| Concern | File |
| --- | --- |
| Page | `src/pages/EmbedEventsPage.tsx` |
| Card | `src/components/EventsCard.tsx` |
| Config contract | `src/embed/events-config.ts` |
| Query-param config | `src/embed/events-url-config.ts` |
| Message protocol | `src/embed/events-messages.ts` |
| Paging / delta / window / sort (pure) | `src/embed/events-feed.ts` |
| Row normalisation + filters (pure) | `src/embed/events-track-row.ts` |
| Class → macro taxonomy (pure) | `src/embed/events-taxonomy.ts` |
| CLIP result normalisation (pure) | `src/embed/events-semantic.ts` |
| Authenticated images | `src/embed/use-authed-image.ts` |

---

## 1. Getting the config in

Three sources, in precedence order.

**a. Native WebView** — inject before load:

```js
window.__CAMSTACK_EVENTS__ = { serverUrl: 'https://hub:4443', token: '<jwt>', view: 'reel' }
```

**b. URL** — works standalone *and* inside an `<iframe>`:

```
https://hub:4443/viewer/camstack/embed/index.html?mode=events&v=1&view=gallery&thumb=medium&cols=auto#t=<jwt>
```

The token rides the **fragment**, never the query string: a fragment is not sent
to the server, so it never reaches hub access logs, proxy logs or referrers. The
page strips it from the address bar (`history.replaceState`) after reading.

> **A share token must carry an `events-view` grant.**
> `auth.mintToken({ label, expiresIn, scopes: [{ type: 'share-view', grant: { kind: 'events-view', deviceIds: [...] } }] })`.
> A `grid-view` token is refused on every events method — deliberately, so that
> links already handed out for a camera wall do not silently start serving event
> history. See §6.

**c. iframe handshake** — the embed posts `{type:'embed-ready', mode:'events'}`
to `parent`; the host replies `{type:'embed-config', config:{…}}`. Any `v=1`
query params on the iframe `src` are then applied **on top** of that config, so a
host can put the look in the URL and only the credentials on the channel.

### v1 query params

| Param | Values | Maps to |
| --- | --- | --- |
| `v` | `1` (**required** to treat the URL as a config) | — |
| `view` | `reel` \| `gallery` | `view` |
| `rows` | `1..6` (reel) | `rows` |
| `cols` | `auto` \| `1..12` (gallery) | `columns` |
| `thumb` | `small` \| `medium` \| `large` | `thumbSize` |
| `devices` | csv of device ids; empty = all | `deviceIds` |
| `classes` | csv of class ids; empty = all | `classes` |
| `q` | free text (or the CLIP query when `smode=semantic`) | `search` |
| `smode` | `text` \| `semantic` | `searchMode` |
| `slimit` | `1..200` | `semanticLimit` |
| `sscore` | `0..1`; **absent = the server's default** — per embedding model from D649 (0.2 today, MobileCLIP) | `semanticMinScore` |
| `since` | ms; **empty = clear** | `sinceMs` |
| `until` | ms; **empty = clear** | `untilMs` |
| `names` | `<id>:<name>,<id>:<name>`, each NAME percent-encoded | `deviceNames` |
| `fields` | csv allow-list of `label,sublabel,camera,time,badges,importance` (`importance` is off unless listed) | `fields` |
| `tileLabelMode` | `off` \| `icon` \| `label` — the viewer's Events setting, same name and values. Absent = legacy `fields.label` (`label`) | `tileLabelMode` |
| `tileDetailCamera` | `1`/`0` — camera name under the picture. Absent = legacy `fields.camera` | `tileDetailCamera` |
| `tileDetailZone` | `1`/`0` — zone chip under the picture. Absent = legacy `fields.badges` | `tileDetailZone` |
| `page` | `1..500` | `pageSize` |
| `max` | `1..5000` | `maxRows` |
| `refresh` | ms, `0` = off | `refreshMs` |
| `age` | ms | `maxAgeMs` |
| `theme` | `auto` \| `dark` \| `light` | `theme` |

`fields=` is an **allow-list**: keys present are on, everything else off. An
empty `fields=` therefore means "images only" — a real ask, and why absence must
stay distinguishable from emptiness.

The three `tile*` params are the viewer's own component settings
(`shared/events/events-tile-display.ts` — one model, read by the app's
`EventsPreferences`, this parser and the share-link builder). When present they
win over the legacy `fields` flags; `fields` keeps `time`, `importance` and
`sublabel` (default **off** since the viewer has no such line).

---

## 2. embed → host messages

Every outbound message carries `v: 1`. Native hosts receive a JSON **string** via
`ReactNativeWebView.postMessage`; web hosts receive the object via
`parent.postMessage(msg, '*')`.

```ts
{ v:1, type:'ready',        view:'reel'|'gallery', features:string[] }
{ v:1, type:'error',        message:string }
{ v:1, type:'state',        state:'loading'|'ready'|'empty'|'error', message?:string }
{ v:1, type:'trackClick',   trackId:string, deviceId:number, bestEventId:string,
                            className:string, firstSeen:number, lastSeen:number }
{ v:1, type:'countChanged', loaded:number, shown:number, hasMore:boolean,
                            mode:'feed'|'semantic' }
```

`features` is the capability list of the LOADED build — currently
`['window','semantic-search','macro-classes','device-names', …]`. It exists because the
viewer and the embed ship on different chains: a host that wants day navigation
must be able to tell a new embed from a deployed old one without sending a
command into silence. **A host should gate new commands on it**, and an absent
`features` means an embed older than this protocol revision.

`countChanged.mode` says WHICH feed produced the rows. `semantic` means they are
CLIP hits — a complete result set, not a page, so `hasMore` is always false and
a host must not render a "load more" affordance.

`bestEventId` is the id the event-media plane resolves the crop against — it
falls back to the `trackId` when the track produced no object events, so a host
can open a detail view straight from a `trackClick` with no extra round-trip.

There is also a non-versioned `{type:'log', scope:'events', msg, data}` on the
shared log channel the player and recording pages already use.

**v1 stability rule:** fields may be **added** (a host ignores what it does not
know); removing or retyping one requires `v: 2`.

## 3. host → embed commands

Web: `iframe.contentWindow.postMessage({ type:'embed-command', command }, origin)`.
Native: call the API the page installs on `window` from injected JS.

| Command | `window.__camstackEvents` |
| --- | --- |
| `{type:'setConfig', patch}` | `setConfig(patch)` |
| `{type:'setWindow', sinceMs?, untilMs?}` | `setWindow({sinceMs, untilMs})` |
| `{type:'refresh'}` | `refresh()` |
| `{type:'reload'}` | `reload()` |
| `{type:'loadMore'}` | `loadMore()` |
| `{type:'scrollToTop'}` | `scrollToTop()` |

`patch` is validated against `eventsConfigPatchSchema`; an invalid patch is
**ignored whole**, never partially applied. `serverUrl` and `token` are not
patchable — swapping the identity of a mounted embed is a remount.

`refresh` is incremental. `reload` is the only thing that drops the feed.

### Day navigation (`setWindow`)

Three states per bound, and they are **all different**:

```js
setWindow({ sinceMs: startOfDay, untilMs: endOfDay })  // pin to a day
setWindow({ untilMs: endOfDay })                        // move one bound only
setWindow({ sinceMs: null, untilMs: null })             // CLEAR → rolling feed
setWindow({})                                           // no-op
```

Both bounds ride the REQUEST (`since`/`until` on `listRecentTracks`) — a day
view never materialises a row outside its day and then hides it. Changing the
window RESETS the feed (a cursor issued for one window is meaningless against
another), and a window CLOSED in the past also stops the incremental poll: a
finished day cannot gain rows.

> **Pinning `sinceMs` makes the day a cage, and the cage dead-ends.** The feed
> exhausts the calendar day, `listRecentTracks` truthfully answers
> `nextCursor: null`, and the tail draws `· fine ·` at 00:00 with the rest of
> history one request away. The viewer's own events page therefore pins the
> UPPER bound only (`dayWindowFor`): the day says where the list STARTS, and the
> cursor walks past midnight into the previous days by itself. Pin both only
> when you genuinely want one day and nothing else — a share link for a single
> date.

### Order

There is no order knob: the feed is newest first, always — the server's own
order (`lastSeen` DESC), the one pagination walks. A `sort` from an older host
(`setConfig`) or an old link (`sort=`) is ignored, not refused, so neither
breaks; the page stays newest first.

### Semantic (CLIP) search

`setConfig({ searchMode: 'semantic', search: 'red car' })` runs
`pipelineAnalytics.searchObjectEvents` — the same cap the viewer's own search box
calls — and **unions** its hits with the rows the same query matches as free
text, then orders the union newest first. `searchMode: 'text'` (the default) runs the client-side
substring filter alone.

- ONE request. The cap takes a single optional `deviceId` and omitting it
  searches every camera, so this is not a per-camera fan-out. With exactly one
  camera configured, the embed pins it.
- Hits are deduplicated by track, best score wins — one subject crossing a frame
  is many matching detections of one crop.
- A hit is an EVENT, not a track: `zonesVisited`, `zoneNames`, `audioLabels` and
  `active` render empty rather than being faked from a second query.
- **The text half exists because CLIP embeds IMAGES**, so it is structurally
  blind to the audio labels, the zone names, a plate read and the camera name.
  Measured on the live hub: `crying` is an audio label on 92 tracks in 7 days and
  `searchObjectEvents('crying')` returned an unrelated person at 0.22 as its top
  hit — so a semantic-only box answered "nothing" for a word literally written on
  92 tracks. A track that matched both ways is shown once, as the TEXT row: that
  one is a whole track, the CLIP row is a single event.
- **The result is ordered newest first, never by the score.**
  Relevance decides WHICH rows come back (`slimit` and, when set, `sscore` ride the request);
  it does not decide the order they are drawn in. The card shows a time and no
  score, so a relevance ranking is invisible on screen and reads as a scrambled
  list — the operator reported exactly that. Newest first governs the feed, a
  text filter and a search result alike, and the host's detail prev/next walks that
  same order. See `mergeSearchRows`.
- The text half can only cover rows the feed has LOADED; it widens a semantic
  search, it does not complete it.
- **`sscore` absent = the server's default.** The embed sends no `minScore`
  unless the URL, a share link or `setConfig` set one, and the hub applies its
  own floor: 0.2 today, and from D649 resolved per embedding model (MobileCLIP
  0.2, SigLIP2 about 0.1). The scales differ, so a fixed default here would be
  right for one model and empty most results of the other. An explicit
  `sscore` is still sent verbatim; `setConfig({ semanticMinScore: null })`
  unsets it again.
- The class filter applies to both halves.
- An empty `search` makes the mode inert.

### Local camera renames (`deviceNames`)

The viewer lets an operator rename a camera locally. That override is
client-side, so an embed rendering the hub's names silently disagrees with every
other surface in the app.

```js
setConfig({ deviceNames: { '101': 'Front door', '104': 'Cortile' } })
```

Keyed by the id **as a string** (this crosses `JSON.stringify` on both
transports, where numeric keys do not survive as numbers). A present key wins
over the server name; anything absent falls back, so a partial dictionary is
fine and `{}` is a no-op. The patch REPLACES the dictionary rather than merging
it — a rename removed on the host has to be able to disappear here.

It is a render-time fact, not a fetch-time one: a rename applied at runtime
re-labels rows that are already on screen, without a refetch. The free-text
search reads the same name, so typing the rename finds the camera.

Applies to the CAMERA name. A synthetic track's `producingDeviceName` arrives on
the row without an id, so it is left alone rather than guessed at.

Send only the cameras that were actually RENAMED (`name !== originalName`) —
the fallback covers everything else, so a full dictionary is just a longer URL.

For share links the dictionary rides `names=` so the recipient sees the
operator's names too:

```
&names=101:FrontDoor,102:Garage%2C%20retro,104:Sala%3A%20TV
```

**The contract is SINGLE-encode: `encodeURIComponent` per NAME, id plain.**
Nothing else — do not double-encode.

The parser reads `names` from the RAW query string, before any percent-decoding,
so `%2C` and `%3A` inside a name cannot be confused with the `,` and `:`
separators. Reading it through `URLSearchParams.get()` would not work: that
decodes first, and by then `Garage, retro` is indistinguishable from two
entries — which is exactly the bug the viewer author caught by round-tripping
his encoder against this parser (`{"102":"Garage"}` plus a junk entry). It is
fixed here, tested with comma / colon / accents / ampersand / empty-dictionary
vectors, and hosts must NOT compensate for it.

### Class filtering expands through the server taxonomy

The class filter and the free text both resolve a class to its FAMILY via
`pipelineAnalytics.listEventKindsBatch` (`kind` → `parentKind`) — the same source
the viewer's picker is built from. Selecting `vehicle` keeps a track stored as
`truck`; typing `vehicle` finds it too. Expansion is one-way, UPWARD: a `truck`
never matches `car`.

Audio labels are stored bare (`dog_bark`) and matched by their namespaced id
(`audio-dog_bark`) plus the bare `audio` macro — which is what a picker emits.

If the taxonomy fails to load (older hub, error) the filter degrades to an
exact-id compare: narrower, never empty. It is logged.

---

## 4. Data + the two things that are easy to get wrong

The feed is `pipelineAnalytics.listRecentTracks` with `projection:'slim'` — ONE
merged request per page across every selected camera.

**Paging is by cursor, not by time window.** `nextCursor` returns exactly the
rows after the last one delivered and `null` means exhausted. The window-walking
alternative silently hides the older tracks inside a window that filled its
budget, and nothing on screen can tell that from "there were no more".

**The fan-out budget is the client's problem too.** `TrackStore.queryRecent`
caps what it materialises at `deviceCount × limit ≤ 2000` and quietly serves a
shorter page. `resolveEventsPageLimit` mirrors that rule so the ask is honest;
`nextCursor` — never the page length — decides whether more exist.

**Refresh never restarts the feed.** It asks for `since = rows[0].lastSeen`
(inclusive, so same-millisecond ties cannot slip through) and merges by
`trackId`, replacing rows whose `lastSeen` advanced. A delta that comes back
with a cursor is drained (bounded at 5 pages, and hitting the bound is logged).

**Images are fetched, not `src`-ed.** The event-media plane requires
`Authorization: Bearer`, which an `<img src>` cannot carry; `use-authed-image.ts`
fetches with the header and renders an object URL from a bounded, revoking LRU.

---

## 5. Card composition — parity with the native card

Both layouts render the same information in the same priority as the viewer's
`TrackCard`, respecting the field toggles element by element:

| Element | Setting | Where |
| --- | --- | --- |
| Class **glyph** | `tileLabelMode` `icon`/`label` | accent pill, bottom-left of the hero |
| **Finest label** | `tileLabelMode` = `label` | chip replacing the glyph — only when it says more than the class |
| Audio enrichment glyphs | `tileLabelMode` ≠ `off` | chips, gallery only |
| **Time** | `fields.time` | chip on the **top-right corner** of the hero (as the viewer tile), both layouts |
| Active dot | `fields.badges` | top-right, beside the time |
| Favourite / admin flags | — | top-left |
| Caption | `fields.sublabel` (default off) | under the hero |
| **Camera name** | `tileDetailCamera` | under the hero, one line scaled to the tile width (`fitTileText`), two lines at the 9 px floor |
| Zone chip | `tileDetailZone` | under the hero |

The gallery grid is tight (3 px gaps, 4 px outer padding) so the picture
dominates; the reel keeps its host-reserved 8 px geometry.

**The caption says only what the thumbnail does not.** The old rule ("the class
when the title is finer, else the audio labels") predates the glyphs, and once
those shipped it began transcribing them — an audio card showed speech+music as
glyphs *and* `speech, music` as text; a vehicle card showed the `car` glyph, the
`Car` pill, *and* the caption `vehicle`, which was the coarsest of the three.

So the rule is positional, not content-guessing: when `fields.label` is on, the
glyph carries the class, the pill carries the finest label and the audio glyphs
carry the audio — the caption has nothing left and renders nothing. When
`fields.label` is off (a host that wants no chips but does want a text line),
the caption becomes the only carrier and says `subLabel ?? label ?? className`
plus any audio the title does not already contain.

The reel keeps only the glyph + finest label over the hero and the time in its
one-line footer — the native reel's own composition, and all its reserved height
allows.

Glyphs come from `@camstack/ui-library`'s `resolveEventKindIcon` — the WEB half
of the same 65-id map the viewer uses natively (verified byte-identical), so the
same class gets the same glyph on both surfaces. `lucide-react` is a direct
dependency and tree-shakes into the bundle: **no CDN, no runtime fetch**. The
glyph id comes from the taxonomy descriptor's `iconId` when the hub declares one
(so a class the hub learns tomorrow gets the right icon with no redeploy), else
the class id itself, else the neutral `Tag`.

## 5b. The three states

`loading` means "no fetch has settled", never "no rows yet" — the distinction is
why every embed used to flash **No events** for a beat on boot (`deviceIds` is
empty while the camera list is in flight, and the feed reported itself
not-loading with nothing to fetch).

| State | Shown when | Rendered as |
| --- | --- | --- |
| loading | no fetch has settled — including while `listDevices` is still out, and while a CLIP query is in flight over a page already on screen | skeleton tiles in the real grid shape |
| empty | a fetch settled with zero rows (or the camera list resolved to none) | "No events" |
| error | the feed failed | the error text, in red |

Error wins over empty: "the node did not answer" and "this camera was quiet" are
different sentences and only one is worth acting on. The host is told the same
thing via `state` (`loading` / `empty` / `error`).

A `loading` is reported for a SEARCH too, so the host's own placeholder covers a
page the operator is already reading. That is why the viewer host anchors its
skeleton at the top (`events-embed-skeleton.ts`): a centred one clips its own
first row and reads as a grid growing out of the middle of the screen.

### Images: viewport first, then a bounded downward preload

Two mechanisms, and the split is the point:

| | What | Rate |
| --- | --- | --- |
| **eager** | everything on screen **plus one full viewport** ahead | on demand |
| **preload** | everything below, in render order | 4 at a time, pauses while scrolling |

The margin is measured from the scroller (`clientHeight`), not a fixed 600 px —
the same constant is a screen and a half on a phone and a third of one on a
tablet, i.e. two different policies. "One viewport ahead" is one policy
everywhere.

Both go through `loadAuthedImage`, which dedupes in flight and caches by URL, so
a preloaded tile costs nothing when its card mounts and a card that mounts
mid-preload joins the same promise instead of racing it. The preloader yields
while the user scrolls (a visible tile is a request; a preload is a guess) and
resumes from where it stopped, never from the start.

### Images load with the viewport

A card fetches its thumbnail only once it comes within 600 px of the scroller.
Measured against the live hub with the default 60-row page:

```
  ALL 60 CONCURRENT    13 608 ms   (median single request 11 664 ms)
  FIRST 12 ONLY           659 ms
```

Total payload is 423 KB, so this was never bandwidth — each thumbnail is
server-rendered (`makeSquareThumb` re-encodes a ~90 KB source) and sixty at once
queue on the addon's event loop, so every one waits for the whole batch. Same
bytes, twenty times sooner.

It fails OPEN: a card that cannot be observed (no `IntersectionObserver`, or a
scroller with no measurable extent — a host rendering the embed off-screen)
loads immediately. An unobservable tile with no picture is a worse failure than
an early fetch.

### Pull to refresh

Gallery only, and it runs INSIDE the embed. Overscroll at the top past ~56 px
(after 0.5 damping) triggers the incremental `refresh` — what is new, never a
reload.

It is purely observational: it reads `scrollTop` and the finger delta and never
calls `preventDefault`, because cancelling a `touchmove` on iOS kills momentum
scrolling for the whole gesture — the classic way a hand-rolled pull-to-refresh
ruins a list. The listeners are registered `passive`.

**Why not a native `RefreshControl` above the WebView**: a `RefreshControl`
belongs to a native scroll view, so the WebView would have to live inside one,
and nested `UIScrollView` ↔ `WKWebView` scrolling is the least reliable
arrangement on iOS — the outer view cannot know when the inner list is at its
top, so it either steals the gesture mid-list or never fires. The embed owns its
scroller and knows `scrollTop` exactly. Keeping it here also gives the web
`<iframe>` host the gesture for free.

### The tail

Infinite scroll needs the user to be able to tell "more is coming" from "that
was everything", so the end of the list carries one of two things:

| Tail | testid | Shown when |
| --- | --- | --- |
| skeleton tile + spinner | `tail-loading` | a NEXT page is in flight (`loadingMore`) and rows are already on screen |
| `· fine ·` | `tail-end` | the SERVER said `nextCursor: null` and rows are on screen |
| "Load older events" | `tail-more` | the in-memory `maxRows` ceiling was reached — there IS more |
| retry | `tail-error` | the page request failed after its retries, with rows on screen |

**Those last three are three different sentences and must never share one.**
`hasMore` folds "exhausted" and "ceiling" into one boolean; the surface reads
`tail` (`more` / `exhausted` / `ceiling`) instead. With the old `maxRows` of 600
a busy deployment filled the budget a few hours into the day, and drawing
`· fine ·` there told the operator they had reached the beginning of history —
reported as "the events page only goes back as far as 17:30". A FAILURE outranks
both: a feed that could not fetch knows nothing about whether more exist, so it
never renders an end marker. The `· fine ·` tail is also why the full-surface
error state is reserved for an EMPTY surface — an overlay across a list the
operator is still reading says the same thing worse.

`tail-more` is now rare rather than routine: see *The row ceiling* below.

The next page is requested ONE FULL SCROLLER ahead (`sentinelMarginPx` reads
`clientHeight` / `clientWidth`, floor 400 px), for the same reason the image
preloader measures instead of using a constant: 400 px is two card rows on a
phone and a fraction of one on a wall display.

The reel's tails flow inside its grid, at the right-hand end of the strip; the
gallery's sit below the virtualized rows and the bottom spacer, which is the
true end of the list. Neither appears in semantic mode — a CLIP result set is
complete, not paged, and a "loading more" there would promise a page that never
comes. Neither appears while the FIRST page is loading either: the full-surface
skeleton owns that moment, and showing both would be two affordances for one
request.

### The gallery is virtualized; the reel is not

The gallery mounts only the grid rows near the viewport (visible + two rows of
overscan at each end) and stands two spacer divs in for the rest, so
`scrollHeight` — and therefore the scrollbar — still describes the whole list.
Three pieces, and only three:

| Piece | Where | Answers |
| --- | --- | --- |
| `galleryGeometry` | `events-reel-window.ts` | how many COLUMNS, how wide, and the fallback row height |
| `galleryVirtualWindow` | `events-reel-window.ts` | which ROWS render, and the two pad heights |
| `useGalleryRows` | `use-gallery-rows.ts` | what a rendered row actually MEASURED |

The grid renders `repeat(n, minmax(0, 1fr))` from `galleryGeometry` rather than
`auto-fill`, because chunking a flat list into grid rows needs a column count JS
knows rather than guesses. The image preload window is derived from the row
window for the same reason: two windows over one list, one measured and one
estimated, drift the moment a caption wraps.

**Rows are MEASURED, not assumed.** The tile's hero is square, but under it the
caption line is optional, the camera name clamps at one *or* two 15 px lines and
a zone chip adds another ~17 px — two rows of one feed differ by up to ~30 px,
and a fixed stride over that walks off the end of the list. A rendered row is
measured and remembered by row INDEX (an append only adds higher indices, so
nothing already on screen moves); a row nobody has seen is the running average
of the ones who have.

An UNMEASURED scroller (`clientHeight === 0`: the OTA HTML painting before the
WebView is sized, a host rendering the embed with no layout) is **not windowed**
— a window from a viewport of unknown size would hide rows it cannot prove are
off-screen. It costs nothing: the auto-fill refuses to page a zero-extent
scroller anyway.

The REEL is deliberately left alone. It mounts every card it holds, which is why
its ceiling stayed where it was.

### The row ceiling

`maxRows` is what stops automatic pagination (the cursor is kept, nothing is
dropped). It now means two different things per view, resolved by
`resolveMaxRows`:

| View | Bound | Why |
| --- | --- | --- |
| `gallery` | **5 000** (`DEFAULT_EVENTS_MAX_ROWS`) | memory: the DOM is windowed |
| `reel` | **600** (`REEL_EVENTS_MAX_ROWS`) | the DOM: every card is mounted |

At 5 000 gallery rows the cost is ~4 MB of retained row objects and derived
arrays, a flat ~40 mounted cards, an unchanged 250-entry object-URL LRU
(`use-authed-image` revokes what it evicts) and ~1 MB of `trackList` JSON posted
to the host per appended page. That last one is what actually bounds this: the
host is handed the whole ordered collection on every append, so the Nth page
costs O(N). It is not "unbounded" — it is 5 000, it is `maxRows`' own schema
maximum, and at a 60-row page that is ~83 pages.

## 6. Sizing — the reel is a REPRODUCTION of the native card

`thumbSize` resolves to the viewer's own `REEL_THUMB_SIZE_PX`:
**small 80, medium 106, large 132 CSS px**. Those are not a taste; the host
reserves its strip from them (`reelRowHeight(cardWidth)` = `cardWidth + 3*2 +
14 + 4*2` → 108 / 134 / 160) and anything taller is silently cut.

That is exactly how "the embed shows no time" happened: the card rendered at
96 px in a strip sized for 80, so the footer — the time — sat below the fold. It
was rendered the whole time.

So in `view: 'reel'` the card mirrors the native one line for line: a square
hero with the caption OVERLAID on the image, and a one-line footer holding
`HH:MM` (11 px on an explicit 14 px line, tabular numerals). `view: 'gallery'`
keeps the stacked tile layout, which has the room.

The media plane is asked for `cardEdge × devicePixelRatio` (clamped to
[64, 320]) — physical pixels, measured from the running view, so a 2x WebView
gets a 160 px image for an 80 px tile instead of a soft upscale.

### On a desktop-wide frame the reel sizes itself

Below 768 px of width the preset above is the card, verbatim — a phone band was
reserved from it. From 768 px up the reel computes the edge from the box it was
given (`events-reel-geometry.ts`): the largest square hero whose card fits
`rows` times in the frame height (never below the preset, never above 264 px),
then the fewest whole columns that cover the width, stretched so they end
exactly at the right edge. A dashboard iframe 1512 × 300 gets six 242 px cards
instead of fourteen 106 px ones and a cut fifteenth; a band reserved for the
preset never grows (it can only shrink a few px so the columns fit whole).


---

## 7. Share links — what a share-view token can and cannot do

A shared page authenticates as a restricted principal gated by a fail-closed
enumeration (`server/backend/src/api/trpc/share-view-access.ts`). The events
surface has its **own scope kind**:

```js
auth.mintToken({
  label: 'Front events',
  expiresIn: 30 * 86400,
  scopes: [{ type: 'share-view', grant: { kind: 'events-view', deviceIds: [101, 102] } }],
})
```

There is one token format (D895): a share link is a minted token whose ONLY
scope is a share-view grant. The viewer's share dialogs mint one, or reuse one
listed by `auth.listTokens` whose grant covers every camera of the view.

`events-view` grants exactly the five methods the embed calls — `auth.me`,
`deviceManager.listAll`, `pipelineAnalytics.listRecentTracks`,
`listEventKindsBatch`, `searchObjectEvents` — and nothing else. It is **not** a
superset of `grid-view` and `grid-view` is not a superset of it: an events link
cannot open a WebRTC session, and a grid link cannot read a track. That
separation is the point — a link minted for a camera wall must not gain event
history because a new surface shipped.

How the device scope is enforced, per input shape:

| Input | Rule |
| --- | --- |
| `deviceIds[]` (feed, taxonomy) | **Intersection.** At least one in-scope device ⇒ allowed, and the response is stripped to the scope. Fully disjoint ⇒ `FORBIDDEN` (an empty page would read as "no events", not "not yours"). |
| `deviceId?` (CLIP search) | Present ⇒ must be in scope. **Absent ⇒ allowed** — it searches every camera, and the RESPONSE is cut server-side. The caller is never trusted to scope its own query. |

Practical consequence for a host: you do not need to intersect `deviceIds`
yourself. `deviceManager.listAll` is already projected to the scope, so the
embed's "all cameras" resolution (`deviceIds: []`) lands exactly on the share's
devices.

### Thumbnails

The event-media data plane opts in to `events-view` share tokens: the hub's
gate validates the token and hands the plane the grant's devices, so a shared
page loads the images of its own cameras and nothing else.

### Semantic search on a wide share link

A CLIP query is answered by the server across the whole deployment and then cut
to the scope, so the `limit` is spent BEFORE the cut: a share covering 2 of 30
cameras can get few or no hits from a 50-result query even when matches exist on
its cameras. Pin the search to one camera (`deviceIds: [n]` on the embed, which
makes it send `deviceId`) when that matters. Fixing it properly means pushing
the scope into the cap's own query — server-side.
