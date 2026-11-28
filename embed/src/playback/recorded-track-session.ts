/**
 * The unified recorded session — D42's client half.
 *
 * ONE media session per viewer: live, recorded playback and scrub are the same
 * WebRTC track with a moving SOURCE POINTER owned by the broker's per-viewer
 * `TimelineSession`. This class is the client's entire recorded surface:
 * every intent — play from an epoch, seek, rate, frame-step, drag, commit,
 * go-live — is one pointer-move message on the `dominevo-control` data
 * channel, and every picture arrives on the track the viewer is already
 * watching, decoded by the browser. There is no client decode tier, no canvas
 * overlay and no choreography between two surfaces, which is precisely the
 * failure class D42 exists to remove: when frames ride the visible track,
 * liveness needs no proof — you can see it.
 *
 * The scrub sub-mode keeps everything the field taught (D41 → incident →
 * fixes, all Loki-verified):
 *  - the `low` profile pin is idempotent BY VALUE — a pin per drag reached
 *    the server mid-recorded and tore the feeder down MID-DRAG (eight
 *    rebuild/rebase cycles a minute; nothing rendered);
 *  - RECEIVER-CREDIT acks come from frames the viewer RENDERED
 *    (`requestVideoFrameCallback`), with the server's per-push `position`
 *    message standing in where rvfc is unavailable — never a timer;
 *  - the LIVE-STRAGGLER guard: frames rendered before the server's first
 *    pushed position are the tail of the live stream — not acked, not
 *    announced;
 *  - the per-drag summary line (`scrub:push-drag-end`) — retargets, positions,
 *    renders, acks on ONE line; the incident was undiagnosable without it.
 *
 * `landFromScrub` is the scrub→play transition in the embed: playback starts
 * on `low` (same profile as the drag, usually already in RAM) and a GOP-first
 * upgrade to the desired playback tier fires after 5 s of stable playing.
 * The last pushed scrub keyframe HOLDS the track until the land's burst
 * replaces it, so the recorded→live flash is impossible by construction.
 */

import { anchorFromPosition, presentedEpoch, type PresentedAnchor } from './presented-clock.js'

/**
 * The client mapping decision carried alongside a `scrubTo`, in the shape
 * `drag-mapping.ts` produces. Structural on purpose — the viewer app ports the
 * mapping module verbatim and sends the same two values.
 */
export interface ScrubMapHintWire {
  readonly mode: 'fine' | 'coarse'
  readonly velocityPxPerS: number
}

/** The data-channel surface this session needs (structurally RTCDataChannel). */
export interface RecordedChannelLike {
  readonly readyState: string
  send(data: string): void
  addEventListener(type: 'message', cb: (ev: { data: unknown }) => void): void
  addEventListener(type: 'open' | 'close', cb: () => void): void
  removeEventListener(type: 'message', cb: (ev: { data: unknown }) => void): void
  removeEventListener(type: 'open' | 'close', cb: () => void): void
}

/** Where the pointer was asked to go while the channel negotiated. */
export type HeldIntent =
  | {
      readonly kind: 'play'
      readonly deviceId: number
      readonly epochMs: number
      readonly profile: string
    }
  | {
      readonly kind: 'clip'
      readonly deviceId: number
      readonly clipId: string
      readonly provider: string
      readonly offsetMs: number
      readonly profile?: string
    }

/**
 * A recorded pointer move asked for while the channel was still NEGOTIATING —
 * where the pointer goes and the rate the viewer wants once the channel can
 * carry them. Only the NEWEST intent is kept (a recording position and a clip
 * replace each other): the pointer is a state, and replaying an older one
 * would put it somewhere the operator has already left.
 */
export interface HeldPlayback {
  readonly intent: HeldIntent | null
  readonly rate: number | null
}

/** Why a held move never reached the wire. */
export type HeldDropReason = 'channel-closed' | 'open-timeout' | 'disposed'

/**
 * The safety bound on a channel that never settles, measured from the
 * channel's CREATION (this session's construction — the page builds one per
 * `createDataChannel`), never from the hold. A held move lives as long as the
 * channel is still negotiating: an iOS foreground return over TURN or
 * cellular can take well over 10 s, and dropping the move there would show
 * exactly the fault the hold exists to prevent. Past this bound the move is
 * dropped and REPORTED (`onHeldDropped`), so the host's play recovery applies.
 */
export const HELD_OPEN_TIMEOUT_MS = 30_000

/**
 * How long a move held on a channel that CLOSED waits to be carried into the
 * next one. A real RTCDataChannel fires `close` after `pc.close()` (measured on
 * Chromium 149, for an open channel and a `connecting` one alike), and the
 * player's non-seamless reconnect closes the old peer, waits out the retry
 * backoff (first step ≈1.5 s), fetches ICE servers and only THEN creates the
 * new channel. Reported at once, the close would flash an error the carry was
 * about to make unnecessary.
 */
export const HELD_CARRY_GRACE_MS = 5_000

/** Pointer moves after which the RTP→epoch anchor is no longer true. */
const ANCHOR_BREAKING: ReadonlySet<string> = new Set([
  'playRecorded', 'playClip', 'seek', 'setRate', 'stepFrame', 'goLive',
  'scrubStart', 'scrubTo', 'scrubCommit',
])

/** The most often a presented epoch is reported to the host. */
export const PRESENTED_REPORT_MS = 200

/** The rendered-frame callback surface (structurally HTMLVideoElement). */
export interface RecordedVideoLike {
  requestVideoFrameCallback?(cb: (now: number, metadata?: { readonly rtpTimestamp?: number }) => void): number
  cancelVideoFrameCallback?(handle: number): void
}

/** Server-reported playback state (the broker's feeder states + `live`). */
export type RecordedTrackState =
  | 'live'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'gap'
  | 'ended'
  | 'error'

const RECORDED_TRACK_STATES: readonly RecordedTrackState[] = [
  'live',
  'loading',
  'playing',
  'paused',
  'gap',
  'ended',
  'error',
]

