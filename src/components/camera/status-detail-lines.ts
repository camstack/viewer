/**
 * The lines a status popover shows for a battery or a network link — pure, so
 * the one thing that matters about them can be asserted without a renderer.
 *
 * That one thing is: **no fabricated number.** Three of these fields are
 * tri-states and every one of them has, at some point in this app, been drawn
 * as a figure it does not carry:
 *
 *  - `signalPercent: null` is "not read" or "does not apply" — a wire has no
 *    signal — and it is NOT 0 %;
 *  - `binary: true` is a camera that reports ok/low and no percentage at all,
 *    so the charge line is a word, not `100%`;
 *  - `charging: 'unknown'` is the absence of a read, and reads very differently
 *    from `'none'` on a camera you are deciding whether to go and fetch.
 *
 * A line therefore carries EITHER a literal already formatted (a figure, an
 * SSID) or a translation key for a worded value — never both, which is what the
 * discriminated union buys. The component only translates; the decision of
 * whether a number exists is taken here.
 */
import type { ClimbHoldCode, StreamDebugSample, StreamFreezeVerdict } from '../../live/stream-debug-sample.js'
import type { BatteryStatus } from '../../data/use-battery.js'
import type { NetworkLinkStatus } from '../../data/use-network-link.js'

/** Every i18n key the popover can render. Listed once so a spec can prove both
 *  languages translate all of them. */
export const STATUS_DETAIL_KEY = {
  batteryTitle: 'v2.statusDetail.batteryTitle',
  linkTitle: 'v2.statusDetail.linkTitle',
  streamTitle: 'v2.statusDetail.streamTitle',
  label: {
    charge: 'v2.statusDetail.label.charge',
    charging: 'v2.statusDetail.label.charging',
    state: 'v2.statusDetail.label.state',
    linkType: 'v2.statusDetail.label.linkType',
    signal: 'v2.statusDetail.label.signal',
    ssid: 'v2.statusDetail.label.ssid',
    verdict: 'v2.statusDetail.label.verdict',
    picture: 'v2.statusDetail.label.picture',
    bitrate: 'v2.statusDetail.label.bitrate',
    decoded: 'v2.statusDetail.label.decoded',
    freezes: 'v2.statusDetail.label.freezes',
    keyframeRequests: 'v2.statusDetail.label.keyframeRequests',
    loss: 'v2.statusDetail.label.loss',
    latency: 'v2.statusDetail.label.latency',
    path: 'v2.statusDetail.label.path',
    servedRung: 'v2.statusDetail.label.servedRung',
    source: 'v2.statusDetail.label.source',
    ingest: 'v2.statusDetail.label.ingest',
    egress: 'v2.statusDetail.label.egress',
    ladder: 'v2.statusDetail.label.ladder',
    ladderWhy: 'v2.statusDetail.label.ladderWhy',
  },
  value: {
    unknown: 'v2.statusDetail.value.unknown',
    notApplicable: 'v2.statusDetail.value.notApplicable',
    binary: 'v2.statusDetail.value.binary',
    sleeping: 'v2.statusDetail.value.sleeping',
    chargingDc: 'v2.statusDetail.value.chargingDc',
    chargingSolar: 'v2.statusDetail.value.chargingSolar',
    chargingNone: 'v2.statusDetail.value.chargingNone',
    wifi: 'v2.statusDetail.value.wifi',
    ethernet: 'v2.statusDetail.value.ethernet',
    cellular: 'v2.statusDetail.value.cellular',
    linkUnknown: 'v2.statusDetail.value.linkUnknown',
    decoding: 'v2.statusDetail.value.decoding',
    decoderStall: 'v2.statusDetail.value.decoderStall',
    transportStall: 'v2.statusDetail.value.transportStall',
    frozenUnknown: 'v2.statusDetail.value.frozenUnknown',
    noWindow: 'v2.statusDetail.value.noWindow',
    native: 'v2.statusDetail.value.native',
    derived: 'v2.statusDetail.value.derived',
    copyLeg: 'v2.statusDetail.value.copyLeg',
    transcodeLeg: 'v2.statusDetail.value.transcodeLeg',
    ladderNeverMoved: 'v2.statusDetail.value.ladderNeverMoved',
    ladderHeld: 'v2.statusDetail.value.ladderHeld',
    ladderHeldStallBuilding: 'v2.statusDetail.value.ladderHeldStallBuilding',
    ladderHeldDelivery: 'v2.statusDetail.value.ladderHeldDelivery',
    ladderHeldNoEvidence: 'v2.statusDetail.value.ladderHeldNoEvidence',
    ladderHeldWarming: 'v2.statusDetail.value.ladderHeldWarming',
    ladderHeldCooldown: 'v2.statusDetail.value.ladderHeldCooldown',
    ladderHeldCapacity: 'v2.statusDetail.value.ladderHeldCapacity',
    ladderHeldTryUnclean: 'v2.statusDetail.value.ladderHeldTryUnclean',
    ladderHeldTryBackoff: 'v2.statusDetail.value.ladderHeldTryBackoff',
    ladderHeldTrial: 'v2.statusDetail.value.ladderHeldTrial',
    ladderHeldSuspended: 'v2.statusDetail.value.ladderHeldSuspended',
    serverNotWired: 'v2.statusDetail.value.serverNotWired',
    serverWaiting: 'v2.statusDetail.value.serverWaiting',
    sessionGone: 'v2.statusDetail.value.sessionGone',
    noSample: 'v2.statusDetail.value.noSample',
  },
} as const

