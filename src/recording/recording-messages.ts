/**
 * Page↔host contract for the recording embed (`?mode=recording`). Mirrors the
 * grid embed's `embed-messages`. Pure — unit-tested.
 *
 * - `parseRecordingHostMessage`: validate an inbound WebView `onMessage` payload
 *   (page → host): playback state + playhead position.
 * - `recordingCommandScript`: build the guarded `injectJavaScript` string that
 *   drives the page's `window.__camstackRecording` command API (host → page).
 */
export type RecordingReportState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'

export type RecordingHostMessage =
  | { readonly type: 'state'; readonly state: RecordingReportState; readonly message?: string }
  | { readonly type: 'position'; readonly positionMs: number }
  | { readonly type: 'log'; readonly scope: string; readonly msg: string; readonly data?: unknown }
  // First pushed scrub frame rendered on the WebRTC track. The host hides its
  // instant sprite placeholder once the requested footage is visible.
  | { readonly type: 'scrubDrawn' }
  /** The recorded tier the player is really on, next to the one it asked for. */
  | { readonly type: 'servedProfile'; readonly profile: ServedTier; readonly requested: string }
  /**
   * The REAL length of the clip on the pointer (D575), measured by the broker
   * from the file's own index and relayed by the embed. Named by clip so a
   * report that lands after the pointer moved on cannot be pinned on the next
   * file. While a clip holds the pointer the `position` messages are
   * FILE-RELATIVE (the field is still spelled `positionMs`, as it is for an
   * epoch); this is the axis they are measured against.
   */
  | { readonly type: 'clipDuration'; readonly clipId: string; readonly durationMs: number }
  /**
   * Whether the clip on the pointer is carrying SOUND, and why not when it is
   * not (D600, D621). Named by clip for the same reason `clipDuration` is.
   */
  | ({ readonly type: 'clipAudio' } & ClipAudioReport)
  /**
   * The clip on the pointer was served SHORT, or not at all (D623). Sent ONCE,
   * when the stream ends — after the playback it is about. Named by clip for
   * the same reason `clipDuration` is, and doubly so: a whole clip's worth of
   * time has passed, so the operator may well have moved on.
   */
  | ({ readonly type: 'clipIncomplete' } & ClipIncompleteReport)

export type ServedTier = 'high' | 'mid' | 'low'

/**
 * Why a clip is silent (D600, D621).
 *
 * Six of the seven are PERMANENT facts about the file or the negotiation that
 * carried it. `rate` is not: the broker drops every audio frame while the
 * playback rate is not 1×, deliberately — *"L'audio non serve in velocità non
 * 1x!!!"* (the operator, 2026-09-23) — and that answer comes and goes with the
 * speed chip. It is the one reason this app RENDERS, and it renders as a
 * deliberate silence rather than a fault (D62).
 */
export type ClipAudioReason =
  | 'not-negotiated'
  | 'not-offered'
  | 'no-audio-track'
  | 'unsupported-codec'
  | 'codec-mismatch'
  | 'stream-failed'
  | 'rate'

const CLIP_AUDIO_REASONS: readonly ClipAudioReason[] = [
  'not-negotiated',
  'not-offered',
  'no-audio-track',
  'unsupported-codec',
  'codec-mismatch',
  'stream-failed',
  'rate',
]

export interface ClipAudioReport {
  readonly type: 'clipAudio'
  readonly clipId: string
  readonly carried: boolean
  readonly codec?: 'opus' | 'pcmu'
  readonly reason?: ClipAudioReason
  /**
   * The rate the sound is suppressed AT — present iff `reason` is `rate`, and
   * refused otherwise. The hub enforces the pair on its serializer; this
   * parser enforces it again rather than trusting it, because a rate badge
   * with no rate is the unanswerable message the reason exists to replace.
   */
  readonly rate?: number
}

