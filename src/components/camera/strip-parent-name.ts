/**
 * Separators a provider may use between a container's name and its child's
 * label. Order matters and is the whole point of this file: `" — "` MUST be
 * tried before the plain space, or an Ecowitt child
 * (`"Ecowitt Gateway — gateway"`) yields `"— gateway"` — a dangling em-dash the
 * operator sees in the linked-devices row.
 *
 * Mirrors `CHILD_NAME_SEPARATORS` in
 * `packages/ui-library/src/composites/device-item/helpers.ts`, which the admin
 * UI uses. The viewer cannot import that module (it is a web/React package and
 * this is React Native), so the list is duplicated deliberately — see the
 * docblock on {@link stripParentName} for the one behavioural difference.
 */
export const CHILD_NAME_SEPARATORS: readonly string[] = [' — ', ' ']

/**
 * Strip a redundant parent-camera prefix from a child device's name, so a row
 * reads `"Siren"` instead of `"Camera camera Carol Siren"`.
 *
 * Providers name container children fully-qualified so the entity reads
 * cleanly on its own detail page, in exports and on the parent badge. Under the
 * parent that prefix is noise. The underlying `device.name` is never mutated —
 * this is a display concern only.
 *
 * ONE deliberate difference from the admin UI's `stripParentNamePrefix`: the
 * prefix match here is case-INsensitive, because the viewer has hit children
 * whose provider capitalised the parent differently. Everything a case-sensitive
 * match would strip, this strips too.
 *
 * SEVERAL candidate parent names may be passed, and the first that matches
 * wins. This is not a convenience: the viewer shows a camera under the
 * operator's LOCAL rename (`pref.localName`), while the accessory's own name
 * comes from the server and was built from the SERVER-side camera name. Pass
 * only the renamed one and "Camera front door Siren" under a camera renamed
 * "Front door" matches nothing, so the prefix survives — which is exactly the row
 * the operator reported.
 *
 * A missing parent name, a name that does not carry the prefix, or a prefix
 * that would leave nothing behind, all return the name verbatim — an empty row
 * label is worse than a redundant one.
 */
export function stripParentName(
  childName: string,
  ...parentNames: readonly (string | undefined)[]
): string {
  const lowerChild = childName.toLowerCase()
  for (const parentName of parentNames) {
    if (parentName === undefined || parentName.length === 0) continue
    const lowerParent = parentName.toLowerCase()
    if (!lowerChild.startsWith(lowerParent)) continue
    for (const separator of CHILD_NAME_SEPARATORS) {
      if (lowerChild.startsWith(`${lowerParent}${separator}`)) {
        const rest = childName.slice(parentName.length + separator.length).trim()
        if (rest.length > 0) return rest
      }
    }
  }
  return childName
}