function isRecordedTrackState(value: unknown): value is RecordedTrackState {
  return typeof value === 'string' && (RECORDED_TRACK_STATES as readonly string[]).includes(value)
}

export interface RecordedTrackSessionDeps {
  readonly channel: RecordedChannelLike
  /**
   * A move held for the open edge was DROPPED — the channel closed and no
   * carry took it within {@link HELD_CARRY_GRACE_MS}, the channel was still
   * `connecting` {@link HELD_OPEN_TIMEOUT_MS} after its creation, or the
   * session was disposed with it still held. The page reports it to the host as an error: a held
   * move that vanishes leaves the timeline saying playback over the live edge.
   */
  readonly onHeldDropped?: (reason: HeldDropReason) => void
  /** The <video> the track renders into. Null → position-message acks. */
  readonly video: () => RecordedVideoLike | null
  /** Server playback state — forward to the host's recState. */
  readonly onState?: (state: RecordedTrackState) => void
  /** Server playhead (~1 Hz in playback, per push in scrub). */
  readonly onPosition?: (epochMs: number) => void
  /**
   * The recorded epoch of the frame the browser PRESENTED, at most one report
   * per {@link PRESENTED_REPORT_MS}. Only fires when the hub's `position`
   * carries an RTP stamp AND the engine exposes `rtpTimestamp` on the frame
   * callback; otherwise `onPosition` (the send cursor) is all there is.
   */
  readonly onPresented?: (epochMs: number) => void
  /** Effective physical tier selected by the live adaptive session. */
  readonly onLiveProfile?: (profile: 'high' | 'mid' | 'low') => void
  /**
   * The recorded tier ACTUALLY playing, next to the one asked for. Sent by
   * the server whenever the pair changes — a seek that fell to Mid because
   * High has no footage there, and the one that got High back.
   */
  readonly onServedProfile?: (served: ServedProfileReport) => void
  /** First SCRUB frame rendered this drag — the host drops its placeholder. */
  readonly onFirstFrame?: () => void
  /**
   * The duration of the clip on the pointer, as the broker MEASURED it from
   * the file's own index (D575). Named by clip so a report that arrives after
   * the pointer has moved on cannot be pinned on the wrong file. Sent once
   * the clip's first seek has resolved; never sent for a file the broker
   * could not index (the state goes to `error` instead).
   */
  readonly onClipDuration?: (report: ClipDurationReport) => void
  /**
   * Whether the clip on the pointer is carrying SOUND, and why not when it is
   * not (D600, D621). Named by clip, and RE-SENT: six of the seven reasons are
   * permanent facts about the file, but `rate` comes and goes with the speed
   * chip, so the broker re-issues the answer whenever the rate crosses 1×.
   * A branch that cannot say sends nothing rather than claiming `false`.
   */
  readonly onClipAudio?: (report: ClipAudioReport) => void
  /**
   * The clip on the pointer was served SHORT, or not at all (D623).
   *
   * Sent ONCE, when the stream ENDS — after the playback it is about, which is
   * what makes the clip id on it load-bearing rather than decorative. Never
   * sent for a serve that delivered its window, and never a reason to retry:
   * a second dial contends for the camera's single replay lane at exactly the
   * moment that lane is already failing.
   */
  readonly onClipIncomplete?: (report: ClipIncompleteReport) => void
  readonly onLog?: (msg: string, data: Record<string, unknown>) => void
}

/**
 * Why a clip on the pointer is silent (D600, D621).
 *
 * Six of these are permanent facts about the file or about the negotiation
 * that carried it. `rate` is not: the broker discards every audio frame while
 * the playback rate is not 1× — deliberately, it is what the operator asked
 * for — and that answer changes under his finger. A viewer told
 * `stream-failed` when he merely pressed 2× has been told something false,
 * which is why the seventh exists at all.
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
  readonly clipId: string
  readonly carried: boolean
  readonly codec?: 'opus' | 'pcmu'
  readonly reason?: ClipAudioReason
  /** Present iff `reason` is `rate`: the rate the sound is suppressed AT. */
  readonly rate?: number
}

/**
 * How a replay failed to deliver (D623). Two words: the provider's third
 * verdict, `completeness-unverified`, is a diagnostic about the MEASUREMENT
 * and the hub's schema refuses to send it, so nothing here reads it either.
 */
export type ClipIncompleteCode = 'stream-short' | 'stream-empty'

const CLIP_INCOMPLETE_CODES: readonly ClipIncompleteCode[] = ['stream-short', 'stream-empty']

export interface ClipIncompleteReport {
  readonly clipId: string
  readonly code: ClipIncompleteCode
  /** The provider's own sentence, already prose and already Latin-1 safe.
   *  Carried verbatim: only the hub knows the figures it names. */
  readonly reason: string
}

export interface ServedProfileReport {
  readonly profile: 'high' | 'mid' | 'low'
  readonly requested: string
}

export interface ClipDurationReport {
  readonly clipId: string
  /** Strictly positive: a measurement that failed is not sent, and never zero (D393). */
  readonly durationMs: number
}

/** The profile every pushed scrub reads from — and the profile a scrub commit lands on. */
export const SCRUB_PROFILE = 'low'
/** Wall time after the first playing/paused land before a high/mid upgrade seek. */
export const SCRUB_PLAYBACK_UPGRADE_MS = 5_000

