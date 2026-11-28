#!/usr/bin/env node

/**
 * The identity gate: a ship script must not run against an app that has no EAS
 * project yet. Dominevo is a NEW store app; until the operator runs `eas init`,
 * `extra.eas.projectId` is absent and `eas build` / `eas update` would either
 * fail halfway or create a project on their own — after the version bump.
 * Refuses BEFORE any side effect. Also reads the App Store Connect app id from
 * its one home, `eas.json` submit.production.ios.ascAppId.
 *
 * Library: const { easProjectGateOrExit, ascAppIdOrExit } = require("./lib/check-ship-identity")
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

/** The public Expo config as JSON, evaluated exactly as `eas` sees it. */
function readPublicConfig(cwd = process.cwd()) {
  const out = execFileSync("npx", ["expo", "config", "--type", "public", "--json"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out);
}

/** The refusal message, or null when the config names an EAS project. */
function easProjectProblem(config) {
  const projectId = config && config.extra && config.extra.eas && config.extra.eas.projectId;
  if (typeof projectId === "string" && projectId.length > 0) return null;
  return "No EAS project: app.config.ts has no extra.eas.projectId. Run `eas init` (it adds the project id), then ship again.";
}

function easProjectGateOrExit(cwd = process.cwd()) {
  const problem = easProjectProblem(readPublicConfig(cwd));
  if (problem !== null) {
    console.error(`❌ ${problem}`);
    process.exit(1);
  }
}

/** `eas.json` submit.production.ios.ascAppId, or null. */
function readAscAppId(cwd = process.cwd()) {
  const eas = JSON.parse(fs.readFileSync(path.join(cwd, "eas.json"), "utf8"));
  const id = eas && eas.submit && eas.submit.production && eas.submit.production.ios && eas.submit.production.ios.ascAppId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function ascAppIdOrExit(cwd = process.cwd()) {
  const id = readAscAppId(cwd);
  if (id === null) {
    console.error(
      "❌ eas.json submit.production.ios.ascAppId is missing. Create the App Store Connect app, then add its id there.",
    );
    process.exit(1);
  }
  return id;
}

module.exports = { easProjectProblem, easProjectGateOrExit, readAscAppId, ascAppIdOrExit };
