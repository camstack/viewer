/**
 * query-deadline — the client-side bound this app did not have.
 *
 * ## Why this exists
 *
 * The viewer's tRPC client is `wsLink` over one WebSocket (`@camstack/sdk`
 * `system.ts`). `wsLink` has NO per-operation timeout, and no query in this app
 * passes an `AbortSignal`. So a hub procedure that never answers produces a
 * promise that never settles, and React Query treats a never-settling promise
 * as `isLoading === true` — forever. `retry` never runs, `onError` never runs,
 * the query cache never gets an error to show.
 *
 * That is invisible in the worst possible way: the WebSocket is still OPEN, so
 * `state === 'connected'`, so the hub-status overlay stays hidden and every screen
 * sits on its shimmer skeleton with no error, no banner and no explanation.
 *
 * On 2026-08-08 the agent node `agent-a` crash-looped for 22 minutes
 * (`[agent-registry] Agent disconnected: agent-a` every ~21s). Because the
 * node kept re-registering, the hub's registry believed it was ONLINE and
 * routed cap calls to it instead of failing them fast — each one then sat on
 * the transport's 60s ceiling. The operator's report was "the app couldn't load
 * anything", and it recovered only when the node came back.
 *
 * ## The rule
 *
 * A node being offline is a NORMAL cluster state. The app must degrade — the
 * cameras and features of that node absent or marked offline — never block as a
 * whole. A bounded query that REJECTS is strictly better than an unbounded one
 * that hangs: rejecting gives React Query an error, which gives the screen
 * `isError` + whatever it already had cached, which is a working app minus one
 * node.
 *
 * This is deliberately client-side and independent of the hub fix. The hub now
 * bounds its own per-node aggregation, but the app must not DEPEND on every hub
 * procedure being well-behaved to stay usable — that is the coupling that made
 * one node's crash-loop a total outage.
 */

/** Thrown when a query exceeds its deadline. Carries what timed out so the log
 *  line can say which call, not merely that "something" was slow. */
export class QueryDeadlineError extends Error {
  readonly label: string
  readonly deadlineMs: number

  constructor(label: string, deadlineMs: number) {
    super(`${label} exceeded its ${deadlineMs}ms deadline`)
    this.name = 'QueryDeadlineError'
    this.label = label
    this.deadlineMs = deadlineMs
  }
}

/** True when `err` is a deadline expiry rather than a server-side failure.
 *  Screens use this to say "this node isn't answering" instead of "error". */
export function isQueryDeadlineError(err: unknown): err is QueryDeadlineError {
  return err instanceof QueryDeadlineError
}

/**
 * Default deadline for a boot-path query.
 *
 * Sized against what the hub actually costs when it is healthy, not against
 * what feels safe: the whole viewer boot is ~1.8MB of tRPC JSON and the widest
 * single call measured (`deviceManager.listAll`, 293 devices) answers well
 * inside a second on a busy hub. 12s leaves an order of magnitude of headroom
 * over the worst healthy case while being far below the 60s the transport
 * allows a dead peer — which is the gap this constant exists to close.
 *
 * It must stay comfortably ABOVE the hub's own per-node deadline
 * (`STATUS_CALL_DEADLINE_MS`, 3s, times the number of batch windows), so a hub
 * that is correctly returning a PARTIAL result is never mistaken for a hub that
 * is hanging. Lowering this below that product would start discarding honest
 * partial answers.
 */
export const BOOT_QUERY_DEADLINE_MS = 12_000

/**
 * Resolve `work`, or reject with {@link QueryDeadlineError} once `deadlineMs`
 * elapses.
 *
 * `Promise.race` attaches a handler to `work`, so a rejection that arrives
 * after the deadline is already handled and never surfaces as an unhandled
 * rejection. Note this does NOT cancel the in-flight tRPC operation — wsLink
 * has no cancellation we can reach from here — it stops the UI WAITING on it.
 * The socket carries the eventual (ignored) reply; nothing leaks but bytes.
 */
export async function withQueryDeadline<T>(
  work: Promise<T>,
  label: string,
  deadlineMs: number = BOOT_QUERY_DEADLINE_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new QueryDeadlineError(label, deadlineMs)), deadlineMs)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
