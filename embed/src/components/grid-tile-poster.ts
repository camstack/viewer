/**
 * Absolute poster URL from a `snapshot.getSnapshotLinks` row.
 *
 * The link is root-relative and signed; the embed already knows `serverUrl`.
 * A base64 `getSnapshot` over tRPC is the path this replaces — it copies JPEG
 * bytes through hub-main for a frame the HTTP plane already serves.
 */
export function absoluteSnapshotLinkUrl(
  serverUrl: string,
  url: string | null | undefined,
): string | null {
  if (url === undefined || url === null || url.length === 0) return null
  if (/^https?:\/\//i.test(url)) return url
  const base = serverUrl.replace(/\/+$/, '')
  const path = url.startsWith('/') ? url : `/${url}`
  return `${base}${path}`
}

export interface SnapshotLinkRow {
  readonly url: string | null
}

export function posterUrlFromLinkRows(
  serverUrl: string,
  rows: readonly SnapshotLinkRow[],
): string | null {
  const first = rows[0]
  if (first === undefined) return null
  return absoluteSnapshotLinkUrl(serverUrl, first.url)
}