export class RecordedTrackSession {
  private begun = false
  private disposed = false
  /** The profile the server was last TOLD — idempotence by VALUE. The storm
   *  fix requires that a drag's re-begins never re-send the pin (a changed
   *  profile mid-recorded rebuilds the feeder); but the pin must not be
   *  once-per-channel either, or a scrub's `low` leaks into playback quality
   *  after a commit and a later drag scrubs at the playback profile. A begin
   *  re-pins only when the last-sent profile differs; the server additionally
   *  ignores an unchanged pin. */
  private lastSentProfile: string | null = null
  /**
   * The tier the server last reported it could NOT honour for this session,
   * or null. A delayed scrub upgrade into it would only freeze the picture
   * on a seek the server will refuse the same way again.
   */
  private degradedRequest: string | null = null
  /** Server positions received since `begin()` — 0 ⇒ rendered frames are live
   *  stragglers, not scrub frames. */
  private positionsSeen = 0
  private firstFrameAnnounced = false
  private rvfcHandle: number | null = null
  /**
   * The push sequence of the newest `position` seen — echoed on every ack so
   * the server knows WHICH push is being settled. Null until the first pushed
   * position of a drag (a playback position carries none).
   *
   * It is what lets the two halves count in different units and both be right:
   * with rvfc this session acks once per RENDERED FRAME (N acks for a sweep of
   * N), without it once per POSITION (one ack for the same sweep). Naming the
   * push makes the first ack settle it and the surplus a no-op.
   */
  private lastPushSeq: number | null = null
  /** Drag accounting for the `scrub:push-drag-end` summary. */
  private retargets = 0
  private renders = 0
  /** Pushed frames rendered this drag, with the first and last render time —
   *  summarised once at the drag's end, never one log line per frame. */
  private drawnCount = 0
  private drawnFirstAt: number | null = null
  private drawnLastAt: number | null = null
  private acks = 0
  private lastCursorMs: number | null = null
  /** Last server playback state — a second land while still `playing` must
   *  re-arm the upgrade without waiting for a duplicate `playing` event. */
  private lastState: RecordedTrackState | null = null
  /** Wall clock of the last play/land/seek intent — `playback:ready` waitMs. */
  private playIntentAt: number | null = null
  private playIntentKind: string | null = null
  /** The drag this intent commits, when it is a scrub commit (`landFromScrub`) —
   *  undefined for a bare `playRecorded`/`seek` tap. Read once by the matching
   *  `playback:ready` and cleared with the rest of the intent, so a later
   *  unrelated intent can never inherit a stale id. */
  private playIntentDragId: string | undefined = undefined
  private pendingUpgrade: {
    deviceId: number
    desiredProfile: string
    landEpochMs: number
  } | null = null
  private upgradeTimer: ReturnType<typeof setTimeout> | null = null
  /** Prefetch the destination tier ~1.5 s before the hard switch. */
  private upgradeWarmTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * The clip the pointer is on, or null on the recorder's own footage.
   *
   * The broker's `TimelineSession` keeps the same fact and routes `seek` /
   * `scrubCommit` / `setRate` / `stepFrame` to the clip feeder while it is
   * set — and LEAVES the clip on `playRecorded`. This class used to turn every
   * scrub release (`landFromScrub`) and every post-seek climb
   * (`upgradePlayback`) into a `playRecorded`, so the server's routing was
   * never exercised from the app: a drag inside a clip landed on the
   * recorder's footage at "epoch 12 000" and the file was gone. The mirror
   * exists so the decision is made ONCE, here, for every pointer verb.
   */
  private clipId: string | null = null
  private readonly onMessage = (ev: { data: unknown }): void => {
    if (this.disposed) return
    if (typeof ev.data !== 'string') return
    let parsed: unknown
    try {
      parsed = JSON.parse(ev.data)
    } catch {
      return
    }
    if (typeof parsed !== 'object' || parsed === null) return
    const msg = parsed as {
      t?: unknown
      state?: unknown
      epochMs?: unknown
      profile?: unknown
      seq?: unknown
    }
    if (
      msg.t === 'liveProfile' &&
      (msg.profile === 'high' || msg.profile === 'mid' || msg.profile === 'low')
    ) {
      this.deps.onLiveProfile?.(msg.profile)
      return
    }
    if (
      msg.t === 'servedProfile' &&
      (msg.profile === 'high' || msg.profile === 'mid' || msg.profile === 'low') &&
      typeof (msg as { requested?: unknown }).requested === 'string'
    ) {
      const requested = (msg as { requested: string }).requested
      // The mirror learns the server moved: a later setProfile to what is
      // already playing is a no-op, not a re-pin of a tier with no footage.
      this.lastSentProfile = msg.profile
      this.degradedRequest = msg.profile === requested ? null : requested
      // An upgrade already armed into the degraded tier is the freeze this
      // report exists to prevent: drop it, the low picture stays.
      if (this.degradedRequest !== null && this.pendingUpgrade?.desiredProfile === this.degradedRequest) {
        this.deps.onLog?.('scrub:playback-upgrade-vetoed', { to: this.degradedRequest })
        this.cancelPlaybackUpgrade()
      }
      this.deps.onServedProfile?.({ profile: msg.profile, requested })
      return
    }
    if (msg.t === 'clipDuration') {
      // Strictly positive, or nothing: a duration of 0 would say the file is
      // empty, and a missing one is a measurement nobody made (D393).
      const report = msg as { clipId?: unknown; durationMs?: unknown }
      if (
        typeof report.clipId === 'string' &&
        typeof report.durationMs === 'number' &&
        Number.isFinite(report.durationMs) &&
        report.durationMs > 0
      ) {
        this.deps.onClipDuration?.({ clipId: report.clipId, durationMs: report.durationMs })
      }
      return
    }
    if (msg.t === 'clipAudio') {
      const report = msg as {
        clipId?: unknown
        carried?: unknown
        codec?: unknown
        reason?: unknown
        rate?: unknown
      }
      // Without a clip to pin it on, a report is unusable: the pointer moves
      // between files and an unnamed answer would be drawn over whichever one
      // happens to be on the stage. And "we do not know" is a third answer —
      // a message with no `carried` says nothing and is not turned into a
      // `false` this class invented.
      if (typeof report.clipId !== 'string' || report.clipId.length === 0) return
      if (typeof report.carried !== 'boolean') return
      const codec = report.codec === 'opus' || report.codec === 'pcmu' ? report.codec : undefined
      // A reason this build has never heard of is DROPPED, not forwarded: the
      // consumer switches on the seven it knows, and an eighth word would fall
      // through every arm and render as an unexplained silence anyway. What is
      // kept is the part that is still true — there is no sound.
      const named = CLIP_AUDIO_REASONS.find((known) => known === report.reason)
      const rate =
        typeof report.rate === 'number' && Number.isFinite(report.rate) && report.rate > 0
          ? report.rate
          : undefined
      // The pair is enforced on the hub's serializer (D621), so neither half
      // can arrive without the other from a hub that has it. If it does, a
      // `N×` badge with no N is exactly the unanswerable message the reason
      // was added to replace — so the CAUSE is dropped and the silence stands
      // unexplained, which is what this viewer showed before D621 and is at
      // least true.
      const paired = named === 'rate' && rate === undefined ? undefined : named
      this.deps.onClipAudio?.({
        clipId: report.clipId,
        carried: report.carried,
        ...(codec === undefined ? {} : { codec }),
        ...(paired === undefined ? {} : { reason: paired }),
        ...(paired === 'rate' && rate !== undefined ? { rate } : {}),
      })
      return
    }
    if (msg.t === 'clipIncomplete') {
      const report = msg as { clipId?: unknown; code?: unknown; reason?: unknown }
      // Without a clip to pin it on this is unusable: the report lands at the
      // END of the stream, so the pointer may already be on the next file and
      // an unnamed verdict would be drawn over it.
      if (typeof report.clipId !== 'string' || report.clipId.length === 0) return
      // A code this build has never heard of is DROPPED rather than forwarded.
      // The consumer switches on the two it knows, and a third word would fall
      // through every arm — which is how `completeness-unverified`, a provider
      // diagnostic the hub already refuses to send, would otherwise reach a
      // screen as an unexplained complaint.
      const code = CLIP_INCOMPLETE_CODES.find((known) => known === report.code)
      if (code === undefined) return
      // The sentence IS the message; nothing downstream has words of its own.
      if (typeof report.reason !== 'string' || report.reason.trim().length === 0) return
      this.deps.onClipIncomplete?.({ clipId: report.clipId, code, reason: report.reason })
      return
    }
    if (msg.t === 'state' && isRecordedTrackState(msg.state)) {
      this.lastState = msg.state
      if (msg.state === 'playing' || msg.state === 'paused') {
        this.maybeArmPlaybackUpgrade()
        if (this.playIntentAt !== null) {
          this.deps.onLog?.('playback:ready', {
            kind: this.playIntentKind,
            state: msg.state,
            waitMs: Math.round(performance.now() - this.playIntentAt),
            dragId: this.playIntentDragId,
          })
          this.playIntentAt = null
          this.playIntentKind = null
          this.playIntentDragId = undefined
        }
      } else if (msg.state === 'live' || msg.state === 'gap' || msg.state === 'ended' || msg.state === 'error') {
        this.cancelPlaybackUpgrade()
      }
      this.deps.onState?.(msg.state)
      return
    }
    if (msg.t !== 'position' || typeof msg.epochMs !== 'number') return
    this.lastCursorMs = msg.epochMs
    this.deps.onPosition?.(msg.epochMs)
    this.presentedAnchor = anchorFromPosition({ ...msg, epochMs: msg.epochMs })
    if (this.presentedAnchor !== null) this.armPresented()
    // Only a position a PUSH emitted carries a sequence; keep the newest so
    // every ack names the push it settles.
    if (typeof msg.seq === 'number') this.lastPushSeq = msg.seq
    if (!this.begun) return
    this.positionsSeen += 1
    // No rvfc on this platform → the per-push position message is the only
    // receiver-side delivery signal there is; ack on it so the train flows.
    if (!this.rvfcCapable()) {
      this.acks += 1
      this.sendAck()
    }
  }

