/**
 * A stand-in for the hub's tRPC client.
 *
 * This is the ONLY thing a mount test is allowed to fake: the wire. Every data
 * hook, store, selector and component above it runs for real, so a mount test
 * can be fed a payload captured from the live hub and will exercise the same
 * parsing and rendering the operator's device does.
 *
 * A path with no registered handler behaves like a hub that does not have the
 * procedure: the call throws, which is exactly what `capQuery` swallows to
 * `null`. That is the older-hub case, and it is the default on purpose — a
 * screen must survive it.
 */

export type HubHandler = (input?: unknown) => unknown

/** `'nc.listRules'` → handler or literal value. */
export type HubResponses = Readonly<Record<string, HubHandler | unknown>>

interface HubCall {
  readonly path: string
  readonly kind: 'query' | 'mutate'
  readonly input: unknown
}

let responses: HubResponses = {}
let calls: HubCall[] = []

export function setHubResponses(next: HubResponses): void {
  responses = next
}

export function resetHubStub(): void {
  responses = {}
  calls = []
}

export function hubCalls(): readonly HubCall[] {
  return calls
}

class MissingProcedureError extends Error {
  constructor(path: string) {
    super(`NOT_FOUND: no such procedure "${path}" on this hub`)
    this.name = 'MissingProcedureError'
  }
}

function invoke(path: string, kind: HubCall['kind'], input: unknown): Promise<unknown> {
  calls = [...calls, { path, kind, input }]
  if (!Object.prototype.hasOwnProperty.call(responses, path)) {
    return Promise.reject(new MissingProcedureError(path))
  }
  const entry = responses[path]
  try {
    return Promise.resolve(typeof entry === 'function' ? (entry as HubHandler)(input) : entry)
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)))
  }
}

/**
 * The tRPC v11 client is a callable proxy of arbitrary depth; so is this. Path
 * segments accumulate until `.query` / `.mutate` / `.subscribe` is read.
 */
function node(segments: readonly string[]): unknown {
  const target = (): void => undefined
  return new Proxy(target, {
    get(_t, prop): unknown {
      if (typeof prop !== 'string') return undefined
      if (prop === 'query' || prop === 'mutate') {
        const kind: HubCall['kind'] = prop === 'query' ? 'query' : 'mutate'
        return (input?: unknown) => invoke(segments.join('.'), kind, input)
      }
      if (prop === 'subscribe') {
        return () => ({ unsubscribe: () => undefined })
      }
      // React Query / superjson probe objects for these before using them.
      if (prop === 'then' || prop === '$$typeof' || prop === 'prototype') return undefined
      return node([...segments, prop])
    },
  })
}

export function createTrpcClientStub(): Record<string, unknown> {
  return node([]) as Record<string, unknown>
}
