/**
 * Container → primary-child resolution for the viewer's linked-devices panel.
 *
 * A CONTAINER device (e.g. a Gree air-conditioner grouping a climate child plus
 * light / x-fan / health switch children) has NO controllable surface of its
 * own — its `DeviceType` maps to `none` in the control registry, so a container
 * row would render with no action. Admin-ui renders a container AS its primary
 * child (`ContainerHero` → `ContainerPrimaryHero`); this mirrors that: the panel
 * resolves the container's highest-priority child by type and renders THAT
 * child's inline control.
 *
 * This is the DEFAULT (priority) resolution only — the viewer is a pure consumer
 * and does not persist the operator's primary-child override (that lives in
 * admin-ui). The priority order MIRRORS admin-ui's ui-library `primary-child.ts`
 * PRIORITY so both surfaces render the same child as a container's primary.
 */

/** Type priority, most→least "primary". An actuator (climate / lock / cover / …)
 *  outranks a bare `switch` so a container's defining child wins over its
 *  auxiliary switches. Unknown / absent types sort after every entry. Kept in
 *  sync with the server ui-library `PRIORITY` (device-controls/primary-child.ts). */
export const CONTAINER_CHILD_PRIORITY: readonly string[] = [
  'media-player',
  'alarm-panel',
  'thermostat',
  'climate',
  'humidifier',
  'water-heater',
  'lock',
  'cover',
  'valve',
  'fan',
  'vacuum',
  'lawn-mower',
  'washer',
  'dryer',
  'dishwasher',
  'light',
  'switch',
  'siren',
  'button',
  'control',
  'notifier',
  'script',
  'automation',
  'update',
  'presence',
  'weather',
  'image',
  'sensor',
]

/** The minimal child shape the resolver needs. */
export interface ContainerChildRef {
  readonly type: string
}

function rank(type: string): number {
  const i = CONTAINER_CHILD_PRIORITY.indexOf(type)
  return i === -1 ? CONTAINER_CHILD_PRIORITY.length : i
}

/**
 * Pick the container's primary child by type priority. Returns the highest-
 * priority child, or `null` for an empty child set. Pure + stable: children are
 * ranked by {@link CONTAINER_CHILD_PRIORITY}; ties keep input order (a stable
 * sort), so a deterministic child wins.
 */
export function resolvePrimaryChildByType<T extends ContainerChildRef>(
  children: readonly T[],
): T | null {
  if (children.length === 0) return null
  return [...children].sort((a, b) => rank(a.type) - rank(b.type))[0] ?? null
}
