#!/usr/bin/env node

/**
 * CamStack Android release: version bump + EAS build + submit
 * Usage: node scripts/release-android.js [patch|minor|major]
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
// The app version lives ONLY in package.json — app.config.ts derives it.
if (!fs.existsSync(pkgPath)) {
  err("package.json not found. Run from project root.");
  process.exit(1);
}
const currentVersion = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
const versionCodeMatch = config.match(/versionCode: (\d+)/);
if (!currentVersion || !versionCodeMatch) {
  err("version (package.json) or versionCode (app.config.ts) not found");
  process.exit(1);
}

const currentVersionCode = parseInt(versionCodeMatch[1], 10);
const newVersion = inc(currentVersion, bumpType);
const newVersionCode = currentVersionCode + 1;

info(`Version: ${currentVersion} → ${newVersion}`);
info(`Version code: ${currentVersionCode} → ${newVersionCode}`);

// Before anything is written: the notes for newVersion must already be in
// src/app/whats-new.ts. `--skip-whats-new` bypasses it, loudly.
gateOrExit({ bumpType });

const backupPath = `${configPath}.backup`;
fs.copyFileSync(configPath, backupPath);

// No `version:` write — derived from package.json (bumped below).
config = config.replace(/runtimeVersion: "[^"]+"/, `runtimeVersion: "${newVersion}"`);
config = config.replace(/versionCode: \d+/, `versionCode: ${newVersionCode}`);
fs.writeFileSync(configPath, config);
ok("app.config.ts updated");

if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  ok("package.json updated");
}

async function main() {
  try {
    // Keep package-lock.json in sync with the bumped package.json version, or
    // EAS's `npm ci` fails ("package.json and package-lock.json not in sync").
    // Same step release-ios.js and update.js carry.
    info("Syncing package-lock.json to the new version...");
    await run("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"]);
    ok("package-lock.json synced");

    info("Starting EAS build + submit for Android (profile production, --no-wait)...");
    await run("npx", [
      "eas",
      "build",
      "--platform",
      "android",
      "--profile",
      "production",
      "--auto-submit-with-profile",
      "production",
      "--no-wait",
    ]);
    ok("EAS build and submit triggered");

    try {
      info("Committing version changes...");
      await run("git", ["add", "app.config.ts", "package.json", "package-lock.json"]);
      await run("git", ["commit", "-m", `chore(android): bump version to ${newVersion} (versionCode ${newVersionCode})`], { shell: false });
      await run("git", ["push"]);
      ok("Changes committed and pushed");
    } catch (gitErr) {
      warn(`Git commit/push skipped: ${gitErr.message}`);
    }

    try {
      fs.unlinkSync(backupPath);
    } catch {}

    ok(`🎉 Android release v${newVersion} (versionCode ${newVersionCode}) triggered`);
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
