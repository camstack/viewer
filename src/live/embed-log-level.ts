/**
 * embed-log-level — which embed diagnostic scopes are worth shipping.
 *
 * The embed WebViews emit `{type:'log', scope, msg, data}`; the native host
 * forwards each one into the app logger as `embed:<scope>`. The LEVEL that
 * forward picks is what decides whether the line ever leaves the device,
 * because the shipper drops `info` unless the scope is in
 * `ALWAYS_SHIP_SCOPES` (`lib/logger.ts`) and drops `debug` outright unless
 * debug mode is on — and the operator files reports with debug mode off.
 *
 * So a scope only reaches the hub when BOTH halves agree: this function must
 * return `info` AND `logger.ts` must list `embed:<scope>`. Neither half is
 * sufficient, and neither half is visible from the other — which is exactly
 * how the promotion here and the allowlist there can drift apart. The pairing
 * is asserted in `__tests__/embed-log-level.spec.ts`; add a scope in one place
 * without the other and that test fails.
 */
export type EmbedLogLevel = 'info' | 'debug'

/**
 * Embed scopes promoted to `info`. Each is low-rate and bounded — a handful of
 * lines per connection or per gesture — and each answers a question that has
 * been asked in a report filed with debug mode off.
 */
const EMBED_INFO_SCOPES: ReadonlySet<string> = new Set([
  // Cold-start phase breakdown, once per connect.
  'webrtc-timing',
  // Recorded-playback census + land/play intent.
  'playback',
  // The client's half of the adaptive-tier join: what this app SENT (measured
  // viewport, pixel ratio, the downlink it managed to measure and the origin
  // it probed) and the live profile it ended up on. The hub logs its own pick
  // from those same inputs; without this line the report has only one side of
  // the join and "the quality always drops to low" cannot be told apart from
  // "the client never sent anything to score". One line per decision CHANGE.
  'adaptive',
])

/** The level `embed:<scope>` must be logged at by the native host bridge. */
export function embedLogLevel(scope: string): EmbedLogLevel {
  return EMBED_INFO_SCOPES.has(scope) ? 'info' : 'debug'
}

/** The scopes this module promotes — the test joins these to the allowlist. */
export function embedInfoScopes(): readonly string[] {
  return [...EMBED_INFO_SCOPES]
}