  /** One receiver-credit ack, naming the newest push this viewer has seen. */
  private sendAck(): void {
    this.send(
      this.lastPushSeq === null ? { t: 'scrubAck' } : { t: 'scrubAck', seq: this.lastPushSeq },
    )
  }

  /**
   * The pointer moves held for the channel's open edge (see
   * {@link acceptsPointerMoves}). Null when nothing is waiting.
   */
  private held: HeldPlayback | null = null
  /** Bounds how long {@link held} may wait: the open bound, or the carry grace. */
  private heldTimer: ReturnType<typeof setTimeout> | null = null
  /** When the channel was created — the open bound runs from here. */
  private readonly createdAt = Date.now()

  constructor(private readonly deps: RecordedTrackSessionDeps) {
    this.deps.channel.addEventListener('message', this.onMessage)
    this.deps.channel.addEventListener('open', this.onOpen)
    this.deps.channel.addEventListener('close', this.onClose)
  }

  /** Replace what is held, arming the channel's open bound on the first hold. */
  private hold(next: HeldPlayback): void {
    this.held = next
    if (this.heldTimer !== null) return
    const remaining = Math.max(0, this.createdAt + HELD_OPEN_TIMEOUT_MS - Date.now())
    this.heldTimer = setTimeout(() => {
      this.heldTimer = null
      this.dropHeld('open-timeout')
    }, remaining)
  }

  /** Forget what is held without reporting it (sent, or superseded by a newer move). */
  private clearHeld(): void {
    this.held = null
    if (this.heldTimer !== null) {
      clearTimeout(this.heldTimer)
      this.heldTimer = null
    }
  }

  /** A held move will never be sent: say so, with the reason. */
  private dropHeld(reason: HeldDropReason): void {
    const held = this.held
    this.clearHeld()
    if (held === null) return
    this.deps.onLog?.('playback:held-dropped', { reason, ...describeHeld(held) })
    this.deps.onHeldDropped?.(reason)
  }

