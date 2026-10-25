/**
 * hub-language — the app's current UI language, as the hub should see it.
 *
 * The SDK calls this getter on EVERY request (the `x-camstack-lang` header on
 * the tRPC http link, the `lang` connection param on the WebSocket), so a
 * language switch in Settings reaches the hub on the next call with no
 * reconnect. Reads the shared i18next instance the app initialises in
 * `app/i18n.ts`; kept free of that module so the connection layer does not
 * load native modules.
 */
import i18n from 'i18next'

/** `it`, `it-IT` → `it`; nothing resolved yet → `undefined` (the header is omitted). */
export function hubLanguage(): string | undefined {
  const tag = i18n.language
  if (typeof tag !== 'string' || tag.length === 0) return undefined
  return tag.slice(0, 2).toLowerCase()
}
