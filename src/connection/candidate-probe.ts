/**
 * candidate-probe — say WHY a candidate route lost the race.
 *
 * `raceFastestEndpoint` is a `Promise.any`: it returns the winner and throws
 * every loser's reason away. That is the right shape for the hot path and the
 * wrong shape for a diagnosis, because the two failures an operator actually
 * hits are indistinguishable from the outside:
 *
 *   - the LAN endpoint is reachable but serves a certificate the device does
 *     not trust (this deployment's hub presents a self-signed `CN=camstack.local`),
 *     so a phone can NEVER elect it and will sit on the public tunnel forever
 *     while its owner is standing next to the hub on WiFi;
 *   - the LAN endpoint is genuinely not routable (mobile data, guest VLAN),
 *     which is the same log line and a completely different action.
 *
 * So when a race elects nothing — or elects the tunnel while a LAN candidate
 * exists — each candidate is probed once more, on its own, and the failure is
 * recorded verbatim. This runs off the hot path and only on those branches.
 *
 * `fetchImpl` and `now` are injected so the sequencing is testable without a
 * network.
 */

/** What one candidate did when asked directly. */
export interface CandidateProbeResult {
  readonly url: string
  readonly ok: boolean
  readonly ms: number
  /** HTTP status when there was a response at all, else null. */
  readonly status: number | null
  /** `${name}: ${message}` when the request never produced a response. A TLS
   *  refusal, a timeout and a DNS failure are three different strings here and
   *  three different fixes. */
  readonly error: string | null
}

export interface CandidateProbeDeps {
  readonly fetchImpl: (url: string, init: { signal: AbortSignal }) => Promise<{ status: number }>
  readonly now: () => number
}

/**
 * The auth-free liveness endpoint. `/health`, and NOT `/trpc/health`.
 *
 * `/trpc/*` belongs to the tRPC fastify plugin, which resolves the rest of the
 * path as a PROCEDURE name. There is no `health` procedure, so a GET answers
 * 404 with `No procedure found on path "health"` — verified against the live
 * hub on both channels. (A `fastify.get('/trpc/health')` does exist in
 * `server/backend/src/main.ts`, but only on the DEGRADED branch taken when
 * tRPC registration fails, so it is registered exactly when the server is
 * broken and absent when it is healthy.)
 *
 * The SDK's `raceFastestEndpoint` still asks `/trpc/health` with `method:
 * 'GET'` while its own docblock says it fires a HEAD — and HEAD really does
 * answer 204 there, which is why the design as written down would have worked
 * and the code as shipped could not. Consequence: `Promise.any` over probes
 * that all 404 rejects, the race returns null, and EVERY client on EVERY
 * channel has been falling back to its configured URL. That is why ninety
 * minutes of the operator's logs contain three `race failed` lines and no
 * `race won`.
 *
 * `/health` answers `{"ok":true}` with 200 on the LAN (28 ms) and through the
 * public tunnel (151 ms). One path, asked one way, by the prober AND by the
 * race below — a probe and a race that disagree is how this stayed invisible.
 */
export const HEALTH_PATH = '/health'

function describeError(e: unknown): string {
  if (e instanceof Error) {
    const cause =
      e.cause instanceof Error ? `; cause: ${e.cause.name}: ${e.cause.message}` : ''
    return `${e.name}: ${e.message}${cause}`
  }
  return String(e)
}

/** Family / scheme / host as the Settings log line should name them. */
export function probeTarget(url: string): {
  readonly family: 'ipv4' | 'ipv6' | 'host'
  readonly scheme: string
  readonly host: string
} {
  try {
    const parsed = new URL(url)
    const scheme = parsed.protocol.replace(/:$/, '')
    const host = parsed.host
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
    if (hostname.includes(':')) return { family: 'ipv6', scheme, host }
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return { family: 'ipv4', scheme, host }
    return { family: 'host', scheme, host }
  } catch {
    return { family: 'host', scheme: '?', host: url }
  }
}

/** Why this probe failed, in operator language. Null on success. */
export function probeFailureHint(result: CandidateProbeResult): string | null {
  if (result.ok) return null
  const target = probeTarget(result.url)
  const err = (result.error ?? '').toLowerCase()
  if (err.includes('abort')) return 'timeout'
  if (
    err.includes('certificate') ||
    err.includes('ssl') ||
    err.includes('tls') ||
    err.includes('cert')
  ) {
    return 'TLS/certificate'
  }
  const netFail =
    err.includes('network request failed') ||
    err.includes('failed to fetch') ||
    err.includes('could not connect')
  if (target.scheme === 'http' && netFail) {
    if (target.family === 'ipv4') return 'ATS, Local Network permission, or IPv4 unreachable'
    if (target.family === 'ipv6') return 'ATS (IPv6 GUA is not local for ATS) or unreachable'
    return 'ATS or unreachable'
  }
  if (netFail) return 'unreachable'
  return null
}

