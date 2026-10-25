/**
 * clip-playback-options — what the HUB says a camera's clips can be driven to
 * do, and how a viewer tells "it has not answered" from "it has nothing".
 *
 * ## One authority, and it is not per clip
 *
 * `videoclips.getPlaybackOptions({ deviceId, provider })` answers ONE
 * {@link ClipPlaybackOptions} envelope: the rate ladder, how far a position may
 * be moved, whether a backward frame-step means anything, whether scrub is
 * served. A provider RETURNS one of the hub's three envelopes (`file`,
 * `stream`, `realtimeStream`) and never composes one, so there is nothing here
 * to merge and nothing to reconcile.
 *
 * The per-clip `clipTransport` server message that used to carry half of this
 * answer is GONE — from the hub, and from this app. The broker's transport
 * choice reads nothing that varies per clip, so the clip level never had
 * information the provider does not already have, and two channels that can
 * disagree are worse than one (D612, D62). A parser for a message nobody sends
 * reads as verification that the message exists, which is why none survives.
 *
 * ## The four things a read can be, and why `absent` is a FREEDOM
 *
 * Deliberately the vocabulary of the admin UI's `useCapabilityPresence`
 * (D315): `pending | present | absent | unknown`, never a boolean and never a
 * nullish fallback, because *not-yet-known must never look like
 * not-installed*. Each is a value a caller has to render, not a default it
 * falls into.
 *
 * What differs here is what the non-`present` arms MEAN. `getPlaybackOptions`
 * is an `optionalMethod`: a hub older than this app does not expose it, and
 * `capQuery` answers `null` for a procedure that is not there. That is
 * `absent`, and the honest reading of it is the freedom this app ALWAYS had —
 * free seek, backward step, scrub, the broker's own ladder. Not the safest
 * answer; the COMPATIBLE one. A viewer newer than its hub must not start
 * refusing gestures that worked yesterday. `unknown` (the read failed) and
 * `pending` (no answer yet) resolve the same way, and for the same reason: a
 * restriction is something the hub SAYS, never something this app infers from
 * silence.
 *
 * Pure: no React, no i18n, no network.
 */

import { CLIP_BROKER_PACED_RATES } from '@camstack/types/client'
import type { ClipPlaybackOptions } from '@camstack/types'

import { isRecord } from '../data/cap-query.js'

/**
 * What is known about one camera+provider's playback options.
 *
 * - `pending` — nothing has answered. Render what always worked, and claim
 *               nothing about what this camera cannot do.
 * - `present` — the hub answered with a readable envelope. This is the ONLY
 *               arm that licenses disabling a control.
 * - `absent`  — the hub answered that it has no such method / no provider for
 *               this camera. The old freedom, deliberately.
 * - `unknown` — the read FAILED. Not an answer, so not `absent` either.
 */
export type ClipPlaybackPresence = 'pending' | 'present' | 'absent' | 'unknown'

/**
 * The rates the BROKER can pace, as the hub spells them
 * (`CLIP_BROKER_PACED_RATES` — `[0.25, 0.5, 1, 1.5, 2, 4]`).
 *
 * Imported, never re-typed. This app used to own a `PLAYBACK_RATE_OPTIONS`
 * copy of the same six numbers, which is the second authority D62 forbids: the
 * day the hub's ladder moves, a local copy offers a rate nothing can deliver.
 * It is the widest ladder any envelope carries, so it is also the set a menu
 * DRAWS — see {@link clipRateChoices} in `clip-controls.ts`.
 */
export const CLIP_LEGACY_RATE_LADDER: readonly number[] = CLIP_BROKER_PACED_RATES

/**
 * Normalise a wire rate ladder.
 *
 * The contract is ascending, `1` a member, `0` not one. This does not TRUST
 * it: the numbers are sorted and de-duplicated (order is a fact about the set,
 * not about the sender), and anything that is not a finite rate above zero is
 * dropped — `0` is pause, which is a separate control and never a menu row.
 *
 * Returns null when what is left cannot be played at: an empty ladder, or one
 * with no `1` in it. A camera that cannot be played at normal speed is not a
 * restriction this app can draw, and half-reading an envelope would hand the
 * operator a menu the hub never promised.
 */
export function normaliseClipRates(raw: unknown): readonly number[] | null {
  if (!Array.isArray(raw)) return null
  const kept = new Set<number>()
  for (const entry of raw) {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry <= 0) continue
    kept.add(entry)
  }
  if (!kept.has(1)) return null
  return [...kept].sort((a, b) => a - b)
}

/**
 * Narrow a `getPlaybackOptions` payload.
 *
 * Structural, and whole-or-nothing. Every field is required on the wire, so a
 * payload missing one is not a partial declaration to be topped up with
 * defaults — it is a payload this build cannot read, and the caller renders it
 * as `unknown`, which is the old freedom rather than an invented restriction.
 *
 * `transport` is carried but never branched on by this app: the VERBS are the
 * answer, and a viewer that re-derived them from the transport name would be
 * the second authority the envelope exists to remove.
 */
export function parseClipPlaybackOptions(raw: unknown): ClipPlaybackOptions | null {
  if (!isRecord(raw)) return null
  const { transport, seek, stepBack, scrub, rates } = raw
  if (transport !== 'stream' && transport !== 'file') return null
  if (seek !== 'forward' && seek !== 'free') return null
  if (typeof stepBack !== 'boolean' || typeof scrub !== 'boolean') return null
  const ladder = normaliseClipRates(rates)
  if (ladder === null) return null
  return { transport, seek, stepBack, scrub, rates: ladder }
}
