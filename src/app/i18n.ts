/**
 * Self-contained i18next init over the shared `locales/` JSON + the device
 * locale.
 *
 * **Both languages are parsed at module load — 119,611 B — and that is on
 * purpose for now.** It was measured as a boot cost (this module is the first
 * statement of the root layout) and then left alone, because the obvious fixes
 * are both worse here:
 *
 *  - deferring the non-active language needs an ASYNC init, which means gating
 *    first paint on it or accepting a flash of untranslated keys;
 *  - loading only `en` eagerly and `it` on demand gives an Italian user — the
 *    operator — a first paint in English, then a flip.
 *
 * `it.json` is COMPLETE (1354/1354 keys), so the `en` fallback is never
 * actually consulted for an Italian user; it is dead weight that cannot be
 * dropped safely while a missing key would render as a raw key. The real fix
 * is web code-splitting (`experiments.asyncRoutes` + `output: "static"`),
 * which is off — see the roadmap. Do not "optimise" this in isolation.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as Localization from "expo-localization";
import { ServerStore } from "../connection/server-store.js";
import { asyncKvStore } from "./kv-async-storage.js";
import { readBootLanguage, useLanguageStore } from "../store/language-store.js";
import { resolveLanguage } from "../data/use-language.js";

import en from "../../locales/en.json";
import it from "../../locales/it.json";

const resources = {
  en: { translation: en },
  it: { translation: it },
};

const deviceLocale = Localization.getLocales()[0]?.languageCode?.slice(0, 2) ?? "en";
const lng = Object.keys(resources).includes(deviceLocale) ? deviceLocale : "en";

i18n.use(initReactI18next).init({
  resources,
  lng,
  fallbackLng: "en",
  // i18next >= 25 prints a vendor banner on every init (every test process).
  showSupportNotice: false,
  interpolation: {
    escapeValue: false,
  },
});

// The language is an ACCOUNT setting cached per hub (`store/language-store.ts`).
// At boot, before any hub is bound, apply the copy of the hub this device last
// used, so an explicit pick is the first paint. Async, best-effort; 'system'
// (or nothing cached) keeps the device-locale init above.
void new ServerStore(asyncKvStore)
  .getActiveServerId()
  .then(readBootLanguage)
  .then((saved) => {
    if (saved === "it" || saved === "en") void i18n.changeLanguage(saved);
  })
  .catch(() => undefined);

// From then on i18next follows the store: a pick, a hub switch, or a value
// synced from another device of the same account.
useLanguageStore.subscribe((state, previous) => {
  if (state.preference === previous.preference && state.hydrated === previous.hydrated) return;
  void i18n.changeLanguage(resolveLanguage(state.preference));
});

export default i18n;
