/**
 * The ONE way to hand a hub address to `expo-image`.
 *
 * ## Why this is a function and not two lines at each call site
 *
 * A tile that points at the right URL without the session token gets a 401,
 * and expo-image reports that as a plain `onError` — a black square with
 * nothing to read. On 2026-09-21 every clip still went out bare, because the
 * credential was taken from a variable that is also gated on the event-media
 * `uri`, which a native clip card does not have. 61 asks, 61 failures, on an
 * address that answers 200 to a request carrying the token.
 *
 * `EventThumb` renders three different images — a served still, a minted one,
 * a track's media — and the operator's question was the right one: *"why is a
 * clip thumbnail so hard when we show track images everywhere?"* It should be
 * the same thing from a different addon, and it now is: one resolver decides
 * the shape, and no call site re-derives the credential.
 *
 * A `data:` URI carries its bytes and needs no header; attaching one there
 * would be a credential handed to something that never asks a server.
 */

export interface HubImageSource {
  readonly uri: string
  readonly headers?: Record<string, string>
}

/**
 * @param uri absolute URL, or a `data:` URI.
 * @param token the session token, or `null` when there is none yet.
 */
export function hubImageSource(uri: string, token: string | null): HubImageSource {
  if (token === null || token.length === 0 || uri.startsWith('data:')) return { uri }
  return { uri, headers: { Authorization: `Bearer ${token}` } }
}