  /**
   * The channel closed with a move still held. Not reported yet: the player's
   * reconnect is usually about to build the next channel, and the page carries
   * the move into it (`takeHeld`). Only a carry that does not come within
   * {@link HELD_CARRY_GRACE_MS} reports the drop.
   */
  private readonly onClose = (): void => {
    if (this.held === null || this.disposed) return
    if (this.heldTimer !== null) clearTimeout(this.heldTimer)
    this.deps.onLog?.('playback:held-awaiting-carry', describeHeld(this.held))
    this.heldTimer = setTimeout(() => {
      this.heldTimer = null
      this.dropHeld('channel-closed')
    }, HELD_CARRY_GRACE_MS)
  }

  /**
   * Hand over what is held — the page carries it into the session that
   * REPLACES this one (an auto-retry or reconnect built a new channel before
   * this one opened). Clears it here, so disposing this session drops nothing.
   */
  takeHeld(): HeldPlayback | null {
    const held = this.held
    this.clearHeld()
    return held
  }

  /**
   * Take a move held by the session this one replaces, at its creation. The
   * carried move is the NEWEST intent: the only thing this session can hold
   * yet is a clip that waited for a channel because the old one could not take
   * it — asked for before the old session held this move. So the carried
   * intent and rate win, and only what they leave unset is kept. Sent now on
   * an open channel, held on a negotiating one, reported dropped on a dead one.
   */
  adoptHeld(carried: HeldPlayback): void {
    const merged: HeldPlayback = {
      intent: carried.intent ?? this.held?.intent ?? null,
      rate: carried.rate ?? this.held?.rate ?? null,
    }
    this.deps.onLog?.('playback:held-carried', describeHeld(merged))
    if (this.isOpen()) {
      this.clearHeld()
      this.flushHeld(merged)
      return
    }
    this.hold(merged)
    if (!this.negotiating()) this.dropHeld('channel-closed')
  }

  /** Send a held move: the intent first, then the rate it applies to. */
  private flushHeld(held: HeldPlayback): void {
    const intent = held.intent
    if (intent?.kind === 'play') {
      this.sendPlayRecorded(intent.deviceId, intent.epochMs, intent.profile, 'play')
    } else if (intent?.kind === 'clip') {
      this.playClip(intent.deviceId, intent.clipId, intent.provider, intent.offsetMs, intent.profile)
    }
    if (held.rate !== null) this.send({ t: 'setRate', rate: held.rate })
  }

  /**
   * The channel's open edge: send what was asked for while it negotiated, in
   * the order the viewer gave it — position first, then the rate (a paused
   * viewer is paused AT that position).
   */
  private readonly onOpen = (): void => {
    const held = this.held
    this.clearHeld()
    if (held === null || this.disposed) return
    this.deps.onLog?.('playback:held-flush', describeHeld(held))
    this.flushHeld(held)
  }

  /** The channel exists and is still negotiating — not open, not dead. */
  private negotiating(): boolean {
    return !this.disposed && this.deps.channel.readyState === 'connecting'
  }

  private rvfcCapable(): boolean {
    return typeof this.deps.video()?.requestVideoFrameCallback === 'function'
  }

  /** True = sent; false = channel not open (the caller surfaces the gap). */
  private send(msg: Record<string, unknown>): boolean {
    if (this.disposed || this.deps.channel.readyState !== 'open') return false
    // Any pointer move invalidates the RTP mapping: a frame presented before
    // the hub answers belongs to the OLD pointer, and mapping it through the
    // old anchor is the stale box after a seek. The next `position` re-anchors.
    if (typeof msg.t === 'string' && ANCHOR_BREAKING.has(msg.t)) this.presentedAnchor = null
    this.deps.channel.send(JSON.stringify(msg))
    return true
  }

  private sendPlayRecorded(
    deviceId: number,
    epochMs: number,
    profile: string,
    intent: 'play' | 'land' | 'upgrade',
    /** The scrub gesture this commits, when it is a commit (`landFromScrub`).
     *  Diagnostic only — `playRecorded` has no `dragId` on the wire, so this
     *  never rides the `send()` below; it only tags the LOCAL `playback:intent`
     *  line and the `playback:ready` it will later match. */
    dragId?: string,
  ): boolean {
    const sent = this.send({ t: 'playRecorded', deviceId, epoch: epochMs, profile })
    if (sent) {
      this.lastSentProfile = profile
      this.playIntentAt = performance.now()
      this.playIntentKind = intent
      this.playIntentDragId = dragId
      this.deps.onLog?.('playback:intent', { kind: intent, deviceId, epochMs, profile, dragId })
    }
    return sent
  }

  private maybeArmPlaybackUpgrade(): void {
    if (this.pendingUpgrade === null || this.upgradeTimer !== null || this.disposed) return
    this.upgradeTimer = setTimeout(() => this.firePlaybackUpgrade(), SCRUB_PLAYBACK_UPGRADE_MS)
    const pending = this.pendingUpgrade
    this.upgradeWarmTimer = setTimeout(() => {
      this.upgradeWarmTimer = null
      if (this.pendingUpgrade === null || this.disposed) return
      const epoch = this.lastCursorMs ?? pending.landEpochMs
      this.warm(epoch, pending.desiredProfile)
    }, Math.max(0, SCRUB_PLAYBACK_UPGRADE_MS - 1_500))
  }

  private firePlaybackUpgrade(): void {
    this.upgradeTimer = null
    const pending = this.pendingUpgrade
    this.pendingUpgrade = null
    if (!pending || this.disposed) return
    const epoch = this.lastCursorMs ?? pending.landEpochMs
    this.sendPlayRecorded(pending.deviceId, epoch, pending.desiredProfile, 'upgrade')
    this.deps.onLog?.('scrub:playback-upgrade', {
      from: SCRUB_PROFILE,
      to: pending.desiredProfile,
      epochMs: epoch,
    })
  }

  private cancelPlaybackUpgrade(): void {
    if (this.upgradeTimer !== null) {
      clearTimeout(this.upgradeTimer)
      this.upgradeTimer = null
    }
    if (this.upgradeWarmTimer !== null) {
      clearTimeout(this.upgradeWarmTimer)
      this.upgradeWarmTimer = null
    }
    this.pendingUpgrade = null
  }

