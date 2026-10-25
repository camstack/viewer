const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const { rewriteJsSpecifier } = require("./scripts/lib/metro-js-specifier");

const config = getDefaultConfig(__dirname);
if (!config.resolver.assetExts.includes("html")) {
  config.resolver.assetExts.push("html");
}

// Exclude unused assets: logos/ contains source files for icon generation (logoV1, logoV2),
// used only by regen-icons script at build time, never required in the app bundle.
const logosBlock = /[\/\\]assets[\/\\]logos[\/\\]/;
config.resolver.blockList = [
  logosBlock,
  ...(Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [config.resolver.blockList].filter(Boolean)),
];

// Node.js builtins some bundled deps still resolve by name
config.resolver.extraNodeModules = {
  buffer: require.resolve("buffer"),
  events: require.resolve("events"),
  "node:crypto": path.join(__dirname, "shims/node-crypto.js"),
  "node:fs": path.join(__dirname, "shims/node-fs.js"),
  "node:path": path.join(__dirname, "shims/node-path.js"),
  stream: require.resolve("readable-stream"),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath || "";
  // react-native-webrtc imports 'event-target-shim/index' which is not in the package exports
  if (moduleName === "event-target-shim/index" || moduleName === "event-target-shim/index.js") {
    const filePath = require.resolve("event-target-shim", {
      paths: [path.join(__dirname, "node_modules/react-native-webrtc")],
    });
    return { type: "sourceFile", filePath };
  }
  // Our own TS roots (src/, shared/) use NodeNext-style `.js` specifiers that
  // point at TS sources; see scripts/lib/metro-js-specifier.js. Real .js deps
  // elsewhere are untouched.
  const rewritten = rewriteJsSpecifier(__dirname, origin, moduleName);
  if (rewritten !== null) return context.resolveRequest(context, rewritten, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
