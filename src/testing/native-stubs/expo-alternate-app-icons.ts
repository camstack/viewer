/** `expo-alternate-app-icons` under vitest: no native module, so no icon switching. */
export const supportsAlternateIcons = false

export function getAppIconName(): string | null {
  return null
}

export async function setAlternateAppIcon(name: string | null): Promise<string | null> {
  return name
}