  // ── The pointer vocabulary ─────────────────────────────────────────────────

  /** Move the pointer into recorded playback at `epochMs`, at `profile`.
   *  `playRecorded` carries the profile server-side, so it also updates the
   *  last-sent pin — a later drag re-pins `low` before its first push. A
   *  heatmap tap cancels a pending scrub-land upgrade (it already carries
   *  the playback profile). */
  playRecorded(deviceId: number, epochMs: number, profile: string): boolean {
    this.cancelPlaybackUpgrade()
    // The recorder takes the pointer back — the server's `leaveClip` is on
    // this same message, so the mirror moves with it.
    this.clipId = null
    // A reconnect is in flight (the app came back to the foreground, the
    // network changed): this connection's channel is still negotiating. The
    // position is HELD for its open edge — refusing it here reported a dead
    // stream for a connection that was a moment from working, and the viewer
    // was dropped at the live edge instead of where the cursor stood.
    if (this.negotiating()) {
      this.hold({ intent: { kind: 'play', deviceId, epochMs, profile }, rate: this.held?.rate ?? null })
      return true
    }
    return this.sendPlayRecorded(deviceId, epochMs, profile, 'play')
  }

  /** Whether the pointer is on a FILE right now — or is held to go onto one at
   *  the open edge. The page reads it to keep a bare `seek` on the clip's axis
   *  instead of turning it into `playRecorded`. */
  holdsClip(): boolean {
    return this.clipId !== null || this.held?.intent?.kind === 'clip'
  }

  /**
   * Move the pointer into a stored CLIP, at `offsetMs` from its first sample.
   *
   * One message and no protocol of its own, which is the whole of D575: a clip
   * is another position of the recorded source pointer, so everything after
   * this — `seek`, `scrubTo`, `scrubCommit`, `setRate`, `stepFrame` — travels
   * on the clip's own file-relative axis unchanged. `goLive` leaves it in one
   * dispatch. A second vocabulary here is what made 1.0.512 ship a frozen UI.
   *
   * `offsetMs` is REQUIRED and clamped at zero: an unstated position is not
   * zero (D382), and a negative one is a rounding artefact at the head of a
   * clip that the server's `min(0)` would refuse — losing the operator's tap
   * to it would be a silent dead press.
   *
   * `profile` is omitted when none was picked. A stored file has no broker
   * session to resolve an adaptive tier against, so `auto` is not in this
   * domain at all; absent means the provider's own default, and a client that
   * guessed would be choosing a twin on the operator's behalf, in silence.
   */
  playClip(
    deviceId: number,
    clipId: string,
    provider: string,
    offsetMs: number,
    profile?: string,
  ): boolean {
    this.cancelPlaybackUpgrade()
    // Held for the open edge like a recording position, and REPLACING it: the
    // newest intent is where the pointer goes. The page's own retry slot
    // (`pendingClipRef`) asserted AFTER the session's flush, so an older clip
    // overwrote a newer position.
    if (this.negotiating()) {
      const clip: HeldIntent = {
        kind: 'clip',
        deviceId,
        clipId,
        provider,
        offsetMs,
        ...(profile === undefined ? {} : { profile }),
      }
      this.hold({ intent: clip, rate: this.held?.rate ?? null })
      return true
    }
    const sent = this.send({
      t: 'playClip',
      deviceId,
      clipId,
      // NAMED all the way down. The broker reads the bytes through a
      // collection capability with more than one provider on the same camera,
      // and with no name the read resolved to its own addon's sibling — the
      // recorder — which has no file behind an analytics visit (3628,
      // 2026-09-21).
      provider,
      offsetMs: Math.max(0, Math.round(offsetMs)),
      ...(profile === undefined ? {} : { profile }),
    })
    // Mirror only what reached the wire: a refused send leaves the pointer
    // where it was, on the server and here.
    if (sent) this.clipId = clipId
    return sent
  }

  /**
   * Climb from the low land to a probed (or pinned) playback tier. Warms the
   * GOP cache of the target rung then seeks there. No-op when already on it.
   */
  upgradePlayback(deviceId: number, epochMs: number, profile: string): boolean {
    if (profile === this.lastSentProfile) return true
    if (this.clipId !== null) {
      // A file has no tier to climb to, and the climb is a `playRecorded`,
      // which LEAVES the clip. Refused by name — a branch that drops work
      // silently reads as "never happened".
      this.deps.onLog?.('clip:playback-upgrade-refused', { clipId: this.clipId, to: profile })
      return true
    }
    this.cancelPlaybackUpgrade()
    this.warm(epochMs, profile)
    return this.sendPlayRecorded(deviceId, epochMs, profile, 'upgrade')
  }

  /**
   * Scrub finger-up: end the drag and start playback on `low` immediately
   * (same profile as the drag, usually already in the session cache). If
   * `desiredProfile` is a higher tier, a GOP-first seek at the live playhead
   * fires after {@link SCRUB_PLAYBACK_UPGRADE_MS} of stable playback.
   *
   * `dragId` is the SAME id the drag's `begin()` got — the caller (the host's
   * `scrubCommit` command) carries it from the same gesture's `scrubStart`.
   * See `sendPlayRecorded` for why it never reaches the `playRecorded` wire
   * message itself.
   */
  landFromScrub(deviceId: number, epochMs: number, desiredProfile: string, dragId?: string): boolean {
    this.end()
    this.cancelPlaybackUpgrade()
    if (this.clipId !== null) {
      // On a file the release is the wire's own `scrubCommit`, which the
      // broker routes to the clip feeder on the file's axis. `epochMs` is
      // file-relative here — the name lies. No profile, no land, no climb:
      // each of those is a `playRecorded`, and that message leaves the clip.
      const committed = this.commit(epochMs, dragId)
      if (committed) {
        this.lastCursorMs = epochMs
        this.deps.onLog?.('playback:intent', { kind: 'clip-commit', deviceId, epochMs, dragId })
      }
      return committed
    }
    const sent = this.sendPlayRecorded(deviceId, epochMs, SCRUB_PROFILE, 'land', dragId)
    if (!sent) return false
    this.lastCursorMs = epochMs
    if (desiredProfile === this.degradedRequest) {
      // The server said this tier has no footage here; climbing into it would
      // be the freeze the report exists to prevent. Low stays.
      this.deps.onLog?.('scrub:playback-upgrade-vetoed', { to: desiredProfile, epochMs })
    } else if (desiredProfile !== SCRUB_PROFILE) {
      this.pendingUpgrade = { deviceId, desiredProfile, landEpochMs: epochMs }
      // Fill the high/mid GOP cache while low is already playing — the upgrade
      // seek otherwise starts cold and the picture freezes on the switch.
      this.warm(epochMs, desiredProfile)
      if (this.lastState === 'playing' || this.lastState === 'paused') {
        this.maybeArmPlaybackUpgrade()
      }
    }
    return true
  }

