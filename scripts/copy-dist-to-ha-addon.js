#!/usr/bin/env node
/**
 * Copies dist/ to camstack-homeassistant/addon/camstack/dist for the Home Assistant addon build.
 * Run after: EXPO_PUBLIC_WEB_BASE_PATH=/api/hassio_ingress/camstack npm run build:web
 *
 * Expects camstack-homeassistant as a sibling repo: ../camstack-homeassistant
 */
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const distSrc = path.join(projectRoot, "dist");
const distDest = path.join(projectRoot, "..", "camstack-homeassistant", "addon", "camstack", "dist");

if (!fs.existsSync(distSrc)) {
  console.error("dist/ not found. Run: EXPO_PUBLIC_WEB_BASE_PATH=/api/hassio_ingress/camstack npm run build:web");
  process.exit(1);
}

const destDir = path.dirname(distDest);
if (!fs.existsSync(destDir)) {
  console.error("camstack-homeassistant addon not found at:", path.resolve(destDir));
  console.error("Ensure camstack-homeassistant is a sibling of camstack.");
  process.exit(1);
}

if (fs.existsSync(distDest)) {
  fs.rmSync(distDest, { recursive: true });
}
fs.mkdirSync(destDir, { recursive: true });
fs.cpSync(distSrc, distDest, { recursive: true });
console.log("Copied dist/ to camstack-homeassistant/addon/camstack/dist/");
