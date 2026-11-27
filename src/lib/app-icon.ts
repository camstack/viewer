import {
  getAppIconName,
  setAlternateAppIcon,
  supportsAlternateIcons,
} from 'expo-alternate-app-icons'

/**
 * The launcher icons the app can switch to. The ids are the PascalCase names the
 * config plugin registered from `config-alternate-icons.js` (a spec holds the
 * two lists equal). `null` everywhere below means the default icon.
 */
export const APP_ICON_IDS = [
  'NeonAmber',
  'NeonCyan',
  'Synthwave',
  'Midnight',
  'Mint',
  'Lava',
  'Gold',
  'Owl',
  'Home',
  'Constellation',
] as const

export type AppIconId = (typeof APP_ICON_IDS)[number]

const isAppIconId = (value: string): value is AppIconId =>
  (APP_ICON_IDS as readonly string[]).includes(value)

/** False on the web and on a device that cannot change its launcher icon. */
export function canChangeAppIcon(): boolean {
  return supportsAlternateIcons
}

/** The icons offered, in display order. Empty when switching is unsupported. */
export function listAppIcons(): readonly AppIconId[] {
  return canChangeAppIcon() ? APP_ICON_IDS : []
}

/** The active icon, or `null` for the default (or an id this build does not know). */
export function getAppIcon(): AppIconId | null {
  if (!canChangeAppIcon()) return null
  const name = getAppIconName()
  return name !== null && isAppIconId(name) ? name : null
}

/** Switch the launcher icon; `null` restores the default. Resolves to the icon now active. */
export async function setAppIcon(icon: AppIconId | null): Promise<AppIconId | null> {
  if (!canChangeAppIcon()) return null
  const name = await setAlternateAppIcon(icon)
  return name !== null && isAppIconId(name) ? name : null
}
