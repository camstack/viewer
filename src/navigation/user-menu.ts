/**
 * user-menu — what the account menu offers, as pure rules.
 *
 * The saved servers are listed INLINE (current one marked, tap another to
 * switch) and only when there are at least two: a choice with one option is not
 * rendered. There is no "Add server" here — that is a Settings act.
 */
export type UserMenuEntry = 'settings' | 'signOut'

export function userMenuEntries(): readonly UserMenuEntry[] {
  return ['settings', 'signOut']
}

/** Whether the inline server list is drawn. */
export function showServerList(serverCount: number): boolean {
  return serverCount >= 2
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
