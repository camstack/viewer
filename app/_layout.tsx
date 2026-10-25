// Clean src root. The camstack-only client owns the app shell; the legacy
// External hub polyfills/guards and legacy route tree were removed in the src
// restart. The Buffer entry polyfill (for some transitive deps) still lives in
// index.js. i18n is salvaged from v1 (self-contained: locales/ + expo-localization).
import "../src/app/i18n";
// Side effect: stamps the embed cache identity before the first render, so the
// warm-up and the real player agree on one cache entry. See the module.
import "../src/app/embed-cache-identity";
// Side effect: starts the persisted camera-prefs + grid reads immediately, so a
// screen never renders with a placeholder value it then has to correct. See
// the module for the mid-start stream swap that caused.
import "../src/app/prefs-warmup";
import { Stack } from "expo-router";
import { RootProviders } from "../src/app/RootProviders";

export default function RootLayout() {
  return (
    <RootProviders>
      <Stack screenOptions={{ headerShown: false }} />
    </RootProviders>
  );
}
