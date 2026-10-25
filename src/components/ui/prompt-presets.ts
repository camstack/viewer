/**
 * Preset phrases for a prompt's text — the checkbox half of `usePrompt`.
 *
 * A debug note is a QUESTION the operator leaves on a track ("what should be
 * checked here"), and the same handful of questions came back over and over:
 * no crop, started late, never detected at all. Typing them again each time is
 * how a note ends up as "??" — and a set of marks with no question attached is
 * the state `TrackFlagButtons` was built to avoid in the first place.
 *
 * ## The note stays ONE string
 *
 * A preset is a canned phrase INSERTED into the note, not a parallel structure:
 * nothing new travels on the wire, `debugNote` keeps its exact meaning, and a
 * note typed by hand is indistinguishable from one assembled by ticking. The
 * alternative — a list of reason ids beside the text — would have needed a
 * schema change, a migration, and a second place where the truth about a mark
 * lives.
 *
 * ## Ticking is derived, never stored
 *
 * A box is ticked when the note CONTAINS its phrase, so reopening a note for
 * editing re-ticks correctly with no state to keep in sync. Matching is on
 * whole segments, never a substring: "No subject cropping issues" must not tick
 * "No subject crop", because unticking it would then cut a hole in a sentence
 * the operator wrote themselves.
 */

/** What joins the segments of a composed note. Visible, and easy to split on. */
const SEPARATOR = ' · '

function segmentsOf(note: string): readonly string[] {
  return note
    .split(SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** Is `phrase` one of the note's segments? */
export function presetSelected(note: string, phrase: string): boolean {
  return segmentsOf(note).includes(phrase)
}

/**
 * Add or remove one preset phrase.
 *
 * Adding appends — the operator's own words keep the position they were typed
 * in, and a preset never rewrites them. Removing drops that segment only.
 * Both directions are idempotent: ticking twice is one phrase, unticking
 * something absent is the note unchanged.
 */
export function togglePreset(note: string, phrase: string, on: boolean): string {
  const segments = segmentsOf(note)
  if (on) {
    if (segments.includes(phrase)) return note
    return [...segments, phrase].join(SEPARATOR)
  }
  return segments.filter((segment) => segment !== phrase).join(SEPARATOR)
}
