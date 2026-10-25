/**
 * The stream-debug sample, as it arrives from the player — and the narrowing
 * that makes it safe to render.
 *
 * ## Why the app declares its own shape
 *
 * The numbers are measured by `CameraStreamPlayer`, which lives in
 * `@camstack/ui-library` — a **DOM** component library. A React Native app must
 * not import it: its bundle reaches for browser globals and for
 * `Array.prototype.toSorted`, which Hermes does not have
 * (`scripts/check-hermes-builtins.mjs` exists because of exactly this class of
 * crash). So the type is declared here, structurally, and the player sends its
 * own verdict rather than the app importing the function that derives one.
 *
 * ## Why it is parsed and not trusted
 *
 * It crosses a WebView boundary as JSON on `postMessage`. That is a system
 * boundary like any other: every field is validated, anything unrecognised
 * becomes `null`, and `null` means UNKNOWN — never zero. The panel's whole job
 * is telling "nobody measured" apart from "measured nothing", and a parser that
 * coerced a missing field to 0 would destroy that distinction before it ever
 * reached the screen.
 */

/** What the player concluded about the picture, computed on its side. */
export type StreamFreezeVerdict =
  | 'unknown'
  | 'decoding'
  | 'decoder-stall'
  | 'transport-stall'
  | 'frozen-unknown'

const VERDICTS: readonly StreamFreezeVerdict[] = [
  'unknown',
  'decoding',
  'decoder-stall',
  'transport-stall',
  'frozen-unknown',
]

/** The deltas over the player's last measurement window. */
export interface StreamDebugWindow {
  readonly framesDecoded: number | null
  readonly freezeMs: number | null
  readonly pliCount: number | null
  readonly nackCount: number | null
  readonly packetsLost: number | null
  readonly lossPercent: number | null
  readonly kbps: number | null
  readonly decodeMs: number | null
}

/** The client half — what this device's PeerConnection reported. */
export interface StreamDebugStats {
  readonly at: number
  readonly width: number | null
  readonly height: number | null
  readonly fps: number | null
  readonly codec: string | null
  readonly framesDecoded: number | null
  readonly framesDropped: number | null
  readonly freezeCount: number | null
  readonly totalFreezeMs: number | null
  readonly pliCount: number | null
  readonly nackCount: number | null
  readonly packetsLost: number | null
  readonly lossPercent: number | null
  readonly jitterMs: number | null
  readonly rttMs: number | null
  readonly candidatePairType: string | null
  readonly candidateProtocol: string | null
  readonly iceConnectionState: string | null
  readonly dtlsState: string | null
  readonly window: StreamDebugWindow | null
}

/**
 * Why the hub's quality ladder is not climbing (D635). `code` is the hub's own
 * vocabulary; one this build does not know is `unknown`, and its `summary`
 * (the hub's one-line account, numbers included) is still shown.
 */
export const CLIMB_HOLD_CODES = [
  'stall-building',
  'delivery',
  'no-evidence',
  'warming',
  'cooldown',
  'capacity',
  'try-unclean',
  'try-backoff',
  'trial',
  'suspended',
] as const
export type ClimbHoldCode = (typeof CLIMB_HOLD_CODES)[number] | 'unknown'

export interface StreamDebugClimbHold {
  readonly code: ClimbHoldCode
  readonly summary: string | null
}

/** The ladder's last move. `causeDetail` is the hub's finer name for it, when
 *  the wire's legacy `cause` cannot carry it (a reverted try reads `loss`). */
export interface StreamDebugDecision {
  readonly cause: string
  readonly causeDetail: string | null
  readonly tier: string | null
}

/** The server half — what the hub says it is serving. */
export interface StreamDebugServer {
  readonly alive: boolean
  readonly servedTier: string | null
  readonly adaptive: boolean | null
  readonly camStreamId: string | null
  readonly sourceKind: 'native' | 'derived' | 'unknown'
  readonly ingestNodeId: string | null
  readonly egressLeg: 'copy' | 'transcode' | 'unknown'
  readonly lastDecision: StreamDebugDecision | null
  /** Null when the hub sent none — an older hub, no ladder, or the top rung. */
  readonly climbHold: StreamDebugClimbHold | null
}

