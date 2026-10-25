/**
 * events-feed-limits — how big the events feed is allowed to get, for every
 * surface that pages it (the hub-hosted embed and the app's native gallery and
 * reel). One set of numbers: two surfaces with their own page size would
 * disagree about what "the first screen" costs.
 */

/** Default page size. Deliberately SHORT: the merged feed is fan-out bounded
 *  server-side (see `events-feed.ts`), and a short page paints sooner. */
export const DEFAULT_EVENTS_PAGE_SIZE = 60

/**
 * Default ceiling on rows held in memory. Reached ⇒ automatic pagination stops
 * (the cursor is kept, nothing is dropped) — see `tailReason` in
 * `events-feed.ts`.
 *
 * It is a MEMORY bound and says nothing about history, so the surface must
 * never draw it as the end of the feed: at the ceiling the tail offers to
 * continue (`loadOlder`), and only the server's `nextCursor: null` earns
 * "that was everything". Conflating the two is what the operator saw as "the
 * events page only goes back as far as 17:30".
 *
 * ## Why 5 000 and not 600
 *
 * 600 was a DOM bound wearing a memory bound's name: the gallery rendered every
 * card, so a thousand rows meant a thousand mounted `<button>`s with their
 * images, chips and observers. Ten pages in, the operator hit a wall a few
 * hours into the day and had to press "load older" per block.
 *
 * The gallery is now virtualized (`events-reel-window.ts` +
 * `use-gallery-rows.ts`): mounted cards are the rows near the viewport plus two
 * grid rows of overscan — three screens, ~40 cards, whatever the list length.
 * The DOM stopped being the limit, so the limit moved to what is RETAINED:
 *
 * | at 5 000 rows | cost |
 * | --- | --- |
 * | row objects + the 3 derived arrays | ~4 MB |
 * | mounted cards | ~40, flat |
 * | decoded thumbnails | unchanged — a 250-entry LRU that REVOKES (`use-authed-image`) |
 * | `trackList` posted to the host | ~12 KB per appended page, flat |
 *
 * ## The message used to be the bound, and no longer is
 *
 * That last row read "~1 MB of JSON, once per appended page" and WAS what
 * pinned this number: the host was handed the whole ordered collection on every
 * append (its detail view navigates with it), so the Nth page cost O(N).
 *
 * `events-track-list.ts` paginates it. A host that ASKED for deltas
 * (`setTrackListMode`, gated on the `track-list-delta` feature this build
 * announces) receives only what moved and accumulates the rest, so an appended
 * page costs one page, whatever N is. At ~200 B of protocol JSON per row and a 60-row page:
 *
 * | | peak single message | whole session to 5 000 rows |
 * | --- | --- | --- |
 * | whole list per append | 200 B × 5 000 = **1 MB** | 200 B × 5 000 × 84/2 ≈ **42 MB** |
 * | delta per append | 200 B × 60 = **12 KB** | 200 B × 5 000 = **1 MB** |
 *
 * ## What bounds it now
 *
 * A RESET — a filter change, a sort flip, a new day, any reorder the delta
 * cannot prove — still sends the whole list: 200 B × N. That is 1 MB at 5 000,
 * the same figure that used to be paid ~83 times per session and is now paid
 * once per operator interaction that reorders the feed. On the arithmetic alone
 * a 20 000-row ceiling would mean a 4 MB reset burst, which is still tens of
 * milliseconds.
 *
 * So the message no longer justifies 5 000, and the number stays anyway,
 * because the NEXT constraint has not been measured: 4 MB / 5 000 = ~0.8 KB of
 * retained row per row, so 20 000 would retain ~16 MB inside a WebView that
 * also holds the decoded-thumbnail LRU. Raising the ceiling is now a question
 * about RETENTION on a device, not about a message — and it needs a measurement
 * this change did not take. (The publisher's own bookkeeping is not in it: it
 * keeps trackId POINTERS, ~8 B × N, sharing the strings the rows already hold.)
 *
 * 5 000 is also `maxRows`' own schema maximum, so it is the ceiling of the
 * contract and not merely of the default — raising the default means raising
 * that too. At a 60-row page that is ~83 pages, which on a busy multi-camera
 * hub is days rather than hours — the tail still says `ceiling` honestly if
 * anyone reaches it.
 */
export const DEFAULT_EVENTS_MAX_ROWS = 5000

/**
 * The REEL's ceiling, which is still a DOM bound — the horizontal strip renders
 * every card it holds and was not virtualized (it is a strip, it is opened at
 * one row, and nothing asks it to hold a day).
 *
 * Named separately rather than left as one number for both views, because one
 * number for two rendering strategies is exactly the confusion this replaces:
 * the gallery's bound is memory, the reel's is the DOM, and they are not the
 * same size.
 */
export const REEL_EVENTS_MAX_ROWS = 600

/** Default age floor: never ASK for tracks older than 30 days. */
export const DEFAULT_EVENTS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
