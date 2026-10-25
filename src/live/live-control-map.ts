export type PlaybackCommand =
  | { kind: 'playRecorded'; deviceId: number; epochMs: number; profile: string }
  /**
   * Move the pointer into a stored CLIP (D575). A clip is another position of
   * the recorded source pointer, so it rides this bridge beside the seek and
   * the scrub and needs no surface of its own — everything after it travels on
   * the clip's file-relative axis unchanged.
   *
   * `offsetMs` from the clip's first sample, always stated. `profile` only
   * when one was picked: a stored file has no session to resolve an adaptive
   * tier against, so absent means the provider's own default.
   */
  | {
      kind: 'playClip'
      deviceId: number
      clipId: string
      /** The `addonId` that holds the file — see the embed's own note. */
      provider: string
      offsetMs: number
      profile?: string
    }
  | { kind: 'seek'; epochMs: number }
  // `dragId` names the scrub gesture (`scrub-drag-id.ts`) — optional, carried
  // through to its commit so the hub and the app's own logs join without
  // depending on either clock.
  | { kind: 'scrubStart'; dragId?: string }
  | { kind: 'scrubTo'; epochMs: number; m?: 'fine' | 'coarse'; v?: number }
  | { kind: 'scrubEnd'; epochMs: number }
  | { kind: 'timelineWarm'; epochMs: number }
  | { kind: 'scrubCommit'; epochMs: number; dragId?: string }
  | { kind: 'setRate'; rate: number }
  | { kind: 'stepFrame'; dir: 1 | -1 }
  | { kind: 'goLive' }
  | { kind: 'startLiveCapture' }
  | { kind: 'stopLiveCapture' }
  /** Cut the frame on screen; the page answers with a `snapshot` message that
   *  carries the same `id`. */
  | { kind: 'snapshot'; id: string }
  /**
   * Swap the camera on the ALREADY-BOOTED page, optionally at an instant (D483).
   *
   * The page half has been implemented and spec'd since before this command
   * (`embed/src/embed/set-device-command.ts`); the host simply had no way to
   * ask, so every camera change paid a full page boot — a second WebSocket +
   * auth handshake, a config handshake, a TURN fetch.
   *
   * `atMs` ABSENT ⇒ the new camera opens LIVE. Present, it rides the swap
   * rather than being seeked afterwards, so the swap is flash-free: a
   * swap-then-seek is the "host round-trip, live-first flash" that
   * config-carried seeking exists to remove.
   *
   * NOTE the different global: this is the only command that goes to
   * `__camstackEmbedPage` rather than `__camstackEmbed`. The page's own
   * docblock says why — `__camstackEmbed` is torn down and rebuilt on every
   * camera swap, so the swap itself cannot live on it.
   */
  | {
      kind: 'setDevice'
      deviceId: number
      atMs?: number
      muted?: boolean
      stats?: boolean
      /**
       * WebRTC target for the swapped-to camera. ABSENT ⇒ the page keeps the
       * target it booted with — which is wrong for a quality the operator
       * already picked (the chip shows High while the remount dials
       * `adaptive`). Pass the host's current live target on every swap.
       */
      target?: SetDeviceTarget
    }

/** The embed's adaptive/profile target — mirrors `embedTargetSchema`. */
export type SetDeviceTarget =
  | { readonly kind: 'adaptive' }
  | { readonly kind: 'profile'; readonly profile: string }

/** The payload shape `setDevice` carries — mirrors the embed's
 *  `setDeviceCommandSchema`, which validates it on arrival. Built here so the
 *  two encoders below cannot disagree about it. */
export type SetDeviceValue = {
  readonly deviceId: number
  readonly atMs?: number
  readonly muted?: boolean
  readonly stats?: boolean
  readonly target?: SetDeviceTarget
}

