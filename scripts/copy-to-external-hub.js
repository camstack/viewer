#!/usr/bin/env node
/**
 * Copies camstack web dist to external-hub-notifier/fs-camstack.
 * Run with: COPY_TO_EXTERNAL_HUB=1 npm run build:web && node scripts/copy-to-external-hub.js
 * Or: npm run build:web:embedded
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");
const destDir = path.join(root, "../external-hub-notifier/fs/camstack");

if (process.env.COPY_TO_EXTERNAL_HUB !== "1") {
  console.log("COPY_TO_EXTERNAL_HUB not set, skipping copy");
  process.exit(0);
}

if (!fs.existsSync(distDir)) {
  console.error("dist/ not found. Run npm run build:web first.");
  process.exit(1);
}

if (fs.existsSync(destDir)) {
  fs.rmSync(destDir, { recursive: true, force: true });
}
fs.mkdirSync(destDir, { recursive: true });

execSync(`cp -r dist/* "${destDir}/"`, { cwd: root, stdio: "inherit" });
console.log("Camstack dist copied to external-hub-notifier/fs/camstack");
