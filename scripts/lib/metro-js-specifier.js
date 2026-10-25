/**
 * Which relative `.js` specifiers Metro must resolve as TypeScript sources.
 *
 * Our own source roots use NodeNext-style `.js` specifiers that point at `.ts`
 * files (so vitest and tsc resolve them); Metro does not rewrite them. Every
 * root the app bundles from our tree is listed HERE, once, so adding a root
 * cannot be forgotten in the resolver — `shared/` was, and the web build died.
 */
const path = require("path");

const TS_SOURCE_ROOTS = ["src", "shared"];

function isOwnTsSource(projectRoot, origin) {
  return TS_SOURCE_ROOTS.some((root) => origin.startsWith(path.join(projectRoot, root) + path.sep));
}

/** The specifier to hand Metro instead, or null when it must stay as written. */
function rewriteJsSpecifier(projectRoot, origin, moduleName) {
  if (!moduleName.startsWith(".") || !moduleName.endsWith(".js")) return null;
  return isOwnTsSource(projectRoot, origin || "") ? moduleName.slice(0, -3) : null;
}

module.exports = { TS_SOURCE_ROOTS, rewriteJsSpecifier };
