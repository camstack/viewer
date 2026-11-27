"use strict";

// The alternate app icons the user can switch to (expo-alternate-app-icons).
// ONE list: app.config.ts reads it for the config plugin, and
// src/lib/app-icon.ts mirrors the `name`s (a spec holds the two equal).
// `name` is the PascalCase id the native side registers; `file` is the flat
// 1024 PNG under assets/alternate-icons/; `background` fills the Android
// adaptive-icon canvas around that PNG (the icon's own base colour).
const ALTERNATE_ICONS = [
  { name: "NeonAmber", file: "neon-amber.png", background: "#1c1917" },
  { name: "NeonCyan", file: "neon-cyan.png", background: "#0a2530" },
  { name: "Synthwave", file: "synthwave.png", background: "#be185d" },
  { name: "Midnight", file: "midnight.png", background: "#1e2a52" },
  { name: "Mint", file: "mint.png", background: "#0f5f55" },
  { name: "Lava", file: "lava.png", background: "#3b0a0a" },
  { name: "Gold", file: "gold.png", background: "#292524" },
  { name: "Owl", file: "owl.png", background: "#292524" },
  { name: "Home", file: "home.png", background: "#e7e5e4" },
  { name: "Constellation", file: "constellation.png", background: "#111827" },
];

exports.ALTERNATE_ICONS = ALTERNATE_ICONS;
