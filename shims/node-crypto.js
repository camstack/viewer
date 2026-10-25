function unavailable() {
  throw new Error("node:crypto is unavailable in the Viewer runtime");
}

module.exports = {
  createHash: unavailable,
  createHmac: unavailable,
  randomUUID: unavailable,
  timingSafeEqual: unavailable,
};