/** One line Settings → Logs can show without expanding JSON. */
export function summariseProbe(result: CandidateProbeResult): string {
  const target = probeTarget(result.url)
  const verdict = result.ok ? `OK ${result.status}` : `FAIL ${result.error ?? `HTTP ${result.status}`}`
  const hint = probeFailureHint(result)
  return `${target.family} ${target.scheme} ${target.host} ${verdict} ${result.ms}ms${hint ? ` — ${hint}` : ''}`
}

/** Probe one candidate. Never throws — a probe that can fail is a probe that
 *  hides the answer it was added to produce. */
export async function probeCandidate(
  url: string,
  timeoutMs: number,
  deps: CandidateProbeDeps,
): Promise<CandidateProbeResult> {
  const startedAt = deps.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await deps.fetchImpl(`${url.replace(/\/+$/, '')}${HEALTH_PATH}`, {
      signal: controller.signal,
    })
    return {
      url,
      ok: res.status >= 200 && res.status < 300,
      ms: Math.round(deps.now() - startedAt),
      status: res.status,
      error: null,
    }
  } catch (e) {
    return {
      url,
      ok: false,
      ms: Math.round(deps.now() - startedAt),
      status: null,
      error: describeError(e),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Probe every candidate, one at a time.
 *
 * Serial rather than parallel on purpose: this runs when the transport is
 * already struggling, and a burst of simultaneous TLS handshakes from a phone
 * is how a diagnostic starts causing the condition it is measuring.
 */
export async function probeCandidates(
  urls: readonly string[],
  timeoutMs: number,
  deps: CandidateProbeDeps,
): Promise<readonly CandidateProbeResult[]> {
  const out: CandidateProbeResult[] = []
  for (const url of urls) out.push(await probeCandidate(url, timeoutMs, deps))
  return out
}

/** A settled race: who won, and what every candidate did. */
export interface CandidateRaceOutcome {
  /** Fastest candidate that answered 2xx, or null when none did. */
  readonly winner: string | null
  /** Every candidate's result, in the order they were given. */
  readonly results: readonly CandidateProbeResult[]
}

/**
 * How long a secure twin (the `https://` address of a host the hub also offers
 * over plain `http://`, D859) may keep the race open after another candidate
 * has answered. It is only waited for to break a tie in its favour; a twin
 * that is not up by then — a phone that does not trust the hub's CA fails it
 * in a few ms, a firewalled port never answers at all — is left behind, so a
 * twin can never delay the connection by more than this.
 */
export const SECURE_TWIN_GRACE_MS = 250

/** A secure twin is probed with at most this timeout, whatever the race's. */
export const SECURE_TWIN_TIMEOUT_MS = 800

/** Marks a result whose probe was still in flight when the race was decided. */
export const UNFINISHED_PROBE_ERROR =
  'not awaited: the race was decided before this candidate answered'

/** True for a result that never settled (see {@link UNFINISHED_PROBE_ERROR}). */
export function isUnfinishedProbe(result: CandidateProbeResult): boolean {
  return result.error === UNFINISHED_PROBE_ERROR
}

interface UrlParts {
  readonly scheme: string
  readonly hostname: string
}

function urlParts(url: string): UrlParts | null {
  try {
    const parsed = new URL(url)
    return { scheme: parsed.protocol.replace(/:$/, ''), hostname: parsed.hostname }
  } catch {
    return null
  }
}

/**
 * The `https://` candidates whose host is ALSO a candidate over plain `http://`
 * — the hub's LAN https counterparts. They are optional by construction: the
 * plain address is the route that always works, the twin only improves it when
 * the phone trusts the hub's certificate.
 */
export function secureTwinUrls(urls: readonly string[]): ReadonlySet<string> {
  const parts = urls.map((url) => ({ url, parts: urlParts(url) }))
  const plainHosts = new Set(
    parts.flatMap((p) => (p.parts?.scheme === 'http' ? [p.parts.hostname] : [])),
  )
  return new Set(
    parts.flatMap((p) =>
      p.parts?.scheme === 'https' && plainHosts.has(p.parts.hostname) ? [p.url] : [],
    ),
  )
}

/** Why a secure twin lost, in the two classes an operator acts on differently. */
export type SecureTwinFailureClass = 'tls-untrusted' | 'unreachable'

/**
 * The failure class of the secure twin `result`, or `null` when it did not
 * fail (it answered, or was never awaited) or is no twin of anything in
 * `results`.
 *
 * `tls-untrusted`: the host answers but this address does not — the certificate
 * is one the phone has not been told to trust. A phone only says so in words
 * on some platforms (`certificate`, `ssl`); on iOS the fetch just fails with
 * "Network request failed", so the same host answering over plain http is the
 * evidence. `unreachable`: neither answered, or the probe timed out.
 */
export function classifySecureTwinFailure(
  result: CandidateProbeResult,
  results: readonly CandidateProbeResult[],
): SecureTwinFailureClass | null {
  if (result.ok || isUnfinishedProbe(result)) return null
  const twin = urlParts(result.url)
  if (twin?.scheme !== 'https') return null
  const sibling = results.find((r) => {
    const parts = urlParts(r.url)
    return parts?.scheme === 'http' && parts.hostname === twin.hostname
  })
  if (sibling === undefined) return null
  const err = (result.error ?? '').toLowerCase()
  if (/certificate|ssl|tls|trust/.test(err)) return 'tls-untrusted'
  if (err.includes('abort')) return 'unreachable'
  return sibling.ok ? 'tls-untrusted' : 'unreachable'
}

/**
 * The fastest candidate that answered 2xx. Ordering by measured time rather
 * than by settle order keeps the choice reproducible from the log line beside
 * it. A tie between the plain and the secure address of ONE host goes to the
 * secure one: when both answer, the session token should not cross the WiFi in
 * clear.
 */
function pickWinner(results: readonly CandidateProbeResult[]): CandidateProbeResult | null {
  let fastest: CandidateProbeResult | null = null
  for (const r of results) {
    if (!r.ok) continue
    if (fastest === null || r.ms < fastest.ms) fastest = r
  }
  if (fastest === null) return null
  const parts = urlParts(fastest.url)
  if (parts?.scheme !== 'http') return fastest
  const secure = results.find((r) => {
    const other = urlParts(r.url)
    return r.ok && other?.scheme === 'https' && other.hostname === parts.hostname
  })
  return secure ?? fastest
}

/**
 * Race the candidates and keep ALL the answers.
 *
 * Replaces the SDK's `raceFastestEndpoint` at the viewer's call site for two
 * reasons, and only the second is about the bug:
 *
 *  1. it asks {@link HEALTH_PATH}, which exists;
 *  2. `Promise.any` keeps the winner and destroys every loser's reason, so a
 *     race that elected nothing could not say whether the LAN was refused, slow
 *     or simply never listening. Here the losers ARE the diagnosis, and they
 *     come out of the race itself — no second pass, no extra load on a
 *     transport that is already struggling.
 *
 * Probes run concurrently: this one IS the connect path, and the whole point is
 * the fastest answer. Every candidate is waited for — except a secure twin (see
 * {@link secureTwinUrls}) once something has answered: it gets
 * {@link SECURE_TWIN_GRACE_MS} to answer too, so it can win the tie, and is
 * reported as unfinished otherwise.
 */
export async function raceCandidates(
  urls: readonly string[],
  timeoutMs: number,
  deps: CandidateProbeDeps,
): Promise<CandidateRaceOutcome> {
  if (urls.length === 0) return { winner: null, results: [] }
  const twins = secureTwinUrls(urls)
  const startedAt = Date.now()
  const settled: (CandidateProbeResult | null)[] = urls.map(() => null)
  return new Promise<CandidateRaceOutcome>((resolve) => {
    let graceTimer: ReturnType<typeof setTimeout> | null = null
    let graceOver = false
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      if (graceTimer !== null) clearTimeout(graceTimer)
      const results = urls.map(
        (url, i): CandidateProbeResult =>
          settled[i] ?? {
            url,
            ok: false,
            ms: Math.round(Date.now() - startedAt),
            status: null,
            error: UNFINISHED_PROBE_ERROR,
          },
      )
      resolve({ winner: pickWinner(results)?.url ?? null, results })
    }
    const onlyTwinsPending = (): boolean =>
      urls.every((url, i) => settled[i] !== null || twins.has(url))
    const maybeFinish = (): void => {
      if (settled.every((r) => r !== null)) finish()
      else if (graceOver && onlyTwinsPending()) finish()
    }
    urls.forEach((url, i) => {
      const bound = twins.has(url) ? Math.min(timeoutMs, SECURE_TWIN_TIMEOUT_MS) : timeoutMs
      void probeCandidate(url, bound, deps).then((result) => {
        if (done) return
        settled[i] = result
        if (result.ok && graceTimer === null) {
          graceTimer = setTimeout(() => {
            graceOver = true
            maybeFinish()
          }, SECURE_TWIN_GRACE_MS)
        }
        maybeFinish()
      })
    })
  })
}