  /** Seek the recorded pointer (enters recorded from live server-side). Not a
   *  drag gesture — never carries a `dragId`, and clears any leftover from an
   *  in-flight scrub intent so a later `playback:ready` cannot misattribute. */
  seek(epochMs: number): boolean {
    this.cancelPlaybackUpgrade()
    // A clip held for the open edge: a seek on its (file-relative) axis moves
    // the held offset. Any other seek on a negotiating channel is refused.
    const held = this.held
    if (this.negotiating() && held?.intent?.kind === 'clip') {
      this.hold({ intent: { ...held.intent, offsetMs: epochMs }, rate: held.rate })
      return true
    }
    const sent = this.send({ t: 'seek', epoch: epochMs })
    if (sent) {
      this.playIntentAt = performance.now()
      this.playIntentKind = 'seek'
      this.playIntentDragId = undefined
      this.deps.onLog?.('playback:intent', { kind: 'seek', epochMs })
    }
    return sent
  }

  /**
   * Timeline warm-up: ask the server to pre-run locate + GOP fetch + demux for
   * the instant the timeline OPENS on, at the scrub profile — so the first
   * drag's push pays none of that chain. Pure cache fill server-side: it never
   * gates live, never builds a feeder, never moves the pointer, which is why
   * it deliberately does NOT touch `lastSentProfile` (it is not a pin). Send
   * it when the timeline UI appears, and again when the playhead settles
   * somewhere new while idle.
   */
  warm(epochMs: number, profile: string = SCRUB_PROFILE): boolean {
    return this.send({ t: 'warm', epoch: epochMs, profile })
  }

  /** Playback rate: 0 pauses; the server clamps the rest to [0.25, 4]. */
  setRate(rate: number): boolean {
    // Held with the position it applies to — see `playRecorded`.
    if (this.negotiating()) {
      this.hold({ intent: this.held?.intent ?? null, rate })
      return true
    }
    return this.send({ t: 'setRate', rate })
  }

  /**
   * Whether the page may hand this session a pointer move: the channel is
   * open, or still negotiating (a playback position and rate are then held
   * for its open edge; every other move still reports the gap).
   */
  acceptsPointerMoves(): boolean {
    return this.isOpen() || this.negotiating()
  }

  /** Feed exactly one frame forward/backward (server-side, while paused). */
  stepFrame(dir: 1 | -1): boolean {
    return this.send({ t: 'stepFrame', dir })
  }

  /**
   * The scrub→play transition: end the drag and seek the pointer to the
   * release epoch with ONE message. The last pushed scrub keyframe holds the
   * track until the seek's burst replaces it — never a go-live in between.
   *
   * `dragId` is the SAME id the drag's `begin()` sent — the hub's
   * `TimelineSession` carries it into the feeder's seek so every
   * `recorded:seek-*`/`scrub-feeder:*` line the commit produces names the
   * gesture it belongs to.
   */
  commit(epochMs: number, dragId?: string): boolean {
    this.end()
    return this.send(dragId !== undefined ? { t: 'scrubCommit', epoch: epochMs, dragId } : { t: 'scrubCommit', epoch: epochMs })
  }

  /** Ungate the live feed (disposes the server feeder) and end any drag. */
  goLive(): boolean {
    this.cancelPlaybackUpgrade()
    // Live supersedes a position held for the open edge.
    this.clearHeld()
    const sent = this.send({ t: 'goLive' })
    if (sent) {
      this.deps.onLog?.('scrub:push-golive', { clipId: this.clipId })
      // One dispatch leaves the clip and forgets it (D570), server and mirror.
      this.clipId = null
    }
    this.end()
    return sent
  }

  // ── The scrub sub-mode ─────────────────────────────────────────────────────

  /** Whether a drag can ride this session right now. */
  isActive(): boolean {
    return this.begun && !this.disposed && this.deps.channel.readyState === 'open'
  }

  /** Whether the channel can carry pointer moves at all (drag or not). */
  isOpen(): boolean {
    return !this.disposed && this.deps.channel.readyState === 'open'
  }

  /**
   * Enter the server's scrub sub-mode for a new drag. False when the channel
   * is not open — the caller reports that no scrub surface is available.
   *
   * `dragId` is the client's id for this gesture (`scrub-drag-id.ts` on the
   * host) — optional, and carried on the wire message so the hub's
   * `scrub-feeder:*` lines can be joined to this session's own.
   */
  begin(dragId?: string): boolean {
    if (this.disposed || this.deps.channel.readyState !== 'open') return false
    if (this.begun) return true // re-entrant scrubStart mid-drag — server no-ops too
    this.begun = true
    this.positionsSeen = 0
    this.firstFrameAnnounced = false
    this.retargets = 0
    this.renders = 0
    this.acks = 0
    this.drawnCount = 0
    this.drawnFirstAt = null
    this.drawnLastAt = null
    this.cancelPlaybackUpgrade()
    // Idempotence by VALUE — see `lastSentProfile`. Within a drag, the host's
    // scrubStart storm re-begins with the pin unchanged → nothing is sent and
    // the feeder is never torn down mid-drag; after a playback at another
    // profile, the next drag re-pins `low` before its first push.
    if (this.lastSentProfile !== SCRUB_PROFILE) {
      this.lastSentProfile = SCRUB_PROFILE
      this.send({ t: 'setProfile', profile: SCRUB_PROFILE })
    }
    this.send(dragId !== undefined ? { t: 'scrubStart', dragId } : { t: 'scrubStart' })
    this.armRenderAck()
    this.deps.onLog?.('scrub:push-begin', { rvfc: this.rvfcCapable(), dragId })
    return true
  }