/**
 * How a clip's replay failed to deliver (D623).
 *
 * Two words, and deliberately not three. The provider has a THIRD verdict,
 * `completeness-unverified` — "we could not check" — and the hub's own wire
 * schema refuses it: a diagnostic about the measurement is not a fact about
 * the footage, and drawn on a screen it would read as a fault the operator
 * can act on. `stream-empty` is kept apart from `stream-short` because a
 * camera that granted the session and sent nothing is a camera fault, not a
 * clip that came up a few seconds short (the same discipline the provider's
 * own branches keep).
 */
export type ClipIncompleteCode = 'stream-short' | 'stream-empty'

const CLIP_INCOMPLETE_CODES: readonly ClipIncompleteCode[] = ['stream-short', 'stream-empty']

export interface ClipIncompleteReport {
  readonly type: 'clipIncomplete'
  readonly clipId: string
  readonly code: ClipIncompleteCode
  /**
   * The hub's own sentence, shown VERBATIM.
   *
   * It already names the figures and it is already Latin-1 safe, so it is not
   * a translation key and this app never composes around it: only the hub
   * knows how much media arrived against how much was asked for, and a viewer
   * that re-worded it would be a second authority for one measurement (D62).
   * Non-empty or refused — there is no generic fallback string for this
   * anywhere, so a report without a sentence says nothing at all.
   */
  readonly reason: string
}

export interface ServedProfileReport {
  readonly profile: ServedTier
  readonly requested: string
}

export interface ClipDurationReport {
  readonly clipId: string
  /** Strictly positive. A measurement that failed is never `0` (D393): the
   *  parser refuses anything else, so a consumer cannot draw an empty file. */
  readonly durationMs: number
}

function isServedTier(value: unknown): value is ServedTier {
  return value === 'high' || value === 'mid' || value === 'low'
}

const STATES: readonly RecordingReportState[] = ['idle', 'loading', 'playing', 'paused', 'ended', 'error']

/** Validate an untrusted page→host message string. Returns null on any mismatch. */
export function parseRecordingHostMessage(raw: string): RecordingHostMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  return coerceRecordingHostMessage(data)
}

/**
 * The same validation over an ALREADY-parsed value — the web host receives
 * `postMessage` objects, not strings, and a second hand-written check there is
 * how `servedProfile` came to be forwarded on one platform and not the other.
 */