export function setDeviceValue(
  cmd: Extract<PlaybackCommand, { kind: 'setDevice' }>,
): SetDeviceValue {
  // Omitted, never sent as `undefined`: the schema reads ABSENT as "keep what
  // the page booted with" (or, for the instant, "open live"), and an explicit
  // undefined would serialise to `null` on the web path and fail validation.
  return {
    deviceId: cmd.deviceId,
    ...(cmd.atMs !== undefined ? { atMs: Math.round(cmd.atMs) } : {}),
    ...(cmd.muted !== undefined ? { muted: cmd.muted } : {}),
    ...(cmd.stats !== undefined ? { stats: cmd.stats } : {}),
    ...(cmd.target !== undefined ? { target: cmd.target } : {}),
  }
}

/** Build the JS to inject into the player WebView. Trailing `true;` satisfies the RN WebView injection contract. */
export function playbackCommandToScript(cmd: PlaybackCommand): string {
  const call = ((): string => {
    switch (cmd.kind) {
      case 'playRecorded': return `window.__camstackEmbed.playRecorded(${cmd.deviceId},${cmd.epochMs},${JSON.stringify(cmd.profile)})`
      case 'playClip':
        // The id is JSON-quoted, not interpolated bare: a real one is
        // `native:reolink:onboard:0:<base64>` — colons, `+`, `=` — and
        // unquoted it is a syntax error that kills the tap in silence.
        return cmd.profile !== undefined
          ? `window.__camstackEmbed.playClip(${cmd.deviceId},${JSON.stringify(cmd.clipId)},${JSON.stringify(cmd.provider)},${Math.max(0, Math.round(cmd.offsetMs))},${JSON.stringify(cmd.profile)})`
          : `window.__camstackEmbed.playClip(${cmd.deviceId},${JSON.stringify(cmd.clipId)},${JSON.stringify(cmd.provider)},${Math.max(0, Math.round(cmd.offsetMs))})`
      case 'seek': return `window.__camstackEmbed.seek(${cmd.epochMs})`
      case 'scrubStart':
        return cmd.dragId !== undefined
          ? `window.__camstackEmbed.scrubStart(${JSON.stringify(cmd.dragId)})`
          : `window.__camstackEmbed.scrubStart()`
      case 'scrubTo':
        // The mapping hint rides as two positional scalars — both or neither
        // (the embed and the hub each drop half-hints whole).
        return cmd.m !== undefined && cmd.v !== undefined
          ? `window.__camstackEmbed.scrubTo(${cmd.epochMs},${JSON.stringify(cmd.m)},${Math.round(cmd.v)})`
          : `window.__camstackEmbed.scrubTo(${cmd.epochMs})`
      case 'scrubEnd': return `window.__camstackEmbed.scrubEnd(${cmd.epochMs})`
      case 'timelineWarm': return `window.__camstackEmbed.timelineWarm(${cmd.epochMs})`
      case 'scrubCommit':
        return cmd.dragId !== undefined
          ? `window.__camstackEmbed.scrubCommit(${cmd.epochMs},${JSON.stringify(cmd.dragId)})`
          : `window.__camstackEmbed.scrubCommit(${cmd.epochMs})`
      case 'setRate': return `window.__camstackEmbed.setRate(${cmd.rate})`
      case 'stepFrame': return `window.__camstackEmbed.stepFrame(${cmd.dir})`
      case 'goLive': return `window.__camstackEmbed.goLive()`
      case 'startLiveCapture': return `window.__camstackEmbed.startLiveCapture()`
      case 'stopLiveCapture': return `window.__camstackEmbed.stopLiveCapture()`
      case 'snapshot': return `window.__camstackEmbed.snapshot(${JSON.stringify(cmd.id)})`
      // `__camstackEmbedPage`, not `__camstackEmbed` — see the command's docblock.
      // JSON.stringify: the payload may carry a nested `target`, and a hand-
      // built `{key:value}` literal cannot quote nested keys safely.
      case 'setDevice':
        return `window.__camstackEmbedPage.setDevice(${JSON.stringify(setDeviceValue(cmd))})`
    }
  })()
  return `try{${call}}catch(e){}; true;`
}

