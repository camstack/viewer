#!/usr/bin/env node
/**
 * Copies the viewer's web export (dist/) into the CamStack server's
 * pipeline-orchestrator addon, which serves it as the `viewer-ui` capability
 * (hub mounts it at /viewer/camstack). Mirrors copy-dist-to-ha-addon.js /
 * copy-to-external-hub.js.
 *
 * Run after:  EXPO_PUBLIC_WEB_BASE_PATH=/viewer npm run build:web
 * (the base path makes every asset URL /viewer/camstack/... — the hub mount).
 *
 * The viewer is a git submodule at <server>/camstack, so the orchestrator is a
 * sibling under <server>/packages. We stage into the addon's `assets/viewer`
 * (NOT `dist/`) because the addon's own vite build wipes `dist/`; `assets` is in
 * the addon's package `files`, so it ships on `camstack deploy`.
 */
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const distSrc = path.join(projectRoot, "dist");
const orchestratorRoot = path.join(projectRoot, "..", "packages", "addon-pipeline-orchestrator");
const distDest = path.join(orchestratorRoot, "assets", "viewer");
const CURRENT_FILES_MANIFEST = ".viewer-current-files.json";

function listFiles(root, relative = "") {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap((entry) => {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    return entry.isDirectory() ? listFiles(root, child) : [child];
  });
}

if (!fs.existsSync(path.join(distSrc, "index.html"))) {
  console.error(
    "dist/index.html not found. Run: EXPO_PUBLIC_WEB_BASE_PATH=/viewer npm run build:web"
  );
  process.exit(1);
}
if (!fs.existsSync(orchestratorRoot)) {
  console.error("pipeline-orchestrator addon not found at:", path.resolve(orchestratorRoot));
  console.error("Ensure the viewer submodule sits at <camstack-server>/camstack.");
  process.exit(1);
}

// Keep the immediately previous build's immutable assets. A tab or PWA that
// already loaded the old HTML will request ITS hashed JS after we deploy; if
// that file is gone the whole Viewer becomes a blank page (observed live on
// 2026-08-15: index-4af7….js 404'd under an open tab). Hashed assets are
// content-addressed, so overlap is free; the manifest records exactly which
// files the CURRENT build owns so retention never accumulates past one build.
const previousManifestPath = path.join(distDest, CURRENT_FILES_MANIFEST);
const previousFiles = fs.existsSync(previousManifestPath)
  ? JSON.parse(fs.readFileSync(previousManifestPath, "utf-8"))
  : listFiles(distDest);
const previousStatic = new Map();
for (const relative of previousFiles) {
  const normalized = relative.split(path.sep).join("/");
  if (!normalized.startsWith("_expo/static/")) continue;
  const absolute = path.join(distDest, relative);
  if (fs.existsSync(absolute)) previousStatic.set(relative, fs.readFileSync(absolute));
}

if (fs.existsSync(distDest)) {
  fs.rmSync(distDest, { recursive: true });
}
fs.mkdirSync(distDest, { recursive: true });
fs.cpSync(distSrc, distDest, { recursive: true });

const currentFiles = listFiles(distSrc);
for (const [relative, contents] of previousStatic) {
  const absolute = path.join(distDest, relative);
  if (fs.existsSync(absolute)) continue;
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents);
}
fs.writeFileSync(
  path.join(distDest, CURRENT_FILES_MANIFEST),
  `${JSON.stringify(currentFiles.map((f) => f.split(path.sep).join("/")), null, 2)}\n`
);

// Stamp the viewer version + git SHA so the orchestrator's viewer-ui
// getVersion() reports it and a release checkpoint records the exact source
// ref the embedded web build came from.
const viewerPkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
let gitSha = "unknown";
try {
  gitSha = require("child_process")
    .execSync("git rev-parse --short HEAD", { cwd: projectRoot })
    .toString()
    .trim();
} catch {
  /* not a git checkout (e.g. tarball) — version alone still stamps */
}
fs.writeFileSync(
  path.join(distDest, ".viewer-version"),
  `${String(viewerPkg.version || "unknown")}+${gitSha}`
);

console.log(
  `Copied viewer v${viewerPkg.version} dist/ → ${path.relative(
    path.join(projectRoot, ".."),
    distDest
  )} (served at /viewer/camstack).`
);
