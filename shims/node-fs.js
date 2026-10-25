function unavailable() {
  throw new Error("node:fs is unavailable in the Viewer runtime");
}

module.exports = {
  chmodSync: unavailable,
  createWriteStream: unavailable,
  existsSync: unavailable,
  mkdirSync: unavailable,
  promises: new Proxy({}, { get: () => unavailable }),
  readFileSync: unavailable,
  readdirSync: unavailable,
  renameSync: unavailable,
  rmSync: unavailable,
  unlinkSync: unavailable,
  writeFileSync: unavailable,
};
