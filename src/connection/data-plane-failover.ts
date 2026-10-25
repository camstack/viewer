export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

export interface FailoverOptions {
  readonly fetchImpl?: FetchImpl
  readonly init?: RequestInit
}

export interface FailoverResult {
  readonly url: string
  readonly response: Response
}

/** Thrown when no candidate endpoint produced a 2xx response. */
export class AllEndpointsFailedError extends Error {
  constructor(public readonly attempts: number) {
    super(`All ${attempts} data-plane endpoints failed`)
    this.name = 'AllEndpointsFailedError'
  }
}

/** Try each endpoint in order (LAN→relay); first 2xx wins. A non-2xx status
 *  OR a thrown fetch (network error / timeout) falls through to the next.
 *  Endpoints already carry the scoped JWT in their path — no extra auth header. */
export async function fetchWithFailover(
  endpoints: readonly string[],
  options: FailoverOptions = {},
): Promise<FailoverResult> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchImpl)
  for (const url of endpoints) {
    try {
      const response = await fetchImpl(url, options.init)
      if (response.ok) return { url, response }
    } catch {
      // network error — try the next endpoint
    }
  }
  throw new AllEndpointsFailedError(endpoints.length)
}