/** A value the device actually reported, already formatted. */
export interface StatusDetailTextLine {
  readonly labelKey: string
  readonly kind: 'text'
  readonly text: string
}

/** A worded value — including every "we do not know". */
export interface StatusDetailKeyLine {
  readonly labelKey: string
  readonly kind: 'key'
  readonly valueKey: string
}

export type StatusDetailLine = StatusDetailTextLine | StatusDetailKeyLine

const textLine = (labelKey: string, text: string): StatusDetailTextLine => ({ labelKey, kind: 'text', text })
const keyLine = (labelKey: string, valueKey: string): StatusDetailKeyLine => ({ labelKey, kind: 'key', valueKey })

const CHARGING_VALUE: Readonly<Record<BatteryStatus['charging'], string>> = {
  dc: STATUS_DETAIL_KEY.value.chargingDc,
  solar: STATUS_DETAIL_KEY.value.chargingSolar,
  none: STATUS_DETAIL_KEY.value.chargingNone,
  unknown: STATUS_DETAIL_KEY.value.unknown,
}

const LINK_VALUE: Readonly<Record<NetworkLinkStatus['type'], string>> = {
  wifi: STATUS_DETAIL_KEY.value.wifi,
  ethernet: STATUS_DETAIL_KEY.value.ethernet,
  cellular: STATUS_DETAIL_KEY.value.cellular,
  unknown: STATUS_DETAIL_KEY.value.linkUnknown,
}

/** `87%`, or `null` when the reading is not a number we can show. */
function percent(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return `${String(Math.round(value))}%`
}

export function batteryDetailLines(battery: BatteryStatus): readonly StatusDetailLine[] {
  const charge = battery.binary === true ? null : percent(battery.percentage)
  const lines: StatusDetailLine[] = [
    battery.binary === true
      ? keyLine(STATUS_DETAIL_KEY.label.charge, STATUS_DETAIL_KEY.value.binary)
      : charge === null
        ? keyLine(STATUS_DETAIL_KEY.label.charge, STATUS_DETAIL_KEY.value.unknown)
        : textLine(STATUS_DETAIL_KEY.label.charge, charge),
    keyLine(STATUS_DETAIL_KEY.label.charging, CHARGING_VALUE[battery.charging]),
  ]
  // Only what IS: a camera that is awake says nothing here.
  if (battery.sleeping) lines.push(keyLine(STATUS_DETAIL_KEY.label.state, STATUS_DETAIL_KEY.value.sleeping))
  return lines
}

