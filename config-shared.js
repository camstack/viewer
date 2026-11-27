"use strict";

// Set APP_VARIANT in .env (development | preview | production)
const isDev = process.env.APP_VARIANT === "development";
const bundleIdentifier = isDev ? "app.dominevo.viewer.dev" : "app.dominevo.viewer";

exports.name = isDev ? "Dominevo Dev" : "Dominevo";
exports.bundleIdentifier = bundleIdentifier;
