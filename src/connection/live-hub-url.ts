/**
 * Origin the native embed WebViews must call.
 *
 * `ServerProvider.serverUrl` is the configured hub (the public tunnel the
 * operator typed). The live tRPC route is `System.serverUrl`, which the
 * endpoint race pivots onto LAN HTTP at home. Snapshot HTTP already follows
 * the live route; the events/player/grid embeds were still injected with the
 * tunnel, so the feed logged `channel: public:…` while native queries were
 * on `http://192.0.2.10:4480`.
 *
 * Web embeds stay on the configured URL: an HTTPS page talking to LAN HTTP
 * is mixed content.
 */
export function pickLiveHubUrl(
  liveRoute: string | null | undefined,
  configured: string | null,
): string | null {
  if (typeof liveRoute === 'string' && liveRoute.length > 0) return liveRoute
  return configured
}
