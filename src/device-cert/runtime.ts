/**
 * The device-certificate dependencies as the app wires them: the platform key
 * module, the secure store, the system auth session and expo-crypto. Kept out
 * of the logic modules so those stay specifiable with fakes.
 */
import { Platform } from 'react-native'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import type { DevicePlatform } from '@camstack/types'
import { canonicalizeCallbackUrl, HANDOFF_CALLBACK_PATH } from '../auth/handoff.js'
import { optionalModule } from './optional-module.js'
import { expoPkcePrimitives } from './pkce-expo.js'
import i18n from '../app/i18n.js'
import { handoffLang } from './app-login-handoff.js'
import type { HandoffDeps } from './run-app-login-handoff.js'

export function devicePlatform(): DevicePlatform {
  return Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web' ? Platform.OS : 'other'
}

/** Which kind of client the hub's `clients` list speaks of. */
export function deviceClientKind(): 'native' | 'web' {
  return Platform.OS === 'web' ? 'web' : 'native'
}

export function defaultDeviceName(): string {
  // Loaded on demand: expo-device is native and may be missing from an older binary.
  // Native-backed and possibly absent from the installed binary: loaded on demand (see optional-module.ts).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Device = optionalModule<typeof import('expo-device')>(() => require('expo-device'))
  return Device?.deviceName ?? Device?.modelName ?? (Platform.OS === 'web' ? 'Web browser' : 'Phone')
}

/** The app login handoff over the system auth session (ASWebAuthenticationSession / Custom Tabs). */
export function createHandoffDeps(): HandoffDeps {
  return {
    pkce: expoPkcePrimitives,
    callbackUrl: canonicalizeCallbackUrl(Linking.createURL(HANDOFF_CALLBACK_PATH)),
    lang: () => handoffLang(i18n.resolvedLanguage),
    openAuthSession: async (url, returnUrl) => {
      const result = await WebBrowser.openAuthSessionAsync(url, returnUrl)
      return result.type === 'success' ? { type: 'success', url: result.url } : { type: 'cancel' }
    },
  }
}
