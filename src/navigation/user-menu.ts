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

/**
 * How the Settings entry navigates.
 *
 * Inside `<Tabs>` Settings is a TAB, and a tab is switched the way the four bar
 * entries switch: through a `TabTrigger`. `router.dismissTo('/settings')` from
 * there is a POP_TO aimed at the root stack with nested params for the headless
 * tab navigator — the account menu's only way to Settings, and the one that
 * stopped answering once the bar became a floating capsule. Off the tab tree
 * (camera detail, a stacked modal) there is no trigger, and `dismissTo` is the
 * right call because it pops back to the mounted `(tabs)` route.
 */
export type SettingsRoute = 'tab-trigger' | 'router'

export function settingsRoute(hasTabTrigger: boolean): SettingsRoute {
  return hasTabTrigger ? 'tab-trigger' : 'router'
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
