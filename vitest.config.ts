import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const stub = (name: string): string =>
  fileURLToPath(new URL(`./src/testing/native-stubs/${name}`, import.meta.url))

/**
 * `react-native` is Flow-typed source: importing it under vitest fails to
 * parse, which is why this repo had no renderer at all and shipped a mount
 * crash to production. The fix is the same one Expo uses for the web target —
 * resolve `react-native` to `react-native-web` — plus a stub per native-only
 * module (see `src/testing/native-stubs/`).
 *
 * These aliases are inert for the ~230 node-environment specs: none of them
 * import `react-native` or any stubbed module.
 */
const nativeAliases = [
  { find: /^react-native$/, replacement: stub('react-native.tsx') },
  { find: /^expo-router$/, replacement: stub('expo-router.tsx') },
  { find: /^expo-router\/ui$/, replacement: stub('expo-router-ui.tsx') },
  { find: /^expo-router\/react-navigation$/, replacement: stub('expo-router-react-navigation.ts') },
  { find: /^expo-haptics$/, replacement: stub('expo-haptics.ts') },
  { find: /^expo-blur$/, replacement: stub('expo-blur.tsx') },
  { find: /^expo-image$/, replacement: stub('expo-image.tsx') },
  { find: /^expo-linear-gradient$/, replacement: stub('expo-linear-gradient.tsx') },
  { find: /^expo-status-bar$/, replacement: stub('expo-status-bar.tsx') },
  { find: /^expo-symbols$/, replacement: stub('expo-symbols.tsx') },
  { find: /^expo-constants$/, replacement: stub('expo-constants.ts') },
  { find: /^expo-updates$/, replacement: stub('expo-updates.ts') },
  { find: /^expo-localization$/, replacement: stub('expo-localization.ts') },
  { find: /^expo-battery$/, replacement: stub('expo-battery.ts') },
  { find: /^expo-modules-core$/, replacement: stub('expo-modules-core.ts') },
  { find: /^expo-screen-orientation$/, replacement: stub('expo-screen-orientation.ts') },
  { find: /^expo-file-system(\/legacy)?$/, replacement: stub('file-system.ts') },
  { find: /^expo-(sharing|clipboard|document-picker|web-browser|linking|pip|sqlite|font|splash-screen|system-ui|device|crypto|camera)$/, replacement: stub('empty.tsx') },
  { find: /^expo-secure-store$/, replacement: stub('secure-store.ts') },
  { find: /^react-native-safe-area-context$/, replacement: stub('safe-area-context.tsx') },
  { find: /^react-native-svg$/, replacement: stub('react-native-svg.tsx') },
  { find: /^react-native-video$/, replacement: stub('react-native-video.tsx') },
  { find: /^react-native-webrtc$/, replacement: stub('react-native-webrtc.ts') },
  { find: /^react-native-webview$/, replacement: stub('react-native-webview.tsx') },
  { find: /^react-native-gesture-handler$/, replacement: stub('gesture-handler.tsx') },
  { find: /^react-native-reanimated$/, replacement: stub('reanimated.tsx') },
  { find: /^react-native-draggable-flatlist$/, replacement: stub('draggable-flatlist.tsx') },
  { find: /^react-native-volume-manager$/, replacement: stub('empty.tsx') },
  { find: /^camstack-webrtc-audio$/, replacement: stub('empty.tsx') },
  { find: /^camstack-device-key$/, replacement: stub('camstack-device-key.ts') },
  { find: /^@shopify\/flash-list$/, replacement: stub('flash-list.tsx') },
  { find: /^@react-native-async-storage\/async-storage$/, replacement: stub('async-storage.ts') },
  { find: /^@react-native-community\/netinfo$/, replacement: stub('netinfo.ts') },
  /**
   * Metro treats a `.html` import as an ASSET (the OTA embed bundle);
   * vite tries to parse it as a module and dies on the `<title>` tag.
   */
  { find: /^.*\.html$/, replacement: stub('html-asset.ts') },
]

export default defineConfig({
  resolve: { alias: nativeAliases },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.spec.ts', 'shared/**/__tests__/**/*.spec.ts', 'web-server/__tests__/**/*.spec.ts', 'scripts/**/__tests__/**/*.spec.ts'],
    /**
     * Runs before a spec's own imports — the only point early enough to catch a
     * module-evaluation throw. Self-limits to jsdom (the mount specs); the node
     * specs keep node semantics. See `src/testing/hermes-globals.ts`.
     */
    setupFiles: ['./src/testing/hermes-globals.ts'],
    server: {
      deps: {
        /**
         * `resolve.alias` only applies to ids VITE resolves. A dependency left
         * external is loaded by node's own resolver, so the aliases above are
         * invisible inside it — `lucide-react-native/icons/bell` would reach
         * the real `react-native-svg`, which imports Flow-typed
         * `react-native` and dies on `Unexpected token 'typeof'`. Inlining the
         * few third-party packages that import a native module puts them back
         * under the alias table.
         */
        inline: [/lucide-react-native/, /@camstack[/\\]ui-library/],
      },
    },
    /**
     * Several source guards walk the whole of `src/` synchronously at module
     * load (`readdirSync` + `statSync` per entry) to prove a retired component
     * is imported by nothing. Alone each takes 3-7 s; run in parallel with 120
     * other files they exceed vitest's 5 s default and fail as TIMEOUTS while
     * passing in isolation — a false alarm that costs more attention than the
     * scan costs time. Raised rather than the walks removed: those guards are
     * the only thing standing between a "retired" wrapper and a quiet
     * resurrection, and this repo has no renderer to test them any other way.
     */
    testTimeout: 30_000,
  },
})