export function coerceRecordingHostMessage(data: unknown): RecordingHostMessage | null {
  if (typeof data !== 'object' || data === null) return null
  const m = data as Record<string, unknown>
  if (m.type === 'state') {
    if (typeof m.state !== 'string' || !STATES.includes(m.state as RecordingReportState)) return null
    const state = m.state as RecordingReportState
    return typeof m.message === 'string' ? { type: 'state', state, message: m.message } : { type: 'state', state }
  }
  if (m.type === 'position') {
    if (typeof m.positionMs !== 'number') return null
    return { type: 'position', positionMs: m.positionMs }
  }
  if (m.type === 'log') {
    if (typeof m.scope !== 'string' || typeof m.msg !== 'string') return null
    return { type: 'log', scope: m.scope, msg: m.msg, data: m.data }
  }
  if (m.type === 'scrubDrawn') {
    return { type: 'scrubDrawn' }
  }
  if (m.type === 'servedProfile') {
    if (!isServedTier(m.profile) || typeof m.requested !== 'string') return null
    return { type: 'servedProfile', profile: m.profile, requested: m.requested }
  }
  if (m.type === 'clipDuration') {
    // Strictly positive or refused: a `0` here would draw an empty file, and
    // a measurement that failed is not a number at all (D393).
    if (typeof m.clipId !== 'string' || m.clipId.length === 0) return null
    if (typeof m.durationMs !== 'number' || !Number.isFinite(m.durationMs) || m.durationMs <= 0) return null
    return { type: 'clipDuration', clipId: m.clipId, durationMs: m.durationMs }
  }
  if (m.type === 'clipIncomplete') {
    // No clip to pin it on: the report lands after the playback it describes,
    // so an unnamed one would be drawn over whichever file the stage happens
    // to hold by then.
    if (typeof m.clipId !== 'string' || m.clipId.length === 0) return null
    // A code this build has never heard of is DROPPED rather than carried.
    // `completeness-unverified` is exactly that word today: the hub refuses to
    // send it and this refuses to read it, so a provider diagnostic cannot
    // reach a screen through either half.
    const code = CLIP_INCOMPLETE_CODES.find((known) => known === m.code)
    if (code === undefined) return null
    // The sentence IS the message. Nothing downstream has words of its own to
    // fall back to, so a report without one is not a quieter report — it is
    // an empty band.
    if (typeof m.reason !== 'string' || m.reason.trim().length === 0) return null
    return { type: 'clipIncomplete', clipId: m.clipId, code, reason: m.reason }
  }
  if (m.type === 'clipAudio') {
    // No clip to pin it on, or no answer at all: "we do not know" is a third
    // answer and is not coerced into `carried: false` here (D600).
    if (typeof m.clipId !== 'string' || m.clipId.length === 0) return null
    if (typeof m.carried !== 'boolean') return null
    const codec = m.codec === 'opus' || m.codec === 'pcmu' ? m.codec : undefined
    // A reason this build has never heard of is dropped rather than carried:
    // every consumer switches on the seven, so an eighth word would render as
    // an unexplained silence anyway — and unexplained is what it IS.
    const named = CLIP_AUDIO_REASONS.find((known) => known === m.reason)
    const rate = typeof m.rate === 'number' && Number.isFinite(m.rate) && m.rate > 0 ? m.rate : undefined
    // BOTH ways: `rate` without a usable rate loses its reason (a badge with
    // no number answers nothing), and a rate riding any other reason is
    // dropped (it reads as one, and the hub never sends it).
    const reason = named === 'rate' && rate === undefined ? undefined : named
    return {
      type: 'clipAudio',
      clipId: m.clipId,
      carried: m.carried,
      ...(codec === undefined ? {} : { codec }),
      ...(reason === undefined ? {} : { reason }),
      ...(reason === 'rate' && rate !== undefined ? { rate } : {}),
    }
  }
  // Unknown/newer message types (e.g. an OLD host reading a NEWER embed) fall
  // through to null and are ignored — additive forward/backward compatibility.
  return null
}

// ── Host → page commands ─────────────────────────────────────────────────────

export type RecordingCommand =
  | { readonly kind: 'seekTo'; readonly epochMs: number }
  | { readonly kind: 'play' }
  | { readonly kind: 'pause' }
  | { readonly kind: 'setRate'; readonly rate: number }
  | { readonly kind: 'fit'; readonly w: number; readonly h: number }
  // Legacy recording-page scrub commands. That HLS-only page has no
  // RecordedTrackSession and reports an explicit error for these commands.
  | { readonly kind: 'scrubStart' }
  | { readonly kind: 'scrubTo'; readonly epochMs: number }
  | { readonly kind: 'scrubEnd'; readonly epochMs: number }

/** Build a guarded `injectJavaScript` string driving `window.__camstackRecording`. */
export function recordingCommandScript(cmd: RecordingCommand): string {
  const api = 'window.__camstackRecording'
  const call =
    cmd.kind === 'seekTo'
      ? `${api}.seekTo(${cmd.epochMs})`
      : cmd.kind === 'play'
        ? `${api}.play()`
        : cmd.kind === 'pause'
          ? `${api}.pause()`
          : cmd.kind === 'setRate'
            ? `${api}.setRate(${cmd.rate})`
            : cmd.kind === 'scrubStart'
              ? `${api}.scrubStart()`
              : cmd.kind === 'scrubTo'
                ? `${api}.scrubTo(${cmd.epochMs})`
                : cmd.kind === 'scrubEnd'
                  ? `${api}.scrubEnd(${cmd.epochMs})`
                  : `${api}.fit(${cmd.w}, ${cmd.h})`
  // Guard: the command may fire before the page mounts its API — no-op then.
  return `${api} && ${call}; true;`
}
