"use strict";

// Set APP_VARIANT in .env (development | preview | production)
const isDev = process.env.APP_VARIANT === "development";
const bundleIdentifier = isDev ? "app.dominevo.viewer.dev" : "app.dominevo.viewer";

// The URL scheme the app answers to; src/auth/handoff.ts mirrors the production
// one (a spec holds the two equal).
exports.productionScheme = "dominevo";
exports.scheme = isDev ? `${exports.productionScheme}.dev` : exports.productionScheme;
exports.name = isDev ? "Dominevo Dev" : "Dominevo";
exports.bundleIdentifier = bundleIdentifier;