export function networkLinkDetailLines(link: NetworkLinkStatus): readonly StatusDetailLine[] {
  const signal = percent(link.signalPercent)
  const lines: StatusDetailLine[] = [
    keyLine(STATUS_DETAIL_KEY.label.linkType, LINK_VALUE[link.type]),
    // A wire is not a weak link: it has no signal to report, ever.
    link.type === 'ethernet'
      ? keyLine(STATUS_DETAIL_KEY.label.signal, STATUS_DETAIL_KEY.value.notApplicable)
      : signal === null
        ? keyLine(STATUS_DETAIL_KEY.label.signal, STATUS_DETAIL_KEY.value.unknown)
        : textLine(STATUS_DETAIL_KEY.label.signal, signal),
  ]
  if (link.ssid !== undefined && link.ssid !== '') lines.push(textLine(STATUS_DETAIL_KEY.label.ssid, link.ssid))
  return lines
}

/**
 * The stream lines — the same two halves the in-picture overlay draws, in the
 * card an operator can actually open on a phone.
 *
 * The overlay lives in the WebView, and in the native app the RN gesture layer
 * owns the touches over it, so its panel can never be expanded there. The
 * numbers therefore travel out of the player (`StreamDebugSample`) and are
 * rendered here, beside the battery and link details, where they are reachable.
 *
 * Same discipline as the rest of this file, and it matters more here than
 * anywhere: **a measurement that did not happen is not a zero.** "0 frames
 * decoded" and "nobody has measured frames yet" are the two answers this panel
 * exists to tell apart — one is a stalled decoder, the other is a panel opened
 * before the stream connected.
 *
 * The first line is the verdict, because it is the whole question: bytes
 * arriving with no frames coming out is the DECODER; nothing arriving at all is
 * the TRANSPORT. Everything below it is the evidence for that sentence.
 */
