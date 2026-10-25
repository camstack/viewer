#!/usr/bin/env node

/**
 * The native-drift gate: `update:*` (an OTA) refuses to ship when anything
 * NATIVE changed since the commit that set the current `runtimeVersion`.
 *
 * An OTA reaches only installs whose `runtimeVersion` matches, but it carries
 * JavaScript only. JavaScript that imports a native module the installed
 * binary does not contain throws at launch. So an OTA is safe exactly when no
 * native input moved: `modules/**`, `plugins/**`, the `plugins` list of
 * app.config.ts, or a dependency that ships native code. Anything else is a
 * native release (`release:ios:*` / `release:android:*`), which moves
 * `runtimeVersion` and so restarts the comparison.
 *
 * Fails closed: if the baseline commit cannot be found, nothing ships.
 *
 * Library:  const { findNativeChanges, checkOta, nativeGateOrExit } = require("./lib/check-native-unchanged")
 * CLI:      node scripts/lib/check-native-unchanged.js
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

/** The text of the `plugins: [ ... ]` array of an app config, or null. */
function pluginsBlock(configText) {
  const start = configText.search(/\bplugins:\s*\[/);
  if (start < 0) return null;
  const open = configText.indexOf("[", start);
  let depth = 0;
  let quote = null;
  for (let i = open; i < configText.length; i += 1) {
    const ch = configText[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return configText.slice(open, i + 1);
    }
  }
  return null;
}

/** Comments and whitespace do not make a native difference. */
function normalizePlugins(block) {
  if (block === null) return null;
  return block.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");
}

/**
 * Pure comparison. `changedPaths` are the files under modules/ and plugins/
 * that differ from the baseline; `isNativeDep(name)` says whether a package
 * ships native code (unknown packages count as native).
 */
function findNativeChanges({ changedPaths, baseConfig, headConfig, basePkg, headPkg, isNativeDep }) {
  const problems = [];
  for (const p of changedPaths) problems.push(`native source changed: ${p}`);
  if (normalizePlugins(pluginsBlock(baseConfig)) !== normalizePlugins(pluginsBlock(headConfig))) {
    problems.push("the `plugins` list of app.config.ts changed");
  }
  const base = { ...(basePkg.dependencies ?? {}) };
  const head = { ...(headPkg.dependencies ?? {}) };
  for (const name of new Set([...Object.keys(base), ...Object.keys(head)])) {
    if (base[name] === head[name]) continue;
    if (isNativeDep(name)) problems.push(`native dependency ${name}: ${base[name] ?? "(absent)"} -> ${head[name] ?? "(absent)"}`);
  }
  return problems;
}

function failureMessage(problems, runtimeVersion) {
  return [
    `Refusing an OTA: native code changed since runtimeVersion ${runtimeVersion} was set.`,
    ...problems.map((p) => `  - ${p}`),
    "",
    "An OTA ships JavaScript only. JavaScript that needs this native code crashes every",
    "installed binary that lacks it at launch. Ship a native release instead:",
    "  npm run release:ios:patch / release:android:patch   (they move runtimeVersion)",
  ].join("\n");
}

function runtimeVersionOf(configText) {
  const m = configText.match(/runtimeVersion:\s*["']([^"']+)["']/);
  return m ? m[1] : null;
}

/** `git` and `readWorking` are injected so the gate is specified without a repository. */
function checkOta({ git, readWorking, isNativeDep, untracked }) {
  const headConfig = readWorking("app.config.ts");
  const runtimeVersion = runtimeVersionOf(headConfig);
  if (runtimeVersion === null) return { ok: false, runtimeVersion, problems: ["runtimeVersion not found in app.config.ts"] };
  const base = git(["log", "-1", "--format=%H", "-S", `runtimeVersion: "${runtimeVersion}"`, "--", "app.config.ts"]).trim();
  if (base === "") {
    return { ok: false, runtimeVersion, problems: [`cannot find the commit that set runtimeVersion ${runtimeVersion}`] };
  }
  const tracked = git(["diff", "--name-only", base, "--", "modules", "plugins"]).split("\n").filter(Boolean);
  const changedPaths = [...new Set([...tracked, ...untracked()])];
  const problems = findNativeChanges({
    changedPaths,
    baseConfig: git(["show", `${base}:app.config.ts`]),
    headConfig,
    basePkg: JSON.parse(git(["show", `${base}:package.json`])),
    headPkg: JSON.parse(readWorking("package.json")),
    isNativeDep,
  });
  return { ok: problems.length === 0, runtimeVersion, problems };
}

/** Does an installed package ship native code? Missing or unreadable counts as yes. */
function installedPackageIsNative(root, name) {
  const dir = path.join(root, "node_modules", name);
  if (!fs.existsSync(dir)) return true;
  return ["expo-module.config.json", "ios", "android", "react-native.config.js"].some((f) => fs.existsSync(path.join(dir, f)));
}

function checkOtaInRepo(root = process.cwd()) {
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  return checkOta({
    git,
    readWorking: (rel) => fs.readFileSync(path.join(root, rel), "utf8"),
    isNativeDep: (name) => installedPackageIsNative(root, name),
    untracked: () => git(["ls-files", "-o", "--exclude-standard", "--", "modules", "plugins"]).split("\n").filter(Boolean),
  });
}

function nativeGateOrExit(root) {
  let result;
  try {
    result = checkOtaInRepo(root);
  } catch (e) {
    console.error(`\x1b[31mNative-drift check could not run: ${e.message}\x1b[0m`);
    process.exit(1);
  }
  if (!result.ok) {
    console.error(`\x1b[31m${failureMessage(result.problems, result.runtimeVersion)}\x1b[0m`);
    process.exit(1);
  }
  console.log(`\x1b[32m✅ No native change since runtimeVersion ${result.runtimeVersion} — safe as an OTA.\x1b[0m`);
}

module.exports = { pluginsBlock, findNativeChanges, checkOta, checkOtaInRepo, failureMessage, nativeGateOrExit };

if (require.main === module) nativeGateOrExit();
