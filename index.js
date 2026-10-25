/**
 * Custom entry point. Buffer polyfill runs here (require is available at entry).
 * getPolyfills runs before require exists → use index.js instead.
 */
if (typeof global.Buffer === "undefined") {
  global.Buffer = require("buffer").Buffer;
}
if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = global.Buffer;
}
require("expo-router/entry");
