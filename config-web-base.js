/**
 * Single source of truth for web base path at build time.
 * Used by app.config.ts (experiments.baseUrl) and scripts/write-manifest-for-build.js.
 *
 * - Standalone (default): EXPO_PUBLIC_WEB_BASE_PATH unset → base path "" (app at root, manifest icons /icon-*.png).
 * - External hub: set EXPO_PUBLIC_WEB_BASE_PATH to the plugin public path, or use EXPO_PUBLIC_EMBEDDED=1 for default.
 */
const EXTERNAL_HUB_PUBLIC_BASE =
  "/endpoint/@example/external-hub-notifier/public";

function getWebBasePath() {
  const explicit = process.env.EXPO_PUBLIC_WEB_BASE_PATH;
  if (explicit !== undefined && explicit !== "") {
    return explicit.replace(/\/+$/, "");
  }
  if (
    process.env.EXPO_PUBLIC_EMBEDDED === "1" ||
    process.env.EXPO_PUBLIC_EMBEDDED === "true"
  ) {
    return EXTERNAL_HUB_PUBLIC_BASE;
  }
  return "";
}

/**
 * The path the built web app is MOUNTED at, with a trailing slash — the ONE
 * value the shell (`public/index.html`), the manifest and Expo's
 * `experiments.baseUrl` must agree on. `/` at the root (`npm run web`); under a
 * base path the export is served at `<base>/dominevo/` (the hub mounts
 * `/viewer/dominevo/`).
 *
 * Derived here and nowhere else: the manifest used to prefix its icons with
 * `<base>/` while app.config.ts derived `<base>/dominevo` on its own, so the
 * built manifest named `/viewer/icon-192.png` for a file that lives at
 * `/viewer/dominevo/icon-192.png` — and the hub answered with the HTML shell.
 */
function getWebMountPrefix() {
  const basePath = getWebBasePath();
  return basePath ? `${basePath}/dominevo/` : "/";
}

module.exports = {
  getWebBasePath,
  getWebMountPrefix,
  EXTERNAL_HUB_PUBLIC_BASE,
};
