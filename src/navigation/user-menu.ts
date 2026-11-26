/**
 * user-menu — what the account menu offers, as pure rules.
 *
 * The saved servers are managed in the drawer's server sheet (current one
 * marked, tap another to switch, add a server, remove one); the drawer row that
 * opens it is always drawn, because the sheet also holds "Add server".
 */
export type UserMenuEntry = 'settings' | 'signOut'

export function userMenuEntries(): readonly UserMenuEntry[] {
  return ['settings', 'signOut']
}

export interface ServerListItem {
  readonly id: string
  readonly lastUsedAt?: number
}

/** Current server first, then the most recently used. */
export function orderServers<T extends ServerListItem>(servers: readonly T[], activeId: string | null): readonly T[] {
  return [...servers].sort((a, b) => {
    if (a.id === activeId) return -1
    if (b.id === activeId) return 1
    return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
  })
}

/** One uppercase initial for the avatar; `?` for a name not known yet. */
export function userInitial(name: string | null | undefined): string {
  const first = (name ?? '').trim().charAt(0)
  return first === '' ? '?' : first.toLocaleUpperCase()
}
