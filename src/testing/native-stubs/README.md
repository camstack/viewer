# `src/testing/native-stubs`

Test-only replacements for modules that cannot load outside a native runtime.
Wired up in `vitest.config.ts` (`resolve.alias`) so `src/testing/mount.tsx` can
mount real screens under jsdom + `react-native-web`.

Rules for anything added here:

- **Stub the PLATFORM, never the app.** A stub may replace a native module
  (`expo-haptics`, `react-native-webrtc`, `react-native-reanimated`). It must
  never replace a screen, a data hook, a store or a pure module of ours — those
  are the things a mount smoke test exists to exercise, and a stub over them
  turns the test into a tautology.
- Keep the surface **shaped like the real module**, so a component that reads a
  field gets a value of the right kind rather than `undefined`.