export interface StreamDebugSample {
  readonly at: number
  readonly verdict: StreamFreezeVerdict
  readonly sessionId: string | null
  readonly stats: StreamDebugStats | null
  readonly server: StreamDebugServer | null
  readonly serverError: string | null
  readonly serverWired: boolean
}

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/** A finite number, or UNKNOWN. Never a default. */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function parseWindow(raw: unknown): StreamDebugWindow | null {
  const w = rec(raw)
  if (w === null) return null
  return {
    framesDecoded: num(w['framesDecoded']),
    freezeMs: num(w['freezeMs']),
    pliCount: num(w['pliCount']),
    nackCount: num(w['nackCount']),
    packetsLost: num(w['packetsLost']),
    lossPercent: num(w['lossPercent']),
    kbps: num(w['kbps']),
    decodeMs: num(w['decodeMs']),
  }
}

function parseStats(raw: unknown): StreamDebugStats | null {
  const s = rec(raw)
  if (s === null) return null
  const at = num(s['at'])
  if (at === null) return null
  return {
    at,
    width: num(s['width']),
    height: num(s['height']),
    fps: num(s['fps']),
    codec: str(s['codec']),
    framesDecoded: num(s['framesDecoded']),
    framesDropped: num(s['framesDropped']),
    freezeCount: num(s['freezeCount']),
    totalFreezeMs: num(s['totalFreezeMs']),
    pliCount: num(s['pliCount']),
    nackCount: num(s['nackCount']),
    packetsLost: num(s['packetsLost']),
    lossPercent: num(s['lossPercent']),
    jitterMs: num(s['jitterMs']),
    rttMs: num(s['rttMs']),
    candidatePairType: str(s['candidatePairType']),
    candidateProtocol: str(s['candidateProtocol']),
    iceConnectionState: str(s['iceConnectionState']),
    dtlsState: str(s['dtlsState']),
    window: parseWindow(s['window']),
  }
}

function parseClimbHold(raw: unknown): StreamDebugClimbHold | null {
  const h = rec(raw)
  if (h === null) return null
  const code = CLIMB_HOLD_CODES.find((c) => c === h['code']) ?? 'unknown'
  const summary = str(h['summary'])
  // Neither a code we know nor a line to show: nothing was said.
  if (code === 'unknown' && summary === null) return null
  return { code, summary }
}

function parseServer(raw: unknown): StreamDebugServer | null {
  const s = rec(raw)
  if (s === null) return null
  const kind = s['sourceKind']
  const leg = s['egressLeg']
  const decision = rec(s['lastDecision'])
  const cause = decision === null ? null : str(decision['cause'])
  return {
    // A session the server did not find is `alive: false`; a field we could not
    // read is not a live session either.
    alive: bool(s['alive']) ?? false,
    servedTier: str(s['servedTier']),
    adaptive: bool(s['adaptive']),
    camStreamId: str(s['camStreamId']),
    sourceKind: kind === 'native' || kind === 'derived' ? kind : 'unknown',
    ingestNodeId: str(s['ingestNodeId']),
    egressLeg: leg === 'copy' || leg === 'transcode' ? leg : 'unknown',
    lastDecision:
      cause === null
        ? null
        : { cause, causeDetail: str(decision?.['causeDetail']), tier: str(decision?.['tier']) },
    climbHold: parseClimbHold(s['climbHold']),
  }
}

/** Narrow one `postMessage` payload, or refuse it. */
export function parseStreamDebugSample(raw: unknown): StreamDebugSample | null {
  const s = rec(raw)
  if (s === null) return null
  const at = num(s['at'])
  if (at === null) return null
  const verdict = s['verdict']
  return {
    at,
    verdict: VERDICTS.find((v) => v === verdict) ?? 'unknown',
    sessionId: str(s['sessionId']),
    stats: parseStats(s['stats']),
    server: parseServer(s['server']),
    serverError: str(s['serverError']),
    serverWired: bool(s['serverWired']) ?? false,
  }
}

/**
 * Is this page→host message the injected `getStats` probe's reply?
 *
 * Exported so the sniff has a test. It was written as
 * `raw.includes('"stats"')` — which claims ANY message carrying a field named
 * `stats`, and a stream-debug sample carries exactly that. Every sample was
 * swallowed by the stats branch and the status card said "no measurement yet"
 * for ever, on a chain that was otherwise working end to end.
 */
export function isPlaybackStatsReply(raw: unknown): boolean {
  return typeof raw === 'string' && raw.includes('"type":"stats"')
}