export function streamDetailLines(sample: StreamDebugSample | null): readonly StatusDetailLine[] {
  if (sample === null) {
    return [keyLine(STATUS_DETAIL_KEY.label.verdict, STATUS_DETAIL_KEY.value.noSample)]
  }
  const stats = sample.stats
  const win = stats?.window ?? null
  const lines: StatusDetailLine[] = [
    keyLine(STATUS_DETAIL_KEY.label.verdict, VERDICT_VALUE[sample.verdict]),
  ]

  const picture =
    stats?.width !== null && stats?.width !== undefined && stats.height !== null
      ? `${String(stats.width)}×${String(stats.height)}${stats.fps === null ? '' : ` · ${String(Math.round(stats.fps))}fps`}`
      : null
  lines.push(
    picture === null
      ? keyLine(STATUS_DETAIL_KEY.label.picture, STATUS_DETAIL_KEY.value.unknown)
      : textLine(STATUS_DETAIL_KEY.label.picture, picture),
  )
  lines.push(numberLine(STATUS_DETAIL_KEY.label.bitrate, win?.kbps ?? null, ' kbps'))

  // The three the freeze question turns on, each with what it did in the last
  // window — a counter that is not advancing is the finding.
  lines.push(
    counterLine(STATUS_DETAIL_KEY.label.decoded, stats?.framesDecoded ?? null, win?.framesDecoded ?? null),
  )
  const freezes =
    stats?.freezeCount === null || stats?.freezeCount === undefined
      ? null
      : `${String(stats.freezeCount)}${stats.totalFreezeMs === null ? '' : ` · ${formatMs(stats.totalFreezeMs)}`}`
  lines.push(
    freezes === null
      ? keyLine(STATUS_DETAIL_KEY.label.freezes, STATUS_DETAIL_KEY.value.unknown)
      : textLine(STATUS_DETAIL_KEY.label.freezes, freezes),
  )
  lines.push(
    counterLine(STATUS_DETAIL_KEY.label.keyframeRequests, stats?.pliCount ?? null, win?.pliCount ?? null),
  )

  const loss =
    stats?.lossPercent === null || stats?.lossPercent === undefined
      ? null
      : `${stats.lossPercent.toFixed(2)}%${win?.lossPercent === null || win?.lossPercent === undefined ? '' : ` · ${win.lossPercent.toFixed(2)}%`}`
  lines.push(
    loss === null
      ? keyLine(STATUS_DETAIL_KEY.label.loss, STATUS_DETAIL_KEY.value.unknown)
      : textLine(STATUS_DETAIL_KEY.label.loss, loss),
  )
  const latency =
    stats?.rttMs === null || stats?.rttMs === undefined
      ? null
      : `${String(Math.round(stats.rttMs))}ms${stats.jitterMs === null ? '' : ` · ${stats.jitterMs.toFixed(1)}ms`}`
  lines.push(
    latency === null
      ? keyLine(STATUS_DETAIL_KEY.label.latency, STATUS_DETAIL_KEY.value.unknown)
      : textLine(STATUS_DETAIL_KEY.label.latency, latency),
  )
  const path =
    stats?.candidatePairType === null || stats?.candidatePairType === undefined
      ? null
      : `${stats.candidatePairType}${stats.candidateProtocol === null ? '' : `/${stats.candidateProtocol}`}`
  lines.push(
    path === null
      ? keyLine(STATUS_DETAIL_KEY.label.path, STATUS_DETAIL_KEY.value.unknown)
      : textLine(STATUS_DETAIL_KEY.label.path, path),
  )

  return [...lines, ...serverLines(sample)]
}

/** What the SERVER says it is serving — absent, waiting, gone or answered. */
function serverLines(sample: StreamDebugSample): readonly StatusDetailLine[] {
  if (!sample.serverWired) {
    return [keyLine(STATUS_DETAIL_KEY.label.servedRung, STATUS_DETAIL_KEY.value.serverNotWired)]
  }
  const server = sample.server
  if (server === null) {
    return [
      sample.serverError === null
        ? keyLine(STATUS_DETAIL_KEY.label.servedRung, STATUS_DETAIL_KEY.value.serverWaiting)
        : textLine(STATUS_DETAIL_KEY.label.servedRung, sample.serverError),
    ]
  }
  if (!server.alive) {
    return [keyLine(STATUS_DETAIL_KEY.label.servedRung, STATUS_DETAIL_KEY.value.sessionGone)]
  }
  const lines: StatusDetailLine[] = [
    server.servedTier === null
      ? keyLine(STATUS_DETAIL_KEY.label.servedRung, STATUS_DETAIL_KEY.value.unknown)
      : textLine(
          STATUS_DETAIL_KEY.label.servedRung,
          `${server.servedTier}${server.adaptive === true ? ' · auto' : ''}`,
        ),
  ]
  // Which stream, and whether this server had to MANUFACTURE it — the
  // difference between a camera rung and a transcode nobody asked for.
  lines.push(
    server.camStreamId === null
      ? keyLine(STATUS_DETAIL_KEY.label.source, STATUS_DETAIL_KEY.value.unknown)
      : textLine(STATUS_DETAIL_KEY.label.source, server.camStreamId),
  )
  if (server.sourceKind !== 'unknown') {
    lines.push(
      keyLine(
        STATUS_DETAIL_KEY.label.source,
        server.sourceKind === 'derived'
          ? STATUS_DETAIL_KEY.value.derived
          : STATUS_DETAIL_KEY.value.native,
      ),
    )
  }
  lines.push(
    server.ingestNodeId === null
      ? keyLine(STATUS_DETAIL_KEY.label.ingest, STATUS_DETAIL_KEY.value.unknown)
      : textLine(STATUS_DETAIL_KEY.label.ingest, server.ingestNodeId),
  )
  if (server.egressLeg !== 'unknown') {
    lines.push(
      keyLine(
        STATUS_DETAIL_KEY.label.egress,
        server.egressLeg === 'transcode'
          ? STATUS_DETAIL_KEY.value.transcodeLeg
          : STATUS_DETAIL_KEY.value.copyLeg,
      ),
    )
  }
  // The last move, if any; otherwise WHY it is not moving — "never moved" only
  // when the hub gave no reason (an older hub). A held ladder and an absent
  // one used to read the same (D635).
  const hold = server.climbHold
  lines.push(
    server.lastDecision !== null
      ? textLine(
          STATUS_DETAIL_KEY.label.ladder,
          `${server.lastDecision.causeDetail ?? server.lastDecision.cause}${server.lastDecision.tier === null ? '' : ` → ${server.lastDecision.tier}`}`,
        )
      : keyLine(
          STATUS_DETAIL_KEY.label.ladder,
          hold === null ? STATUS_DETAIL_KEY.value.ladderNeverMoved : HOLD_VALUE[hold.code],
        ),
  )
  // The hub's own numbers, verbatim: they are the evidence, not a sentence.
  if (hold !== null && hold.summary !== null) {
    lines.push(textLine(STATUS_DETAIL_KEY.label.ladderWhy, hold.summary))
  }
  return lines
}

