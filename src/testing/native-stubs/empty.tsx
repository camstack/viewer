/**
 * Catch-all stub for native API modules whose surface is only ever touched
 * inside an event handler (share, pick a file, write to disk). A screen that
 * merely MOUNTS never calls into them, so an empty namespace is faithful; a
 * screen that does call one gets `undefined is not a function`, which is the
 * correct signal that the module needs a real stub rather than this one.
 */
export default {}
