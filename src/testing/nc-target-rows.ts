/**
 * The hub's answer to `integrationInstances.listInstances` (pinned to `notifiers`, `mine: true`)
 * for the targets a spec wants the signed-in user to own. Every row carries the owner key the
 * hub stamps; `owner` is the spec's session user id.
 */
export interface TargetRowSeed {
  readonly id: string
  readonly name: string
  readonly kind: string
  readonly addonId?: string
  readonly enabled: boolean
  readonly config: Readonly<Record<string, unknown>>
}

export function instanceRows(
  targets: readonly TargetRowSeed[],
  owner = 'u1',
): ReadonlyArray<{
  id: string
  name: string
  kind: string
  configured: boolean
  enabled: boolean
  formValues: Record<string, unknown>
}> {
  return targets.map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    configured: true,
    enabled: t.enabled,
    formValues: { ...t.config, ownerUserId: owner },
  }))
}
