#!/usr/bin/env node

/**
 * The what's-new gate: every ship script runs this BEFORE it bumps anything.
 *
 * `src/app/whats-new.ts` must carry the notes for the version the script is
 * ABOUT TO WRITE (package.json version + the bump), as the newest entry, with
 * at least one line in English and Italian, each line within the one-line
 * budget. v1.0.591 shipped without notes: `whats-new.spec.ts` assumed the ship
 * chain ran the suite before the bump, and nothing did. This is that missing
 * step, in plain node, with no side effects on failure.
 *
 * Library:  const { checkShip } = require("./lib/check-whats-new")
 * CLI:      node scripts/lib/check-whats-new.js [patch|minor|major]
 *           node scripts/lib/check-whats-new.js --version 1.2.3
 */

const fs = require("fs");
const path = require("path");

/** Hard ceiling per line — the same number `whats-new.spec.ts` enforces. */
const LINE_LIMIT = 140;
const LANGUAGES = ["en", "it"];
const BUMP_TYPES = ["patch", "minor", "major"];
const WHATS_NEW_REL = path.join("src", "app", "whats-new.ts");

function nextVersion(version, bumpType) {
  if (!BUMP_TYPES.includes(bumpType)) {
    throw new Error(`Invalid bump type: ${bumpType}. Use: ${BUMP_TYPES.join(", ")}`);
  }
  const parts = String(version).split(".").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`Not a plain x.y.z version: ${version}`);
  }
  const [M, m, p] = parts;
  if (bumpType === "major") return `${M + 1}.0.0`;
  if (bumpType === "minor") return `${M}.${m + 1}.0`;
  return `${M}.${m}.${p + 1}`;
}

/**
 * Evaluates `whats-new.ts` and returns its `WHATS_NEW`. The file is pure data
 * plus a few functions, with no imports; TypeScript (a devDependency, present
 * wherever these scripts run) transpiles it to CommonJS in memory.
 */
function loadWhatsNew(file) {
  let ts;
  try {
    ts = require("typescript");
  } catch {
    throw new Error("`typescript` is not installed — run `npm ci` first.");
  }
  const source = fs.readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", outputText)(mod, mod.exports, require);
  if (!Array.isArray(mod.exports.WHATS_NEW)) {
    throw new Error(`${file} does not export a WHATS_NEW array.`);
  }
  return mod.exports.WHATS_NEW;
}

/** Pure check. Returns the problems, empty when the entry is shippable. */
function findProblems(entries, version) {
  const entry = entries.find((e) => e && e.version === version);
  if (!entry) return [`no WHATS_NEW entry for ${version}`];

  const problems = [];
  if (entries[0] !== entry) {
    problems.push(`the ${version} entry must be the FIRST one (newest first); first is ${entries[0]?.version}`);
  }
  for (const lang of LANGUAGES) {
    const lines = entry.notes?.[lang];
    if (!Array.isArray(lines) || lines.length === 0) {
      problems.push(`${version} has no '${lang}' notes`);
      continue;
    }
    lines.forEach((line, i) => {
      if (typeof line !== "string" || line.trim() === "") {
        problems.push(`${version} ${lang}[${i}] is empty`);
      } else if (/[\r\n]/.test(line)) {
        problems.push(`${version} ${lang}[${i}] spans several lines`);
      } else if (line.length > LINE_LIMIT) {
        problems.push(`${version} ${lang}[${i}] is ${line.length} chars (max ${LINE_LIMIT}): ${line.slice(0, 50)}…`);
      }
    });
  }
  return problems;
}

/**
 * The gate for a ship script: target = package.json version + bump (or an
 * explicit `version`). Reads only; writes nothing.
 */
function checkShip({ root = process.cwd(), bumpType = "patch", version } = {}) {
  const file = path.join(root, WHATS_NEW_REL);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const target = version ?? nextVersion(pkg.version, bumpType);
  const problems = findProblems(loadWhatsNew(file), target);
  return { ok: problems.length === 0, version: target, currentVersion: pkg.version, file: WHATS_NEW_REL, problems };
}

function failureMessage(result) {
  return [
    `What's new is missing or invalid for v${result.version} (current v${result.currentVersion}):`,
    ...result.problems.map((p) => `  - ${p}`),
    `Add the entry at the TOP of ${result.file} — one short line per change, en + it,`,
    `under 90 characters (never over ${LINE_LIMIT}) — commit it, then re-run. Nothing was bumped.`,
  ].join("\n");
}

/**
 * For the ship scripts: exits the process on failure, BEFORE any write.
 * `--skip-whats-new` bypasses it loudly, like `--allow-stale`.
 */
function gateOrExit({ bumpType, argv = process.argv, root = process.cwd() }) {
  const red = (m) => console.log(`\x1b[31m❌ ${m}\x1b[0m`);
  if (argv.includes("--skip-whats-new")) {
    console.log("\x1b[33m⚠️  --skip-whats-new: shipping WITHOUT the what's-new check.\x1b[0m");
    return;
  }
  let result;
  try {
    result = checkShip({ root, bumpType });
  } catch (e) {
    red(`What's-new check could not run: ${e.message}`);
    process.exit(1);
  }
  if (!result.ok) {
    red(failureMessage(result));
    process.exit(1);
  }
  console.log(`\x1b[32m✅ What's new has v${result.version} (en + it).\x1b[0m`);
}

module.exports = { LINE_LIMIT, nextVersion, loadWhatsNew, findProblems, checkShip, failureMessage, gateOrExit };

if (require.main === module) {
  const args = process.argv.slice(2);
  const vIdx = args.indexOf("--version");
  const version = vIdx >= 0 ? args[vIdx + 1] : undefined;
  const bumpType = args.find((a) => BUMP_TYPES.includes(a)) ?? "patch";
  try {
    const result = checkShip({ bumpType, version });
    if (!result.ok) {
      console.error(failureMessage(result));
      process.exit(1);
    }
    console.log(`What's new has v${result.version} (en + it).`);
  } catch (e) {
    console.error(`What's-new check could not run: ${e.message}`);
    process.exit(1);
  }
}
