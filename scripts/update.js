#!/usr/bin/env node

/**
 * CamStack OTA update: version bump + eas update + git push
 * Usage: node scripts/update.js [patch|minor|major]
 * Default: patch
 * Uses APP_VARIANT=production for the update channel.
 */

const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { gateOrExit } = require("./lib/check-whats-new");
const { nativeGateOrExit } = require("./lib/check-native-unchanged");

const colors = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m" };
const log = (c, m) => console.log(`${colors[c]}${m}${colors.reset}`);
const info = (m) => log("blue", `ℹ️  ${m}`);
const ok = (m) => log("green", `✅ ${m}`);
const err = (m) => log("red", `❌ ${m}`);

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    info(`Running: ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, { stdio: "inherit", shell: true, env: { ...process.env, APP_VARIANT: "production" }, ...options });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
    child.on("error", reject);
  });
}

const pkgPath = path.join(process.cwd(), "package.json");
const configPath = path.join(process.cwd(), "app.config.ts");
if (!fs.existsSync(pkgPath)) {
  err("package.json not found. Run from project root.");
  process.exit(1);
}

const bumpType = process.argv[2] || "patch";
if (!["patch", "minor", "major"].includes(bumpType)) {
  err(`Invalid bump type: ${bumpType}. Use: patch, minor, major`);
  process.exit(1);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * Refuse to publish from a checkout that is BEHIND its remote.
 *
 * `eas update` bundles the WORKING TREE, not the remote branch. On 2026-08-03 a
 * local main sat 20 commits behind origin (v1.0.201 against v1.0.249) and a
 * routine `npm run update:patch` shipped v1.0.202 to every device — a silent
 * ROLLBACK that removed a session's worth of shipped fixes. Nothing failed: the
 * publish succeeded, and only the `git push` afterwards was rejected. Had the
 * branch been pushable, the rollback would have gone unnoticed.
 *
 * A version number cannot catch this — 202 looks perfectly normal on its own.
 * The only reliable fact is ancestry: everything on the remote must already be
 * in HEAD. Checked BEFORE the version bump, so a refusal leaves the tree clean.
 *
 * `--allow-stale` exists for a deliberate publish from an older tree (a
 * hotfix off a release point). It is loud on purpose.
 */
function assertNotBehindRemote() {
  if (process.argv.includes("--allow-stale")) {
    log("yellow", "⚠️  --allow-stale: publishing WITHOUT the remote-ancestry check.");
    return;
  }
  let branch;
  try {
    branch = git("rev-parse", "--abbrev-ref", "HEAD");
  } catch {
    info("Not a git checkout — skipping the staleness check.");
    return;
  }
  let upstream;
  try {
    upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");
  } catch {
    log("yellow", `⚠️  '${branch}' tracks no remote branch — cannot verify staleness.`);
    return;
  }
  try {
    git("fetch", "--quiet", "origin");
  } catch {
    log("yellow", `⚠️  Could not reach the remote; comparing against the last known ${upstream}.`);
  }

  // Everything upstream must already be in HEAD. This catches BOTH "behind"
  // and "diverged" — in either case the bundle would omit published work.
  try {
    git("merge-base", "--is-ancestor", upstream, "HEAD");
  } catch {
    const behind = git("rev-list", "--count", `HEAD..${upstream}`);
    const ahead = git("rev-list", "--count", `${upstream}..HEAD`);
    err(`Refusing to publish: '${branch}' is missing ${behind} commit(s) from ${upstream}.`);
    err("`eas update` bundles this working tree, so publishing now would ship an");
    err("app WITHOUT that work — a rollback for every device on the channel.");
    err("");
    err(`  behind ${upstream}: ${behind} commit(s)    ahead: ${ahead} commit(s)`);
    err("");
    err(`Fix:  git pull --rebase    (then re-run)`);
    err(`Or:   npm run update:${bumpType} -- --allow-stale   if the older tree is what you mean to ship.`);
    process.exit(1);
  }
  ok(`'${branch}' contains everything on ${upstream} — safe to publish.`);
}

function inc(v, type) {
  const [M, m, p] = v.split(".").map(Number);
  return type === "major" ? `${M + 1}.0.0` : type === "minor" ? `${M}.${m + 1}.0` : `${M}.${m}.${p + 1}`;
}

// Before anything is written: the notes for the version about to ship must
// already be in src/app/whats-new.ts (v1.0.591 shipped without them), and a
// stale tree must never reach `eas update`.
gateOrExit({ bumpType });
// An OTA carries JavaScript only: refuse when native code moved since runtimeVersion was set.
nativeGateOrExit();
assertNotBehindRemote();

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const currentVersion = pkg.version;
const newVersion = inc(currentVersion, bumpType);

info(`Version: ${currentVersion} → ${newVersion}`);

// Update package.json
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
ok("package.json updated");

// app.config.ts is NOT written here: it DERIVES `version` from package.json
// (`version: require("./package.json").version`), so the bump above is already
// the whole change. It used to carry its own literal, and on 2026-07-29 the two
// diverged — bumps v1.0.200 → v1.0.203 moved package.json while app.config.ts
// stayed at 1.0.199, so every bundle published in that window reported a
// version four releases old and the app read as stale when it was current.
// `runtimeVersion` stays fixed on an OTA either way (it moves only on a native
// release) — that is the OTA compatibility contract.
if (fs.existsSync(configPath)) {
  const config = fs.readFileSync(configPath, "utf8");
  if (!config.includes('require("./package.json").version')) {
    err("app.config.ts no longer derives `version` from package.json — the two can drift again. Fix it before publishing.");
    process.exit(1);
  }
  ok("app.config.ts derives version from package.json (nothing to write)");
}

async function main() {
  try {
    // Keep package-lock.json's root "version" in sync with the bump — a
    // desynced lockfile fails `npm ci` on the next EAS native build (same
    // fix release-ios.js already carries).
    info("Syncing package-lock.json...");
    await run("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"]);
    ok("package-lock.json synced");

    // Native WebViews load the generated self-contained HTML asset, not the
    // embed TypeScript sources. Rebuild it before Expo snapshots the working
    // tree; otherwise an embed-only fix publishes successfully while devices
    // keep receiving the previous HTML hash.
    info("Syncing native and web embed assets...");
    await run("npm", ["run", "sync:embed"]);
    ok("Embed assets synced");

    info("Pushing OTA update (APP_VARIANT=production, channel production)...");
    // --auto: take the update message from the latest git commit — a bare
    // non-interactive `eas update` errors out asking for --message/--auto.
    await run("npx", ["eas", "update", "--environment", "production", "--channel", "production", "--auto"]);
    ok("EAS update triggered");

    info("Committing and pushing...");
    await run("git", [
      "add",
      "package.json",
      "app.config.ts",
      "package-lock.json",
      "assets/embed/camstack-embed.html",
      "public/embed",
    ]);
    await run("git", ["commit", "-m", `chore: bump version to v${newVersion} (OTA update)`], { shell: false });
    await run("git", ["push"]);
    ok("Git push completed");

    ok(`🎉 Update v${newVersion} completed`);
  } catch (e) {
    err(`Update failed: ${e.message}`);
    process.exit(1);
  }
}

main();
