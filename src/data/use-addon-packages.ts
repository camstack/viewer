/**
 * useAddonPackages — the installed addon packages, as the system family's
 * package picker lists them (D637): `addons.listPackages`, the same method the
 * admin UI's picker reads. The update-event packages it does not list
 * (`@camstack/server`, `@camstack/system`, `camstack-wrapper`) are added by
 * `packagePickerItems`, not here.
 *
 * Read only while `enabled`. An answer that does not parse THROWS — never an
 * empty list, which would call every stored package "not installed" (D315).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { z } from 'zod'
import type { NcInstalledPackageLike } from '@camstack/types'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'

const PACKAGE_LIST_STALE_MS = 60_000

/** Only what the picker reads; the rest of an installed package is ignored. */
const InstalledPackagesWireSchema = z.array(z.object({ name: z.string(), version: z.string() }))

export function addonPackagesKey(): readonly unknown[] {
  return ['v2', 'nc-pickers', 'package-list']
}

/** `{ name, version }` per package, or `null` when the answer is not a package list. */
export function parseInstalledPackages(raw: unknown): readonly NcInstalledPackageLike[] | null {
  const parsed = InstalledPackagesWireSchema.safeParse(raw)
  if (!parsed.success) return null
  return parsed.data.map((pkg) => ({ name: pkg.name, version: pkg.version }))
}

export function useAddonPackages(
  enabled: boolean,
): UseQueryResult<readonly NcInstalledPackageLike[]> {
  const { controller, state } = useConnection()
  return useQuery<readonly NcInstalledPackageLike[]>({
    queryKey: addonPackagesKey(),
    enabled: enabled && state === 'connected',
    staleTime: PACKAGE_LIST_STALE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'addons',
        'listPackages',
        undefined,
        { rethrow: true },
      )
      const packages = parseInstalledPackages(raw)
      if (packages === null) throw new Error('package list unreadable')
      return packages
    },
  })
}