const HOLD_VALUE: Readonly<Record<ClimbHoldCode, string>> = {
  'stall-building': STATUS_DETAIL_KEY.value.ladderHeldStallBuilding,
  delivery: STATUS_DETAIL_KEY.value.ladderHeldDelivery,
  'no-evidence': STATUS_DETAIL_KEY.value.ladderHeldNoEvidence,
  warming: STATUS_DETAIL_KEY.value.ladderHeldWarming,
  cooldown: STATUS_DETAIL_KEY.value.ladderHeldCooldown,
  capacity: STATUS_DETAIL_KEY.value.ladderHeldCapacity,
  'try-unclean': STATUS_DETAIL_KEY.value.ladderHeldTryUnclean,
  'try-backoff': STATUS_DETAIL_KEY.value.ladderHeldTryBackoff,
  trial: STATUS_DETAIL_KEY.value.ladderHeldTrial,
  suspended: STATUS_DETAIL_KEY.value.ladderHeldSuspended,
  unknown: STATUS_DETAIL_KEY.value.ladderHeld,
}

const VERDICT_VALUE: Readonly<Record<StreamFreezeVerdict, string>> = {
  decoding: STATUS_DETAIL_KEY.value.decoding,
  'decoder-stall': STATUS_DETAIL_KEY.value.decoderStall,
  'transport-stall': STATUS_DETAIL_KEY.value.transportStall,
  'frozen-unknown': STATUS_DETAIL_KEY.value.frozenUnknown,
  unknown: STATUS_DETAIL_KEY.value.noWindow,
}

/** `12345 +30`, or the honest unknown. The window is what says it is ALIVE. */
function counterLine(labelKey: string, total: number | null, window: number | null): StatusDetailLine {
  if (total === null) return keyLine(labelKey, STATUS_DETAIL_KEY.value.unknown)
  return textLine(labelKey, `${String(total)}${window === null ? '' : ` +${String(window)}`}`)
}

function numberLine(labelKey: string, value: number | null, suffix: string): StatusDetailLine {
  if (value === null || !Number.isFinite(value)) return keyLine(labelKey, STATUS_DETAIL_KEY.value.unknown)
  return textLine(labelKey, `${String(Math.round(value))}${suffix}`)
}

/** `1.2s` / `340ms` — a duration an operator reads, not a raw field. */
function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${String(Math.round(ms))}ms`
}
