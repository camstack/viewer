/**
 * The one funnel for "the hub refused our session". Anything that sees an
 * `UNAUTHORIZED` — the query cache, the mutation cache, a `capQuery` that is
 * about to swallow it, the socket watcher — calls {@link signalUnauthorized};
 * the app registers ONE handler (`use-session-renewal.ts`) that renews once
 * and signs out if the hub refuses.
 *
 * A burst is one renewal: the registered handler is single-flight, and the
 * renewal's own cool-down (`renewal-cooldown.ts`) answers the stragglers.
 * Module-level because the QueryClient is a singleton built before the React
 * tree mounts.
 */

let unauthorizedHandler: (() => void) | null = null

/** Wire the central handler. Idempotent; `null` detaches. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

/** Report one refusal. No-op until the app has registered a handler. */
export function signalUnauthorized(): void {
  unauthorizedHandler?.()
}
