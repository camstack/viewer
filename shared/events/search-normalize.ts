/**
 * search-normalize — one rule for turning a stored string and a typed query
 * into comparable text.
 *
 * The vocabularies a track carries are MACHINE tokens: the audio classifier
 * emits `glass_breaking`, the taxonomy emits `package-delivered`. Nobody types
 * either. Matching the raw token against the raw needle made those labels
 * reachable only by someone who already knew the separator, which is the same
 * as unreachable.
 *
 * So the comparison runs on a folded form — lower case, `_ - / .` folded to a
 * single space, whitespace collapsed — applied to BOTH sides. The raw
 * lower-cased token is kept alongside it, so an operator who pastes
 * `glass_breaking` verbatim still matches.
 *
 * Deliberately NOT folded: diacritics. Hermes' `String.normalize` is not
 * guaranteed on every runtime this code ships to, and the live zone names that
 * motivated this (`Uscio`, `Aiuola`, `Parking`) are plain ASCII, so
 * the fold would buy nothing and could throw.
 */

/** Characters that are separators in a machine token but not in typed text. */
const TOKEN_SEPARATORS = /[_\-/.]+/g

/** Lower case + machine separators folded to spaces + whitespace collapsed. */
export function foldSearchText(value: string): string {
  return value.toLowerCase().replace(TOKEN_SEPARATORS, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Both comparable forms of one stored value, empties dropped.
 *
 * Two entries rather than one because they answer different needles: the raw
 * form matches a pasted `glass_breaking`, the folded form matches a typed
 * `glass breaking`. Returning only the folded one would silently break the
 * first, which is what an operator copying a label out of a card does.
 */
export function searchVariants(value: string | undefined): readonly string[] {
  if (value === undefined) return []
  const raw = value.trim().toLowerCase()
  if (raw.length === 0) return []
  const folded = foldSearchText(value)
  return folded === raw || folded.length === 0 ? [raw] : [raw, folded]
}