  /**
   * Retarget the in-flight server sweep. A no-op unless begun (the server
   * guards identically, so a stray move can never start a session).
   *
   * `hint` is the px→time mapping decision that produced this target
   * (`drag-mapping.ts`: `fine` jog dial vs `coarse` absolute zoom, and the
   * velocity that decided it). It is INSTRUMENTATION — the server pushes the
   * same frames without it — but it is the only way the mapping phase reaches
   * the hub logs, and the hub is the only place Loki reads. A caller that
   * cannot supply it leaves the drag's mapping UNKNOWN on the aggregate.
   */
  retarget(epochMs: number, hint?: ScrubMapHintWire): void {
    if (!this.isActive()) return
    this.retargets += 1
    this.send(
      hint
        ? { t: 'scrubTo', epoch: epochMs, m: hint.mode, v: Math.round(hint.velocityPxPerS) }
        : { t: 'scrubTo', epoch: epochMs },
    )
  }

  /** End the DRAG without touching the server pointer: the last pushed frame
   *  keeps holding on the track. (`commit`/`goLive` are the pointer moves.) */
  end(): void {
    if (this.begun) {
      // The whole drag on one line — retargets asked, positions the server
      // pushed, frames the viewer rendered, credits returned. The incident was
      // undiagnosable because these four lived in four different silences.
      this.deps.onLog?.('scrub:push-drag-end', {
        retargets: this.retargets,
        positions: this.positionsSeen,
        renders: this.renders,
        acks: this.acks,
      })
      if (this.drawnCount > 0) {
        this.deps.onLog?.('scrub:drawn', {
          depth: 'push',
          count: this.drawnCount,
          firstAt: this.drawnFirstAt,
          lastAt: this.drawnLastAt,
        })
      }
    }
    this.begun = false
    this.cancelRenderAck()
  }

  dispose(): void {
    this.cancelPlaybackUpgrade()
    this.presentedAnchor = null
    if (this.presentedHandle !== null) this.deps.video()?.cancelVideoFrameCallback?.(this.presentedHandle)
    this.presentedHandle = null
    this.end()
    // Still held here means nobody carried it (`takeHeld`): report it.
    this.dropHeld('disposed')
    this.disposed = true
    this.deps.channel.removeEventListener('message', this.onMessage)
    this.deps.channel.removeEventListener('open', this.onOpen)
    this.deps.channel.removeEventListener('close', this.onClose)
  }

  /** The RTP→epoch mapping of the newest `position`; null = no presented time. */
  private presentedAnchor: PresentedAnchor | null = null
  private presentedHandle: number | null = null
  private lastPresentedAt = 0

  /** One presented-frame subscription at a time, re-armed per frame. */
  private armPresented(): void {
    if (this.presentedHandle !== null || this.begun || this.disposed) return
    const video = this.deps.video()
    if (!video?.requestVideoFrameCallback || !this.deps.onPresented) return
    this.presentedHandle = video.requestVideoFrameCallback((_now, metadata) => {
      this.presentedHandle = null
      if (this.disposed || this.begun) return
      const epoch = presentedEpoch(this.presentedAnchor, metadata?.rtpTimestamp)
      const at = Date.now()
      if (epoch !== null && at - this.lastPresentedAt >= PRESENTED_REPORT_MS) {
        this.lastPresentedAt = at
        this.deps.onPresented?.(epoch)
      }
      // Re-arm only while there is something to map; the next position with an
      // RTP stamp re-arms after a break.
      if (this.presentedAnchor !== null) this.armPresented()
    })
  }

  /** One rendered-frame subscription at a time, re-armed per frame. */
  private armRenderAck(): void {
    const video = this.deps.video()
    if (!video?.requestVideoFrameCallback) return
    this.rvfcHandle = video.requestVideoFrameCallback(() => {
      this.rvfcHandle = null
      if (!this.begun || this.disposed) return
      // Live-straggler guard: before the first pushed position, a rendered
      // frame is the tail of the live stream — not the scrub train.
      if (this.positionsSeen > 0) {
        this.renders += 1
        this.acks += 1
        this.sendAck()
        if (!this.firstFrameAnnounced) {
          this.firstFrameAnnounced = true
          this.deps.onFirstFrame?.()
        }
        // Pushed-frame rendering stays visible in the diagnostics as ONE
        // summary per drag (`end`), not a line per frame.
        const now = Date.now()
        this.drawnCount += 1
        this.drawnFirstAt ??= now
        this.drawnLastAt = now
      }
      this.armRenderAck()
    })
  }

  private cancelRenderAck(): void {
    if (this.rvfcHandle === null) return
    this.deps.video()?.cancelVideoFrameCallback?.(this.rvfcHandle)
    this.rvfcHandle = null
  }
}

/** The log shape of a held move: what it was, never the whole clip id. */
function describeHeld(held: HeldPlayback): Record<string, unknown> {
  const intent = held.intent
  return {
    intent: intent?.kind ?? null,
    epochMs: intent?.kind === 'play' ? intent.epochMs : null,
    clipId: intent?.kind === 'clip' ? intent.clipId.slice(0, 120) : null,
    offsetMs: intent?.kind === 'clip' ? intent.offsetMs : null,
    rate: held.rate,
  }
}
