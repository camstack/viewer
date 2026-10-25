/**
 * The rename dictionary the embed needs, built from the viewer's LOCAL renames.
 *
 * ## Which world this is
 *
 * Renaming a camera in this app is purely CLIENT-SIDE: `camera-prefs-store`
 * holds a `localName` per camera id, and `useCameras` applies it as
 * `CameraInfo.name` while keeping the server's own value in `originalName`.
 * Nothing is written back to `deviceManager`. So the hub genuinely does not
 * know these names, and the embed — which resolves its camera labels from the
 * server for itself — had no way to learn them. That is the whole gap: not a
 * plumbing miss, a fact about where the names live.
 *
 * ## Why only the renamed ones
 *
 * The dictionary carries a camera ONLY when the operator actually renamed it.
 * Sending every camera would be bytes for nothing, and worse: it would pin the
 * name the viewer happens to hold right now over whatever the hub knows, so a
 * camera renamed on the SERVER would keep showing the viewer's stale copy of
 * its old name. An override should override what the operator overrode, and
 * nothing else.
 */

/** The camera fields the dictionary is derived from — structural, so any
 *  caller with these three can build one (and the test needs no fixture). */
export interface NameableCamera {
  readonly id: number
  /** Display name: the local rename when set, else the server name. */
  readonly name: string
  /** The server's own name, kept even when locally overridden. */
  readonly originalName: string
}

/**
 * `{ '<id>': '<local name>' }` for every LOCALLY RENAMED camera. Pure.
 *
 * Keys are stringified ids because that is what the embed's
 * `Record<string, string>` config and its `names=` URL param both use.
 */
export function deviceNamesFromCameras(
  cameras: readonly NameableCamera[],
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const cam of cameras) {
    const local = cam.name.trim()
    if (local.length === 0 || local === cam.originalName.trim()) continue
    out[String(cam.id)] = local
  }
  return out
}

/**
 * Narrow the dictionary to a set of camera ids — what a SHARE LINK carries.
 *
 * A link scoped to three cameras has no business naming the other fourteen:
 * the names are the operator's private labels, and a link is handed to someone
 * else. An empty `ids` means "every camera the link can see", so the whole
 * dictionary rides along.
 */
export function pickDeviceNames(
  names: Readonly<Record<string, string>>,
  ids: readonly number[],
): Record<string, string> {
  if (ids.length === 0) return { ...names }
  const wanted = new Set(ids.map((id) => String(id)))
  const out: Record<string, string> = {}
  for (const [id, name] of Object.entries(names)) {
    if (wanted.has(id)) out[id] = name
  }
  return out
}
