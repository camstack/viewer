#!/usr/bin/env node

/**
 * CamStack iOS release: version bump + EAS build + submit
 * Usage: node scripts/release-ios.js [patch|minor|major]
 * Default: patch
 * Uses production profile (APP_VARIANT=production from eas.json).
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { gateOrExit } = require("./lib/check-whats-new");

const colors = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m" };
const log = (c, m) => console.log(`${colors[c]}${m}${colors.reset}`);
const info = (m) => log("blue", `ℹ️  ${m}`);
const ok = (m) => log("green", `✅ ${m}`);
const warn = (m) => log("yellow", `⚠️  ${m}`);
const err = (m) => log("red", `❌ ${m}`);

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    info(`Running: ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, { stdio: "inherit", shell: true, ...options });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
    child.on("error", reject);
  });
}

const configPath = path.join(process.cwd(), "app.config.ts");
const pkgPath = path.join(process.cwd(), "package.json");
if (!fs.existsSync(configPath)) {
  err("app.config.ts not found. Run from project root.");
  process.exit(1);
}

const bumpType = process.argv[2] || "patch";
if (!["patch", "minor", "major"].includes(bumpType)) {
  err(`Invalid bump type: ${bumpType}. Use: patch, minor, major`);
  process.exit(1);
}

function inc(v, type) {
  const [M, m, p] = v.split(".").map(Number);
  return type === "major" ? `${M + 1}.0.0` : type === "minor" ? `${M}.${m + 1}.0` : `${M}.${m}.${p + 1}`;
}

let config = fs.readFileSync(configPath, "utf8");
// The app version lives ONLY in package.json — app.config.ts derives it
// (`version: require("./package.json").version`). It used to be duplicated in
// both, and they diverged silently for four releases.
if (!fs.existsSync(pkgPath)) {
  err("package.json not found. Run from project root.");
  process.exit(1);
}
const currentVersion = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
const buildNumberMatch = config.match(/buildNumber: "([^"]+)"/);
if (!currentVersion || !buildNumberMatch) {
  err("version (package.json) or buildNumber (app.config.ts) not found");
  process.exit(1);
}

const currentBuildNumber = parseInt(buildNumberMatch[1], 10);
const newVersion = inc(currentVersion, bumpType);
const newBuildNumber = currentBuildNumber + 1;

info(`Version: ${currentVersion} → ${newVersion}`);
info(`Build number: ${currentBuildNumber} → ${newBuildNumber}`);

// Before anything is written: the notes for newVersion must already be in
// src/app/whats-new.ts. `--skip-whats-new` bypasses it, loudly.
gateOrExit({ bumpType });

const backupPath = `${configPath}.backup`;
fs.copyFileSync(configPath, backupPath);

// No `version:` write — it is derived from package.json (bumped below).
// `runtimeVersion` DOES move on a native release: it is the OTA compatibility
// pin, and a new binary starts a new OTA lineage.
config = config.replace(/runtimeVersion: "[^"]+"/, `runtimeVersion: "${newVersion}"`);
config = config.replace(/buildNumber: "[^"]+"/, `buildNumber: "${newBuildNumber}"`);
fs.writeFileSync(configPath, config);
ok("app.config.ts updated");

if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  ok("package.json updated");
}
// The newest native build, for the app to compare itself with: the web build
// carries this file and the hub serves it at /viewer/camstack/native-release.json
// (src/app/native-release.ts). Written BEFORE the build so the commit below
// carries it; it reaches the hub with the next `build:orchestrator`.
fs.writeFileSync(
  path.join(__dirname, "..", "public", "native-release.json"),
  JSON.stringify(
    {
      version: newVersion,
      buildNumber: newBuildNumber,
      runtimeVersion: newVersion,
      channel: "testflight",
      publishedAt: new Date().toISOString(),
      storeAppId: "6759228132",
    },
    null,
    2,
  ) + "\n",
);
ok("public/native-release.json written");

async function main() {
  try {
    // Keep package-lock.json in sync with the bumped package.json version.
    // Without this, EAS's `npm ci` install phase fails: the lockfile's root
    // version field still points at the previous version → "package.json and
    // package-lock.json not in sync".
    info("Syncing package-lock.json to the new version...");
    await run("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"]);
    ok("package-lock.json synced");

    info("Starting EAS build + submit for iOS (profile production, --no-wait)...");
    await run("npx", [
      "eas",
      "build",
      "--platform",
      "ios",
      "--profile",
      "production",
      "--auto-submit-with-profile",
      "production",
      "--no-wait",
    ]);
    ok("EAS build and submit triggered");

    try {
      info("Committing version changes...");
      await run("git", ["add", "app.config.ts", "package.json", "package-lock.json", "public/native-release.json"]);
      await run("git", ["commit", "-m", `chore(ios): bump version to ${newVersion} (build ${newBuildNumber})`], { shell: false });
      await run("git", ["push"]);
      ok("Changes committed and pushed");
    } catch (gitErr) {
      warn(`Git commit/push skipped: ${gitErr.message}`);
    }

    try {
      fs.unlinkSync(backupPath);
    } catch {}

    ok(`🎉 iOS release v${newVersion} (build ${newBuildNumber}) triggered`);
  } catch (e) {
    err(`Release failed: ${e.message}`);
    try {
      fs.copyFileSync(backupPath, configPath);
      fs.unlinkSync(backupPath);
      warn("app.config.ts restored from backup");
    } catch {}
    process.exit(1);
  }
}

main();