/**
 * Web transport encoder — symmetric to `playbackCommandToScript` (iOS injectedJS).
 * Maps the SHARED `PlaybackCommand` vocabulary onto the `command` object the
 * embed's browser `onHostCommand` switch accepts (see `EmbedPlayerPage`): the
 * postMessage path reads `command.value` for seek/scrub/setRate (NOT the
 * injectedJS `epochMs`/`rate` positional form). Wrapped by `useEmbedIframe`'s
 * `postCommand` into the `{ type:'embed-command', command }` envelope.
 */
export type PlaybackCommandMessage =
  | { readonly kind: 'playRecorded'; readonly deviceId: number; readonly epochMs: number; readonly profile: string }
  | {
      readonly kind: 'playClip'
      readonly deviceId: number
      readonly clipId: string
      readonly offsetMs: number
      readonly profile?: string
    }
  | { readonly kind: 'seek'; readonly value: number }
  | { readonly kind: 'scrubStart'; readonly dragId?: string }
  | { readonly kind: 'scrubTo'; readonly value: number; readonly m?: 'fine' | 'coarse'; readonly v?: number }
  | { readonly kind: 'scrubEnd'; readonly value: number }
  | { readonly kind: 'timelineWarm'; readonly value: number }
  | { readonly kind: 'scrubCommit'; readonly value: number; readonly dragId?: string }
  | { readonly kind: 'setRate'; readonly value: number }
  | { readonly kind: 'stepFrame'; readonly dir: 1 | -1 }
  | { readonly kind: 'goLive' }
  | { readonly kind: 'startLiveCapture' }
  | { readonly kind: 'stopLiveCapture' }
  | { readonly kind: 'snapshot'; readonly id: string }
  | { readonly kind: 'setDevice'; readonly value: SetDeviceValue }

export function playbackCommandToMessage(cmd: PlaybackCommand): PlaybackCommandMessage {
  switch (cmd.kind) {
    case 'playRecorded': return { kind: 'playRecorded', deviceId: cmd.deviceId, epochMs: cmd.epochMs, profile: cmd.profile }
    case 'playClip': {
      const base = {
        kind: 'playClip',
        deviceId: cmd.deviceId,
        clipId: cmd.clipId,
        provider: cmd.provider,
        offsetMs: Math.max(0, Math.round(cmd.offsetMs)),
      } as const
      return cmd.profile !== undefined ? { ...base, profile: cmd.profile } : base
    }
    case 'seek': return { kind: 'seek', value: cmd.epochMs }
    case 'scrubStart':
      return cmd.dragId !== undefined ? { kind: 'scrubStart', dragId: cmd.dragId } : { kind: 'scrubStart' }
    case 'scrubTo':
      return cmd.m !== undefined && cmd.v !== undefined
        ? { kind: 'scrubTo', value: cmd.epochMs, m: cmd.m, v: Math.round(cmd.v) }
        : { kind: 'scrubTo', value: cmd.epochMs }
    case 'scrubEnd': return { kind: 'scrubEnd', value: cmd.epochMs }
    case 'timelineWarm': return { kind: 'timelineWarm', value: cmd.epochMs }
    case 'scrubCommit':
      return cmd.dragId !== undefined
        ? { kind: 'scrubCommit', value: cmd.epochMs, dragId: cmd.dragId }
        : { kind: 'scrubCommit', value: cmd.epochMs }
    case 'setRate': return { kind: 'setRate', value: cmd.rate }
    case 'stepFrame': return { kind: 'stepFrame', dir: cmd.dir }
    case 'goLive': return { kind: 'goLive' }
    case 'startLiveCapture': return { kind: 'startLiveCapture' }
    case 'stopLiveCapture': return { kind: 'stopLiveCapture' }
    case 'snapshot': return { kind: 'snapshot', id: cmd.id }
    case 'setDevice': return { kind: 'setDevice', value: setDeviceValue(cmd) }
  }
}
