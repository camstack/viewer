#!/usr/bin/env node
/**
 * Renders the web shell and the PWA manifest for the mount the build targets:
 *
 *   public/index.template.html    → public/index.html
 *   public/manifest.template.json → public/manifest.json
 *
 * Both from ONE prefix, `getWebMountPrefix()` (`/` at the root; `<base>/camstack/`
 * under EXPO_PUBLIC_WEB_BASE_PATH — the same value app.config.ts hands to Expo
 * as `experiments.baseUrl`). Run before `expo export --platform web`, and it is
 * what `npm run web` serves too, so the committed outputs are the root render.
 *
 * Why the shell is rendered at all: the hub serves the SPA shell for every
 * extension-less route under `/viewer/camstack/`, so a RELATIVE manifest link
 * (`./manifest.json`) resolved from `/viewer/camstack/camera/101` to a 404 and
 * an install from any deep route became a bookmark, not an app. And the
 * manifest's icons were prefixed with `<base>/` while the files live under
 * `<base>/camstack/` — the hub answered those with the HTML shell.
 *
 * Pure `renderWebShell` is exported for the spec (`src/__tests__/web-shell.spec.ts`);
 * nothing is written unless this file is the entry point.
 */
const fs = require("fs");
const path = require("path");
const { getWebMountPrefix } = require("../config-web-base.js");

const MOUNT_TOKEN = /__WEB_MOUNT_PREFIX__/g;

const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");

const RENDERS = [
  { template: "index.template.html", out: "index.html" },
  { template: "manifest.template.json", out: "manifest.json" },
];

/**
 * Substitute the mount prefix into a template. The prefix must be an absolute
 * directory (`/…/`): anything else glues onto the file names that follow it.
 *
 * @param {string} template
 * @param {string} prefix
 * @returns {string}
 */
function renderWebShell(template, prefix) {
  if (!prefix.startsWith("/") || !prefix.endsWith("/")) {
    throw new Error(
      `web mount prefix must start and end with "/", got ${JSON.stringify(prefix)}`
    );
  }
  return template.replace(MOUNT_TOKEN, prefix);
}

function main() {
  const prefix = getWebMountPrefix();
  for (const { template, out } of RENDERS) {
    const source = fs.readFileSync(path.join(publicDir, template), "utf8");
    fs.writeFileSync(path.join(publicDir, out), renderWebShell(source, prefix), "utf8");
  }
  console.log("web shell + manifest rendered for mount prefix:", prefix);
}

if (require.main === module) main();

module.exports = { renderWebShell };
