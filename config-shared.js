"use strict";

// Set APP_VARIANT in .env (development | preview | production)
const isDev = process.env.APP_VARIANT === "development";
const bundleIdentifier = isDev ? "com.apocaliss92.camstack.dev" : "com.apocaliss92.camstack";

exports.name = isDev ? "CamStack Dev" : "CamStack";
exports.bundleIdentifier = bundleIdentifier;
