/**
 * The words that name a capability, in ONE place — the viewer's twin of the
 * admin's `capability-label.ts` (`@camstack/ui-library`).
 *
 * A cap definition carries no label, so every surface that names a capability
 * ("No device provides Temperature") asks here: the locale key
 * `v2.capability.<name>` when the app has one, else the name made readable
 * (`temperature-sensor` → "Temperature sensor"). No per-capability message
 * exists anywhere: a new cap needs no UI work to be named.
 */

/** The slice of i18next's `t` this file needs. */
export type CapabilityLabelT = (key: string, options: { readonly defaultValue: string }) => string

/** `temperature-sensor`, `temperature_sensor`, `temperatureSensor` → "Temperature sensor". */
export function humanizeIdentifier(capName: string): string {
  const words = capName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.:]+/g, ' ')
    .trim()
    .toLowerCase()
  if (words === '') return capName
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The label for a capability: the locale's word when it has one, else the humanized name. */
export function capabilityLabel(capName: string, t?: CapabilityLabelT): string {
  const fallback = humanizeIdentifier(capName)
  return t === undefined ? fallback : t(`v2.capability.${capName}`, { defaultValue: fallback })
}

/** "A", "A or B", "A, B or C" — the capabilities a field asks for, in one phrase. */
export function capabilityListLabel(
  capNames: readonly string[],
  t?: CapabilityLabelT,
  or: string = 'or',
): string {
  const labels = capNames.map((c) => capabilityLabel(c, t))
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} ${or} ${labels[labels.length - 1]}`
}
