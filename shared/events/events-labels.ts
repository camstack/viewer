/**
 * events-labels — the words the events surface draws for itself, and where they
 * come from.
 *
 * ## The strings are injected, not built here
 *
 * This page has no i18n and is not getting one. The app around it already
 * resolved the operator's language and already owns `locales/{en,it}.json`; a
 * second set of strings in this artifact would be a set nobody diffs against
 * the first, and drift between two sets is the ordinary way one label stays in
 * English after everything else moved. So the host sends them in the config it
 * already injects at the handshake (`window.__CAMSTACK_EVENTS__`), the app side
 * builds them from its own keys (`src/events/events-labels.ts`), and the
 * keys live in `locales/` with every other string in the product.
 *
 * This is the SAME channel `kindLabels` already rides, for the other half of
 * the text a card carries: that dictionary translates the taxonomy a row names
 * (`car` → `Auto`), this one translates the words the card owns outright.
 * `strings` is the third — the empty/error/retry/end copy — and it is separate
 * because a host overrides those per surface, whereas these are the product's
 * wording and travel with the language alone.
 *
 * ## Which makes the English below the contract, not a leftover
 *
 * The two artifacts version-skew independently: on web the iframe is served by
 * the hub while the app ships on its own OTA chain, and an external integrator
 * embedding this page writes their own config and will send no labels at all.
 * Every one of those cases must draw the card that shipped — English, complete,
 * never a raw key and never an empty control. That is why the fallback is
 * per-label rather than all-or-nothing: a host that learns a new pill before the
 * page does, or a locale missing one string, costs exactly that one word.
 *
 * These are `title` / `aria-label` attributes on controls whose whole content
 * is a glyph (`✓`, `D`, `T`, `★`) or nothing at all (the active dot). They are
 * the only name those elements have — which is why a blank is refused below.
 */
import { z } from 'zod'

/** Every word this surface draws for itself. One key per control, named after
 *  what it labels. */
export interface EventsLabels {
  /** The "?" chip: an assignable face nobody has named yet. */
  readonly unassignedFace: string
  /** The ✓ pill — a debug track an operator has already analysed. */
  readonly reviewed: string
  /** The D pill — a track flagged for diagnostic attention. */
  readonly debug: string
  /** The T pill — a track kept for model TRAINING (not the vehicle). */
  readonly train: string
  /** The ✓T pill — a track whose retrain annotations are complete. */
  readonly trained: string
  /** The ★ pill — a track the operator kept past retention. */
  readonly favourite: string
  /** The green dot: this track is still moving right now. */
  readonly active: string
  /** The tail placeholder at the end of the feed — card-shaped, in the same
   *  grid flow as the cards, which is why it lives with them here. */
  readonly loadingMore: string
}

/**
 * The surface exactly as it reads today, and the value every unlabelled host
 * gets.
 *
 * Changing one of these strings changes what an OLD host shows, so it is a
 * decision about compatibility rather than a wording tweak — pinned by value in
 * `__tests__/events-labels.spec.ts` for that reason. The six pills are lower
 * case because that is how they were written; the tail loader is a sentence
 * because it is one.
 */
export const DEFAULT_EVENTS_LABELS: EventsLabels = {
  unassignedFace: 'unassigned face',
  reviewed: 'reviewed',
  debug: 'debug',
  train: 'train',
  trained: 'training complete',
  favourite: 'favourite',
  active: 'active',
  loadingMore: 'Loading more events',
}

export type EventsLabelKey = keyof EventsLabels

/** Derived from the defaults so a label cannot be added without a fallback:
 *  the two lists are one list. */
export const EVENTS_LABEL_KEYS = Object.keys(DEFAULT_EVENTS_LABELS) as readonly EventsLabelKey[]

/**
 * The labels as they travel. Every member optional and unknown members ignored:
 * a host that knows one more control than this build must not cost the surface
 * its whole config, and a host that knows one fewer must not be rejected either.
 *
 * Carried in the config with `.default({})` and in a patch with `.optional()`,
 * exactly like `kindLabels` next to it.
 */
export const eventsLabelsSchema = z.record(z.string(), z.string())

/** What the host may send, before it is merged over the defaults. */
export type EventsLabelsConfig = Readonly<Record<string, string>>

/**
 * Merge host words over the English, per label.
 *
 * A blank string is refused rather than honoured: an untranslated key that
 * resolves to `''` would leave a pill with no accessible name at all, which is
 * strictly worse than leaving it in English. Anything that is not a string is
 * refused for the same reason — this value crossed a trust boundary.
 */
export function resolveEventsLabels(input: unknown): EventsLabels {
  if (input === null || typeof input !== 'object') return DEFAULT_EVENTS_LABELS
  const given: Record<string, unknown> = input as Record<string, unknown>
  const out: Record<string, string> = { ...DEFAULT_EVENTS_LABELS }
  for (const key of EVENTS_LABEL_KEYS) {
    const value = given[key]
    if (typeof value !== 'string') continue
    if (value.trim() === '') continue
    out[key] = value
  }
  return {
    unassignedFace: out.unassignedFace ?? DEFAULT_EVENTS_LABELS.unassignedFace,
    reviewed: out.reviewed ?? DEFAULT_EVENTS_LABELS.reviewed,
    debug: out.debug ?? DEFAULT_EVENTS_LABELS.debug,
    train: out.train ?? DEFAULT_EVENTS_LABELS.train,
    trained: out.trained ?? DEFAULT_EVENTS_LABELS.trained,
    favourite: out.favourite ?? DEFAULT_EVENTS_LABELS.favourite,
    active: out.active ?? DEFAULT_EVENTS_LABELS.active,
    loadingMore: out.loadingMore ?? DEFAULT_EVENTS_LABELS.loadingMore,
  }
}
