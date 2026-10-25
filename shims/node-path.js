function unavailable() {
  throw new Error("node:path is unavailable in the Viewer runtime");
}

module.exports = {
  basename: unavailable,
  join: unavailable,
};
